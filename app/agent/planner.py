"""Agent 主循环 - PetPal 核心。

执行流程：
1. 路由：classify_task(text, has_image) → task
2. VLM 首步（如有图）：vlm.analyze(image, task)
3. 注入 context（宠物档案 + 最近事件 + VLM 输出 + 多轮历史）→ system prompt
4. Agent loop（max_iter=5）：LLM(messages, tools) → tool_calls → execute → ...
5. 持久化到 chat_sessions（含 session_id 分组）

两种调用方式：
- run_agent(...) 同步，CLI/简单测试
- run_agent_stream(...) async 生成器，SSE 流式（P5+ 主用）
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, AsyncIterator, Optional

from dotenv import load_dotenv
from openai import OpenAI
from sqlmodel import Session, select

from app.agent.context import build_pet_context, format_vlm_block
from app.agent.router import Task, classify_task
from app.agent.tools import TOOL_DISPATCH, TOOL_SCHEMAS
from app.agent.vlm import analyze as vlm_analyze
from app.db.database import session_scope
from app.db.models import ChatSession, Pet

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent.parent.parent

_client: Optional[OpenAI] = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.getenv('OPENROUTER_API_KEY'),
            base_url=os.getenv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
        )
    return _client


SYSTEM_PROMPT_TEMPLATE = """你是 PetPal——一个有温度的多模态宠物管家。

# 你的人设

不是冷冰的客服，更像懂宠物的朋友：
- **用宠物名字**称呼它："亚历山大今天..." / "小肥这种情况..."，不要"您的宠物"，偶尔"小家伙 / 小宝贝"等亲昵称呼
- **共情发挥**：紧张时安抚（"别太担心..."）、轻松时调侃，根据用户语气调节。**不要复读**"我理解你现在很急"这种模板共情句——你的本能共情比模板自然
- **具体能做的事**，避免"建议咨询专业兽医"这种敷衍。除非真的急诊红线
- emoji 可以自然用——🐱 🐶 🐾 📚 ⚠️ 这些猫狗主题都可爱

# 当前会话

task = {task}

{pet_context}
{vlm_block}

# 系统机制（重要——决定你能不能真做事）

你每轮的回复有两个字段：
- `content`：要给主人看的话
- `tool_calls`：要让系统执行的工具调用（一个数组）

**判定规则**（你必须理解）：
- `tool_calls` **非空** → 系统真去执行工具，你的 `content` 显示成"动作描述"（主人知道你在做事）；执行完会再喂结果给你，进入下一轮
- `tool_calls` **为空** → 你的 `content` 当作**最终答复**给主人，**本轮 agent loop 立即结束**

**所以这些是无效行为**：
- 在 `content` 写 "我来调用工具 X" 但 `tool_calls=[]` → 系统当 final 给主人，**啥也不做**
- 主人反问"你没做呀" → `content` 写"已成功设置！时间 06:00..." 但 `tool_calls=[]` → **幻觉**（系统根本没执行）
- 工具调完后 `content` 写"已为 X 设好提醒，我来补进记录里" 但 `tool_calls=[]` → "补进记录里" 是**空话**（没真补）

**正确做法**：
- 要真调工具：**必须 emit `tool_calls`**，光在 content 写"我来 X"没用
- 要给最终答复：content 写完整，**tool_calls 留空**，本轮就结束
- 主人质问你没做某事 → **不要**捏造已做过，立即 emit 真的 tool_calls 去执行
- 工具成功返回后 → 直接写完整收尾 content + `tool_calls=[]`，**结束本轮**。不要再追加"我来 X (其他)"那类话，那会让你卡在 loop 里反复刷动作描述
- 确认型 tool（schedule_reminder / save_pet_event）成功一次就够——下一轮立即 `tool_calls=[]` 写收尾，**不要重复调**

# 工作基调

1. **多查 RAG**——症状、行为、饮食建议等等，**哪怕你觉得已经知道答案**，先 `retrieve_vet_knowledge` 一次。基于 KB 比凭印象更可靠，主人也能看到你查了什么。

2. **多记事件**——symptom一定要记，有价值的健康信息（bcs/疼痛/情绪/体重评估）一定要记、以及有趣事件和发现都可以 `save_pet_event`。主人翻时间线看记录，少了就没了。
   **更新事件**：主人对你**刚 save 过的事件**追加细节时（如刚 save "呕吐"，本轮发呕吐物图佐证），改用 `update_pet_event(event_id=N)` 追加而不是新建——避免时间线重复条目。
   怎么知道刚 save 过？看对话上文 `[已调 tools: ...]` 摘要里的 `event_id=N`，或 system context「最近事件」里 `id=N` 的同类条目（仅限**今日**同 event_type）。

3. **调工具时 content 写一句动作描述**：
   - 调用工具时（tool_calls 非空那轮），content 简短描述"我下一步做什么"（≤30 字）+ 适当共情
   - **第一次 tool 前必写**，让主人感知你在动手
   - **不要**在调工具时的 content 里写分析、建议、结论——那是收尾 content 的事，提前写完了收尾就空了
   - 不调 tool 时直接写收尾 content（详细分析全留收尾那轮）

4. **收尾 content 是 `tool_calls=[]` 那轮的输出**——所有 tool 调完才写完整收尾。**绝不**在收尾里说"我会记录 / 我会保存 / 我来 X"——要么这一轮就 emit 真的 tool_calls 去做（说了就要调！），要么彻底不写这句话。收尾要包含所有相关信息（分析、建议、KB 引用、就医阈值），不是只说"已记录"。

# 工作流（按你的处理顺序：看图 → 查 → 记 → 其他 → 收尾）

**先调工具，后写收尾 content**——收尾是整理完信息后给主人的成品，不要在收尾里说"我现在去 X"。
**每次 emit tool_calls 时 content 务必写一句动作描述**——这是 agent 体验的灵魂。

## 1. 看图（reanalyze_image）

**你的视觉能力（先理解）**：

你是一个多模态 agent，但你不是直接"看"像素——你的视觉感知由 VLM 子系统替你完成。
每次主人发图，VLM **已经替你看过了**，结果写在「你看到的图片」块里（本轮新图跟在 user message 末尾；本轮无图但 session 有过图时，「你之前看到的图片」块在 system context）：
- `observation`：你看到的物体 / 部位 / 状态描述
- `visible_details`：罗列图中所有临床相关细节
- `candidates` / 分数字段：你的判断结果（如 BCS=8 / FGS=0 / main_emotion=放松）
- `rationale`：你的判断依据

**这就是你能从图里得到的全部信息**——基于这些字段组合 RAG 和宠物档案，足够写完整收尾。

**图片场景判定**：

**A) user message 末尾出现「你看到的图片」块** = 本轮主人刚发了新图。

本轮 VLM 输出的 observation 和 visible_details 就是图的全部——直接基于它们写收尾即可，不必再调 reanalyze 看一遍同 task。

判断「承接前轮 vs 全新」——看 system context「最近事件」里是否有**今日同 event_type** 的记录：

- **承接前轮**（最近事件里有**今日同 event_type** 记录，如刚才存过 symptom 本轮发图佐证）：
  - **优先调 `update_pet_event(event_id=最近的)`** 追加补充观察（如细节、新发现），**不要 save_pet_event 新建**——否则时间线重复
  - **类型必须匹配**：情绪评估只能 update 到 emotion 事件，BCS 只能 update 到 bcs，不要 update 到不同类型（如 milestone / note）的事件上
  - 基于 VLM 写收尾

- **全新场景**（最近事件无相关）：
  - 基于 VLM 写收尾
  - symptom（任意）/ bcs ≥7 或 ≤3 / pain_fgs ≥0.39 → **补查 retrieve_vet_knowledge** 拿专业方案
  - 必要时 save_pet_event 新建

**B) system context 出现「你之前看到的图片」块** = 本轮无新图，但 session 之前有图：
- 这是**之前**的图，本轮**可以换 task 重看**！
- 主人问图能回答的**另一维度**（例：上次 emotion，本轮问「疼吗 / 多胖 / 几分」）→ **调 `reanalyze_image(task=新task)`** 重看历史图，**focus 可不填**
- 主人问图的**同维度更细节**（"再看耳朵"）→ reanalyze(task=同, focus=部位)
- 主人问的与图无关（如纯文字咨询行为问题）→ 走标准流程（RAG / save / 收尾）

**C) 两个 VLM 块都没有** = 全程无图 → 走标准流程

## 2. 查知识（retrieve_vet_knowledge）

**该查的场景**：
- **症状类（symptom）**：**务必先查**——基于知识库的回答比凭印象更可靠，**每次新症状都查一次**
- **bcs 极端值（≥7 或 ≤3）**：拿专业饮食/护理方案
- **pain_fgs ≥0.39**：拿处置方案
- 主人问行为问题、饮食建议、罕见健康问题、品种特性等

## 3. 记事件（save_pet_event / update_pet_event）

在收尾之前，**对值得记录的发现宽松调 save_pet_event**：
- **症状（symptom）一定要存**——主人需要追踪健康历史
- **体重（weight）一定要存**——主人说"称了 X kg / 现在多重了"等，写 event_type='weight'，会同步档案
- **bcs / pain_fgs疼痛评估 / emotion 情绪评估**：一定要存。评了就存。
- **有趣观察**（"今天第一次主动凑过来"、"换了新粮吃得很香"、"学会了新指令"）：存
- 默认"值得记录"，少了就没了

**不要在收尾 content 里说"我记一下"**——先 emit 真的 save_pet_event tool_calls，再写收尾。

**何时新建（save_pet_event）**：完全新的事件、新症状、新观察、第一次评估。

**何时追加（update_pet_event）**：主人对**你刚记过的事件**追加细节。判断信号：
- 看对话上文你上一轮 tool 结果有 `event_id=N` → 那就是要 update 的对象
- 或看 system context「最近事件」里 `id=N` 的**今日同类型**条目

**update 限制**：
- 只能 update 24 小时内的事件（更早的工程层会拒）
- 类型必须匹配（情绪 update 到 emotion，BCS update 到 bcs；**不要** update 到 milestone/note 等不相关类型）

**event_type 完整列表（10 类）**：
- `symptom` — 症状（呕吐、咳嗽、皮疹等），payload: `symptom_desc + severity (low/medium/high/critical)`
- `bcs` — 体态评分，payload: `bcs_score (1-9) + rationale`
- `pain_fgs` — 疼痛评估（Feline Grimace Scale），payload: `total_score (0-10) + normalized`
- `emotion` — 情绪评估，payload: `main_emotion + confidence (0-1)`
- `weight` — 体重，payload: `weight_kg=数字`（其他单位换算：1 斤=0.5 kg；**放 payload 字段，不要塞 note**）
- `vaccine` — 疫苗记录，payload: `vaccine_name + brand?`
- `feeding` — 饮食观察（换粮、新食物反应等），payload: `description`
- `grooming` — 洗澡美容，payload: `description`
- `milestone` — 训练/社会化里程碑（"学会握手"），payload: `title + description`
- `note` — 其他有趣观察或备忘（"今天主动凑过来"），payload: `text`

payload 合并到一个 dict，**不要拆多次调**。

**评估型事件（emotion / bcs / pain_fgs）特别规则——VLM 评了什么决定存什么**：

看「你看到的图片」块头部的 `task=X` 字段——本轮 VLM 做了什么评估，
就存对应类型的事件，关键字段直接抄 VLM 输出：

- `task=emotion` → 存 emotion 事件，`main_emotion` + `confidence` 抄 VLM 的 `candidate_emotions[0]`
- `task=bcs` → 存 bcs 事件，`bcs_score` + `rationale` 抄 VLM
- `task=pain_fgs` → 存 pain_fgs 事件，`total_score` + `normalized` 抄 VLM
- `task=symptom` / `task=chat` / 无图片块 → 这三类事件这轮跳过，留给主人下次明确请求评估时再做

这三类事件的关键字段是数据透传（VLM 客观输出），不是你估算的判断。

## 4. 其他工具

- **chat 有图**：基于上方 VLM 的 observation 字段自然温和回应（不医学化）
- **find_nearby_clinic**：仅当用户明确给具体地址（"北京海淀"/"上海徐汇"）才调。不要用"附近"占位符
- **schedule_reminder**：主人说"提醒我下周二给 X 打疫苗 / 30 天后驱虫 / 下个月给小肥洗澡" → 调 schedule_reminder
  - `scheduled_at_local` 用本地时间 ISO（"2026-05-21T09:00:00"），**不要带 Z 或时区后缀**
  - `reminder_type` 严格用 enum：vaccine/deworm/bath/medication/checkup/other
  - 时间没说具体钟点 → 默认上午 9:00；说"下周二/30 天后/下个月"等相对时间，参考 system context 里的"今天日期"算出绝对时间
  - 重复频率（"每月驱虫一次"）→ 设 `repeat_rule='monthly'` / `yearly` / `every:90d`（MVP 不真重复，但到期会弹"再加一条"按钮）
  - **schedule_reminder 成功返回后**：直接写收尾 content + `tool_calls=[]` 结束本轮。**不要**再调一次确认、不要再追加 save_pet_event 备份——确认型 tool 调一次就够

## 5. 收尾 content 写法（`tool_calls=[]` 那轮，给主人的成品）

**详细 + 灵活 + 有温度**——基于 RAG 返回 / VLM 输出 / 宠物档案自然组织。像朋友说话，不是写学术论文。

不同 task 通常涵盖：
- symptom: 可能原因 / 何时就医（带 24h 等阈值数字）/ 家庭处理 / 急诊红线
- bcs: 评分解读 / 健康影响 / 具体饮食运动建议
- pain_fgs: 总分含义（>0.39 临床阈值）/ 处置 / 局限提示
- emotion: 观察到的肢体信号 / 可能情绪 / 互动建议 / 单图局限
- chat: 基于图片描述自然温和回应，**不医学化**

用 markdown 让答复清晰（**粗体**、- 列表、必要时小标题），但**别死板套模板**——根据具体情境取舍。

**收尾结束的标志**：写完答复，`tool_calls=[]`，本轮 agent loop 就停了。**不要在收尾末尾追加 "我来 X / 我会 X / 我去补 X" 这种话**——要么这一轮就 emit tool_calls 真做，要么彻底不写。这种"承诺型尾巴"是导致循环刷动作描述的元凶。

## 6. 调工具时 content 写什么（`tool_calls` 非空那轮）

⚠️ **每次 emit tool_calls 时，content 里同步写一句简短动作描述**——这是 agent 体验的灵魂，特别是**第一次 tool 前必写**。

例子（content + 同时 emit tool_calls）：
- "我先查一下兽医知识库 📚" + tool_calls=[retrieve_vet_knowledge(...)]
- "找到几条相关条目，让我先记下来" + tool_calls=[save_pet_event(...)]
- "BCS 是 8，让我查查饮食方案" + tool_calls=[retrieve_vet_knowledge(...)]
- "我来安排提醒 📅" + tool_calls=[schedule_reminder(...)]

注意：不要僵硬、不要照读模板。可以灵活加入共情语句、有温度。

❌ **不要做的**：
- ❌ **把分析、建议、结论写进调工具时的 content** —— 那是收尾的事，提前写了收尾就空了
- ❌ **tool_calls 单独跳出来，content 为空** —— 让主人觉得你在沉默运行
- ❌ **content 写 "我来 X / 我会 X" 但 `tool_calls=[]`** —— 系统当 final，X 永远不会被执行

调工具时的 content **不是用来回答主人**——回答留给 `tool_calls=[]` 那轮。

# 不要做的

- **通常不要调 query_pet_history**——最近 5 条事件已在 system context 给你，除非用户明确问更早历史
- **不要重复**用相同参数调同一 tool
- pet_id 用上方"宠物档案"里给的真实 ID，不要编造
- **不要在确认型 tool（schedule_reminder / save_pet_event）成功一次后继续 emit 类似 tool_calls 反复"再确认"**——一次成功就够，下一轮立即 `tool_calls=[]` 收尾
- **不要在收尾 content 末尾追加 "我来 X / 我会 X" 类承诺尾巴**——会让你卡在循环里反复刷动作描述"""


def _vlm_task_for(task: Task) -> str:
    """task → VLM 应该用哪个 prompt。chat 走专属 CHAT_PROMPT（温暖观察，不医学化）。"""
    if task in ('symptom', 'emotion', 'bcs', 'pain_fgs'):
        return task
    return 'chat'


def run_agent(
    user_text: str,
    pet_id: int,
    image_path: Optional[str | Path] = None,
    max_iter: int = 5,
    verbose: bool = True,
) -> dict:
    """主入口。返回 {final_answer, task, tool_calls, vlm_output, iterations, elapsed_s}。"""
    t0 = time.perf_counter()
    image_path_str = str(image_path) if image_path else None
    has_image = image_path is not None

    # ---- Step 1: route ----
    task: Task = classify_task(user_text, has_image)
    if verbose:
        print(f'[planner] task={task}')

    # ---- 准备 DB session（贯穿整个 run）----
    with session_scope() as session:
        # ---- Step 2: VLM 首步（如果有图）----
        vlm_output = None
        if has_image:
            pet = session.get(Pet, pet_id)
            species_zh = {'cat': '猫', 'dog': '狗'}.get(pet.species if pet else '', '') or None
            try:
                vlm_output = vlm_analyze(
                    image_path=image_path_str,
                    task=_vlm_task_for(task),
                    species=species_zh,
                    extra=user_text or None,
                )
                if verbose:
                    print(f'[planner] vlm output keys: {list(vlm_output.keys())}')
            except Exception as e:
                vlm_output = {'_error': f'vlm failed: {e}'}
                if verbose:
                    print(f'[planner] vlm error: {e}')

        # ---- Step 3: 构造 messages ----
        # VLM 块从 system 挪到 user message：让 LLM 真正觉得"主人这一轮发了图"
        pet_ctx = build_pet_context(pet_id, session)
        vlm_block_for_user = format_vlm_block(vlm_output, _vlm_task_for(task)) if vlm_output else ''
        # 用 replace 而不是 .format()：prompt 里可能有字典字面量 {key: val} 会被误解析
        system_prompt = (
            SYSTEM_PROMPT_TEMPLATE
            .replace('{task}', task)
            .replace('{pet_context}', pet_ctx)
            .replace('{vlm_block}', '')  # sync 版无历史 VLM 概念，本轮 VLM 放到 user 消息
        )

        user_content = user_text.strip() if user_text else '（用户未输入文字，仅上传了图片）'
        if vlm_block_for_user:
            user_content = f'{user_content}\n\n---\n{vlm_block_for_user}'

        messages = [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_content},
        ]

        # ---- Step 4: Agent loop ----
        client = _get_client()
        model = os.getenv('LLM_MODEL', 'openai/gpt-4o-mini')
        tool_calls_log: list[dict] = []

        for iteration in range(max_iter):
            if verbose:
                print(f'[planner] iter {iteration+1}/{max_iter}: calling LLM...')

            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                tools=TOOL_SCHEMAS,
                temperature=0.5,
                max_tokens=1500,
            )
            msg = resp.choices[0].message

            # 加入对话历史（保留 tool_calls 字段供下一轮用）
            assistant_msg: dict[str, Any] = {
                'role': 'assistant',
                'content': msg.content or '',
            }
            if msg.tool_calls:
                assistant_msg['tool_calls'] = [
                    {
                        'id': tc.id,
                        'type': 'function',
                        'function': {
                            'name': tc.function.name,
                            'arguments': tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ]
            messages.append(assistant_msg)

            # 没有 tool_call → 可能 final，也可能"光说不做"
            if not msg.tool_calls:
                final = msg.content or ''
                # P6.3 同款 transition retry（跟 stream 版本一致，避免 sync/stream 双轨漂移）
                if _looks_like_transition_only(final) and iteration < max_iter - 1:
                    if verbose:
                        print(f'[planner] transition-only detected, injecting retry hint')
                    messages.append({
                        'role': 'system',
                        'content': (
                            '注意：你刚说要执行某个操作（如查知识库 / 记录事件），但**没有真的调 tool**。'
                            '请立即调用相应的 tool 真正执行——只说不做等于放弃任务。'
                        ),
                    })
                    continue

                elapsed = time.perf_counter() - t0
                if verbose:
                    print(f'[planner] done in {iteration+1} iter, {elapsed:.1f}s')
                return {
                    'final_answer': final,
                    'task': task,
                    'tool_calls': tool_calls_log,
                    'vlm_output': vlm_output,
                    'iterations': iteration + 1,
                    'elapsed_s': round(elapsed, 2),
                    'pet_id': pet_id,
                }

            # 执行 tool_calls
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or '{}')
                except json.JSONDecodeError:
                    args = {}

                if verbose:
                    print(f'[planner] → tool: {tool_name}({json.dumps(args, ensure_ascii=False)[:120]})')

                fn = TOOL_DISPATCH.get(tool_name)
                if not fn:
                    result = {'ok': False, 'error': f'unknown tool: {tool_name}'}
                else:
                    try:
                        result = fn(
                            args,
                            ctx={
                                'pet_id': pet_id,
                                'image_path': image_path_str,
                                'vlm_task': task,
                                # last_vlm_task: 用于 reanalyze_image 判断"同 task + 空 focus → 返回 cached"
                                'last_vlm_task': _vlm_task_for(task) if vlm_output else None,
                                # 本轮 VLM 输出，给 reanalyze cached 兜底用
                                'current_vlm_output': vlm_output,
                                'session': session,
                            },
                        )
                    except Exception as e:
                        result = {'ok': False, 'error': f'tool exception: {e}'}

                tool_calls_log.append({
                    'iter': iteration + 1,
                    'tool': tool_name,
                    'args': args,
                    'result_summary': _summarize_result(result),
                })

                messages.append({
                    'role': 'tool',
                    'tool_call_id': tc.id,
                    'content': json.dumps(result, ensure_ascii=False)[:8000],
                })

        # ---- 达到 max_iter ----
        elapsed = time.perf_counter() - t0
        return {
            'final_answer': '⚠ Agent 达到最大迭代次数，未能完成。请简化你的问题再试。',
            'task': task,
            'tool_calls': tool_calls_log,
            'vlm_output': vlm_output,
            'iterations': max_iter,
            'elapsed_s': round(elapsed, 2),
            'pet_id': pet_id,
            'reached_max_iter': True,
        }


def _summarize_result(result: Any) -> str:
    """tool 结果摘要，避免日志爆炸。"""
    if not isinstance(result, dict):
        return str(result)[:200]
    if 'error' in result:
        return f"error: {result['error']}"
    keys = list(result.keys())
    if 'count' in result:
        return f"count={result['count']}, keys={keys}"
    return f"keys={keys}"


def _truncate_for_persist(obj: Any, max_chars: int = 2000) -> Any:
    """把 tool result 序列化截断后再反序列化——保证存入 db 的 size 可控。"""
    try:
        s = json.dumps(obj, ensure_ascii=False)
    except Exception:
        return {'_truncated': True, 'preview': str(obj)[:max_chars]}
    if len(s) <= max_chars:
        return obj
    return {
        '_truncated': True,
        'preview': s[:max_chars] + '...',
        'original_size': len(s),
    }


_TRANSITION_HINTS = (
    '稍等', '请稍等', '请等', '稍候',
    '让我先', '让我查', '让我看', '让我把', '让我帮', '让我再',
    '我先', '我看看', '我再查', '我再看', '我再分析', '我再',
    '我查', '我帮', '我整理', '我把', '我去',
    # Qwen 风格的承诺词（"说要做但没真做" 漂移）
    '我来', '我会把', '我会去', '我会查', '我会记', '我会保存', '我会先',
    '我马上', '我现在', '我这就', '准备',
)


def _looks_like_transition_only(text: str) -> bool:
    """检测 LLM 输出是否是「过渡语但没调 tool」的半截子（光说不做）。

    特征：长度 < 150 字、含动作过渡词、没给出具体建议（无数字阈值/无结构化内容）。
    """
    t = (text or '').strip()
    if len(t) < 1 or len(t) > 200:
        return False
    if not any(w in t for w in _TRANSITION_HINTS):
        return False
    # 含具体内容（数字阈值 / markdown 标题 / 列表）→ 不当过渡
    has_specifics = (
        any(d in t for d in ['24 小时', '12 小时', '4-6 小时', '禁食', '## ', '- ', '1.', '2.'])
        or len(t) > 150
    )
    return not has_specifics


def _summarize_tool_call_for_history(call: dict) -> str:
    """把单条 tool 调用记录浓缩成一行（注入 history 让 LLM 跨 run 看到自己调过啥）。

    抽取关键字段：RAG 抽 query；save/update 抽 event_id + event_type；其他抽简略。
    """
    tool = call.get('tool', '?')
    args = call.get('args') or {}
    result = call.get('result') if isinstance(call.get('result'), dict) else {}

    if tool == 'retrieve_vet_knowledge':
        q = (args.get('query') or '')[:50]
        return f"retrieve_vet_knowledge(query='{q}')"
    if tool == 'save_pet_event':
        et = args.get('event_type', '')
        eid = result.get('event_id')
        return f"save_pet_event({et}, event_id={eid})"
    if tool == 'update_pet_event':
        eid = args.get('event_id')
        et = result.get('event_type', '')
        return f"update_pet_event(event_id={eid}, type={et})"
    if tool == 'reanalyze_image':
        t = args.get('task', '')
        f = args.get('focus') or ''
        return f"reanalyze_image(task={t}, focus={f!r})" if f else f"reanalyze_image(task={t})"
    if tool == 'find_nearby_clinic':
        loc = (args.get('location') or '')[:30]
        return f"find_nearby_clinic(location='{loc}')"
    if tool == 'schedule_reminder':
        rt = args.get('reminder_type', '')
        at = args.get('scheduled_at_local', '')
        return f"schedule_reminder({rt}, at={at})"
    if tool == 'query_pet_history':
        return f"query_pet_history({args.get('event_type', 'all')})"
    return f"{tool}(...)"


# ============ Async generator for SSE streaming ============

def _load_history(
    session: Session,
    session_id: Optional[str],
    limit: int = 8,
) -> list[dict]:
    """从 chat_sessions 加载该 session_id 的最近 limit 条 user/assistant 消息。

    返回 [{role, content}] 列表，按时间顺序（旧→新）。
    抽取所有 assistant 的 tool_calls 摘要为**独立 system message**（放 history 最前）——
    让 LLM 看到工具历史但不会把 `[已调 tools]` 当成 assistant 输出格式去模仿。
    """
    if not session_id:
        return []
    stmt = (
        select(ChatSession)
        .where(ChatSession.session_id == session_id)
        .where(ChatSession.role.in_(['user', 'assistant']))
        .order_by(ChatSession.created_at.desc())
        .limit(limit)
    )
    rows = list(session.exec(stmt).all())
    rows.reverse()  # 改成旧→新

    # 抽取所有 tool 调用摘要 → 独立 system message（不污染 assistant content）
    all_summaries: list[str] = []
    for r in rows:
        if r.role == 'assistant' and r.tool_calls_json:
            try:
                calls = json.loads(r.tool_calls_json)
                if isinstance(calls, list):
                    all_summaries.extend(_summarize_tool_call_for_history(c) for c in calls)
            except (json.JSONDecodeError, TypeError):
                pass

    out: list[dict] = []
    if all_summaries:
        out.append({
            'role': 'system',
            'content': (
                '[已调 tools] 你在当前对话已经调过的 tools（参考用，避免重复 RAG / 重复 save、'
                '为 update_pet_event 选对 event_id）：\n'
                + '\n'.join(f'- {s}' for s in all_summaries)
            ),
        })

    for r in rows:
        if r.content:
            out.append({'role': r.role, 'content': r.content})
    return out


def _persist_message(
    session: Session,
    session_id: str,
    pet_id: int,
    role: str,
    content: str,
    tool_calls_json: Optional[str] = None,
    image_url: Optional[str] = None,
    task: Optional[str] = None,
    is_intermediate: bool = False,
    vlm_output_json: Optional[str] = None,
    user_id: Optional[int] = None,
) -> None:
    msg = ChatSession(
        session_id=session_id,
        pet_id=pet_id,
        user_id=user_id,
        role=role,
        content=content,
        tool_calls_json=tool_calls_json,
        image_url=image_url,
        task=task,
        is_intermediate=is_intermediate,
        vlm_output_json=vlm_output_json,
    )
    session.add(msg)
    session.commit()


async def run_agent_stream(
    user_text: str,
    pet_id: int,
    session_id: str,
    image_path: Optional[str | Path] = None,
    image_url_for_persist: Optional[str] = None,
    max_iter: int = 5,
    user_id: Optional[int] = None,
) -> AsyncIterator[dict]:
    """SSE 事件流主实现。yield 事件 dict（外层负责序列化为 SSE）。

    Event types:
      - start                    {session_id}
      - task_classified          {task}
      - vlm_start                {task}
      - vlm_done                 {output}
      - iter_start               {iter}
      - assistant_thinking       {content} (LLM 想说话但还要调 tool)
      - tool_call                {iter, tool, args}
      - tool_result              {iter, tool, summary}
      - final_answer             {content}
      - done                     {iterations, elapsed_s, tool_calls_count}
      - error                    {detail}
      - max_iter_reached         {}
    """
    t0 = time.perf_counter()
    image_path_str = str(image_path) if image_path else None
    has_image = image_path is not None

    yield {'type': 'start', 'session_id': session_id}

    # --- Step 1: route + 历史图回填（让 reanalyze_image 在后续轮能用到上轮的图）---
    historical_image_path: Optional[str] = None
    with session_scope() as db_for_hint:
        last_assistant = db_for_hint.exec(
            select(ChatSession)
            .where(ChatSession.session_id == session_id)
            .where(ChatSession.role == 'assistant')
            .order_by(ChatSession.created_at.desc())
            .limit(1)
        ).first()
        recent_hint = last_assistant.content if last_assistant and last_assistant.content else None

        # 如果当前请求无图，找 session 最近一条带 image_url 的 user msg，回填磁盘路径
        if not has_image:
            last_user_with_image = db_for_hint.exec(
                select(ChatSession)
                .where(ChatSession.session_id == session_id)
                .where(ChatSession.role == 'user')
                .where(ChatSession.image_url.is_not(None))
                .order_by(ChatSession.created_at.desc())
                .limit(1)
            ).first()
            if last_user_with_image and last_user_with_image.image_url:
                url = last_user_with_image.image_url
                if url.startswith('/static/'):
                    sub = url[len('/static/'):]
                    disk = ROOT_DIR / 'data' / 'uploads' / sub
                    if disk.exists():
                        historical_image_path = str(disk)

    try:
        task: Task = await asyncio.to_thread(
            classify_task, user_text, has_image, recent_hint
        )
    except ValueError as e:
        yield {'type': 'error', 'detail': str(e)}
        return
    yield {'type': 'task_classified', 'task': task}

    # 注：P6.3 移除"历史图自动当本轮图"逻辑（user 反馈这是 over-engineering）：
    # - 本轮无图意味着用户不想讨论图，重跑 VLM 浪费 token + 让 reanalyze tool 失效
    # - 改成：本轮无图时从 chat_sessions 拿历史 VLM 输出 → 注入 context 让 LLM 看
    # - LLM 想看图细节时主动调 reanalyze_image (with focus)

    with session_scope() as db:
        # --- Step 2: VLM（仅本轮新图才跑）+ 历史 VLM 注入（无图时） ---
        vlm_output = None
        historical_vlm_output = None
        historical_vlm_task: Optional[str] = None
        historical_vlm_at: Optional[str] = None

        if has_image:
            pet = db.get(Pet, pet_id)
            species_zh = {'cat': '猫', 'dog': '狗'}.get(pet.species if pet else '', '') or None
            yield {'type': 'vlm_start', 'task': _vlm_task_for(task)}
            try:
                vlm_output = await asyncio.to_thread(
                    vlm_analyze,
                    image_path=image_path_str,
                    task=_vlm_task_for(task),
                    species=species_zh,
                    extra=user_text or None,
                )
                yield {'type': 'vlm_done', 'output': vlm_output}
            except Exception as e:
                vlm_output = {'_error': f'vlm failed: {e}'}
                yield {'type': 'vlm_done', 'output': vlm_output}
        else:
            # 本轮无图 → 查同 session 最近一条带 VLM 输出的 user msg，注入 context
            last_vlm_row = db.exec(
                select(ChatSession)
                .where(ChatSession.session_id == session_id)
                .where(ChatSession.vlm_output_json.is_not(None))
                .order_by(ChatSession.created_at.desc())
                .limit(1)
            ).first()
            if last_vlm_row and last_vlm_row.vlm_output_json:
                try:
                    parsed = json.loads(last_vlm_row.vlm_output_json)
                    if isinstance(parsed, dict) and not parsed.get('_error'):
                        historical_vlm_output = parsed
                        historical_vlm_task = last_vlm_row.task
                        historical_vlm_at = last_vlm_row.created_at.strftime('%Y-%m-%d %H:%M')
                except json.JSONDecodeError:
                    pass

        # 持久化用户消息（含图 URL + task + VLM 输出 用于刷新还原）
        if user_text or has_image:
            _persist_message(
                db,
                session_id=session_id,
                pet_id=pet_id,
                user_id=user_id,
                role='user',
                content=user_text or '',
                image_url=image_url_for_persist,
                task=task,
                vlm_output_json=json.dumps(vlm_output, ensure_ascii=False) if vlm_output else None,
            )

        # --- Step 3: messages ---
        # VLM 块策略：
        # - 本轮新图（vlm_output）→ 拼到 user message 末尾（让 LLM 觉得是本轮 user 输入的视觉信息）
        # - 本轮无图但 session 有历史图（historical_vlm_output）→ 放 system（这是真正的"背景资料"）
        pet_ctx = build_pet_context(pet_id, db)
        vlm_block_for_user = ''
        vlm_block_for_system = ''
        if vlm_output:
            vlm_block_for_user = format_vlm_block(vlm_output, _vlm_task_for(task))
        elif historical_vlm_output:
            vlm_block_for_system = format_vlm_block(
                historical_vlm_output,
                historical_vlm_task or 'unknown',
                label=f'你之前看到的图片（参考用，{historical_vlm_at}，本轮主人未上传新图）',
            )
        # 历史图提示规则已统一到 SYSTEM_PROMPT_TEMPLATE 「图片场景判定」B 分支，
        # 不再在此追加额外块（避免与 prompt 中规则重复或冲突）。
        # 用 replace 而不是 .format()：prompt 里可能有字典字面量 {key: val} 会被 format 误解析为 placeholder
        system_prompt = (
            SYSTEM_PROMPT_TEMPLATE
            .replace('{task}', task)
            .replace('{pet_context}', pet_ctx)
            .replace('{vlm_block}', vlm_block_for_system)
        )

        history = _load_history(db, session_id, limit=8)
        # 本轮新图 → 把 VLM 块拼到 history 最后一条 user message（让 LLM 知道"主人这一轮发了图"）
        if vlm_block_for_user:
            for i in range(len(history) - 1, -1, -1):
                if history[i].get('role') == 'user':
                    original_content = history[i].get('content', '')
                    history[i] = {
                        'role': 'user',
                        'content': f'{original_content}\n\n---\n{vlm_block_for_user}',
                    }
                    break
        # 移除最新刚插入的本次 user message（避免重复出现）
        # 实际上 _load_history 已经把它包含进去了，但消息没新插入到 db 时 history 也不会有
        # 我们这里 history 已经包含本次 user msg，让 LLM 看到上下文是对的
        # 但我们要追加 image observation 进去——不行，VLM block 已经在 system 里
        # 所以 history 末尾应该已是当前用户 message，OK

        # 严格说：上面 _persist_message 之后 _load_history 会拉到这条 user msg
        # 但当前 user msg 内容 = user_text，作为 messages 最后一项就行
        # 我们让 history 包含历史 + 当前 user msg，不重复加一次

        messages = [{'role': 'system', 'content': system_prompt}] + history

        # --- Step 4: Agent loop ---
        client = _get_client()
        model = os.getenv('LLM_MODEL', 'openai/gpt-4o-mini')
        tool_calls_count = 0

        # 本次 run 内已调过的 save_pet_event 签名（pet_id, event_type）—— 用于去重
        # gpt-4o-mini 偶尔会把同一事件存两次或把症状/情绪拆开重复存
        saved_event_keys: set[tuple] = set()

        sid_short = session_id[:8] if session_id else '?'
        for iteration in range(max_iter):
            yield {'type': 'iter_start', 'iter': iteration + 1}
            print(f'[stream] iter {iteration+1}/{max_iter} session={sid_short} task={task} → LLM...', flush=True)

            try:
                resp = await asyncio.to_thread(
                    lambda: client.chat.completions.create(
                        model=model,
                        messages=messages,
                        tools=TOOL_SCHEMAS,
                        temperature=0.5,
                        max_tokens=1500,
                    )
                )
            except Exception as e:
                print(f'[stream]   ✗ LLM call failed: {e}', flush=True)
                yield {'type': 'error', 'detail': f'LLM call failed: {e}'}
                return

            msg = resp.choices[0].message
            _content_preview = (msg.content or '').replace('\n', ' ')[:100]
            _tools_preview = [tc.function.name for tc in msg.tool_calls] if msg.tool_calls else []
            print(f'[stream]   content={_content_preview!r} tools={_tools_preview}', flush=True)
            assistant_msg: dict[str, Any] = {
                'role': 'assistant',
                'content': msg.content or '',
            }
            if msg.tool_calls:
                assistant_msg['tool_calls'] = [
                    {
                        'id': tc.id,
                        'type': 'function',
                        'function': {
                            'name': tc.function.name,
                            'arguments': tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ]
            messages.append(assistant_msg)

            # 无 tool_call → 可能 final，也可能"光说不做"
            if not msg.tool_calls:
                final = msg.content or ''
                # 兜底：检测 LLM 光说不做（过渡语没真调 tool），静默注入 system 提示让它继续
                # 不 yield + 不持久化——避免前端出现"重复 motivation"的尴尬 UX；
                # 这次的 transition 是失败的尝试，对用户没意义，让下一轮 Qwen 带 tool_calls 重写即可
                if _looks_like_transition_only(final) and iteration < max_iter - 1:
                    print(f'[stream]   ⟲ silent transition retry (content looked like 光说不做)', flush=True)
                    messages.append({
                        'role': 'system',
                        'content': (
                            '注意：你刚说要执行某个操作（如查知识库 / 记录事件），但**没有真的调 tool**。'
                            '请立即调用相应的 tool 真正执行——只说不做等于放弃任务。'
                            '注意：你这条没带 tool_calls 的回复已被系统识别为失败尝试丢弃，'
                            '请重新输出一条**带 tool_calls 的完整动作**（content 可以重写）。'
                        ),
                    })
                    continue  # 静默进入下一轮 iter，让 LLM 真去调

                # 正常 final
                _persist_message(
                    db,
                    session_id=session_id,
                    pet_id=pet_id,
                    user_id=user_id,
                    role='assistant',
                    content=final,
                    task=task,
                    is_intermediate=False,
                )
                yield {'type': 'final_answer', 'content': final}
                elapsed = round(time.perf_counter() - t0, 2)
                print(f'[stream]   ✓ final_answer at iter {iteration+1} ({elapsed}s, tools={tool_calls_count})', flush=True)
                yield {
                    'type': 'done',
                    'iterations': iteration + 1,
                    'elapsed_s': elapsed,
                    'tool_calls_count': tool_calls_count,
                }
                return

            # 中间 assistant 有 content 也展示（thinking）
            if msg.content:
                yield {'type': 'assistant_thinking', 'content': msg.content}

            # 执行 tool_calls
            tool_calls_for_audit = []
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or '{}')
                except json.JSONDecodeError:
                    args = {}

                yield {
                    'type': 'tool_call',
                    'iter': iteration + 1,
                    'tool': tool_name,
                    'args': args,
                }

                # 工程兜底：save_pet_event 同 (pet_id, event_type) 重复调直接拒
                # gpt-4o-mini 偶尔会把症状/情绪拆开存两次，或同事件重复
                if tool_name == 'save_pet_event':
                    key = (args.get('pet_id'), args.get('event_type'))
                    if key in saved_event_keys:
                        result = {
                            'ok': False,
                            'duplicate': True,
                            'reason': f'本轮已保存 event_type={key[1]} 事件，避免重复入库',
                        }
                        tool_calls_count += 1
                        truncated_result = _truncate_for_persist(result, 2000)
                        tool_calls_for_audit.append({
                            'tool': tool_name,
                            'args': args,
                            'result_summary': _summarize_result(result),
                            'result': truncated_result,
                        })
                        yield {
                            'type': 'tool_result',
                            'iter': iteration + 1,
                            'tool': tool_name,
                            'summary': _summarize_result(result),
                            'result': result,
                        }
                        messages.append({
                            'role': 'tool',
                            'tool_call_id': tc.id,
                            'content': json.dumps(result, ensure_ascii=False),
                        })
                        continue
                    saved_event_keys.add(key)

                fn = TOOL_DISPATCH.get(tool_name)
                if not fn:
                    result = {'ok': False, 'error': f'unknown tool: {tool_name}'}
                else:
                    try:
                        # reanalyze_image 优先用本轮图，没有时回退到历史图
                        ctx_image = image_path_str or historical_image_path
                        result = await asyncio.to_thread(
                            fn,
                            args,
                            {
                                'pet_id': pet_id,
                                'image_path': ctx_image,
                                'vlm_task': task,
                                # last_vlm_task: 同 task + 空 focus 时 reanalyze 返回 cached；换 task 允许
                                'last_vlm_task': (
                                    _vlm_task_for(task) if vlm_output
                                    else historical_vlm_task
                                ),
                                # VLM 输出给 reanalyze cached 兜底用（优先本轮，没有用历史）
                                'current_vlm_output': vlm_output,
                                'historical_vlm_output': historical_vlm_output,
                                'session': db,
                            },
                        )
                    except Exception as e:
                        result = {'ok': False, 'error': f'tool exception: {e}'}

                tool_calls_count += 1
                # 存完整 result（截断到 2KB 避免 db 膨胀）便于刷新还原
                truncated_result = _truncate_for_persist(result, max_chars=2000)
                tool_calls_for_audit.append({
                    'tool': tool_name,
                    'args': args,
                    'result_summary': _summarize_result(result),
                    'result': truncated_result,
                })

                yield {
                    'type': 'tool_result',
                    'iter': iteration + 1,
                    'tool': tool_name,
                    'summary': _summarize_result(result),
                    'result': result,
                }

                messages.append({
                    'role': 'tool',
                    'tool_call_id': tc.id,
                    'content': json.dumps(result, ensure_ascii=False)[:8000],
                })

            # 把这一轮（中间 thinking + tool 调用）持久化
            _persist_message(
                db,
                session_id=session_id,
                pet_id=pet_id,
                user_id=user_id,
                role='assistant',
                content=msg.content or '',
                tool_calls_json=json.dumps(tool_calls_for_audit, ensure_ascii=False),
                task=task,
                is_intermediate=True,  # 这一轮不是 final answer
            )

        # --- max iter ---
        print(f'[stream]   ⚠ max_iter_reached ({max_iter} iters used, tools={tool_calls_count})', flush=True)
        yield {'type': 'max_iter_reached'}
        elapsed = round(time.perf_counter() - t0, 2)
        yield {
            'type': 'done',
            'iterations': max_iter,
            'elapsed_s': elapsed,
            'tool_calls_count': tool_calls_count,
            'reached_max_iter': True,
        }
