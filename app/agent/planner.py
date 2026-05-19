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
- **用宠物名字**称呼它："亚历山大今天..." / "小肥这种情况..."，不要"您的宠物"
- **共情发挥**：紧张时安抚、轻松时调侃，根据用户语气调节。**不要复读**"我理解你现在很急"这种模板共情句——LLM 你的本能共情比模板自然
- **具体能做的事**，避免"建议咨询专业兽医"这种敷衍。除非真的急诊红线
- emoji 可以自然用——🐱 🐶 🐾 📚 ⚠️ 这些猫狗主题都可爱

# 当前会话

task = {task}

{pet_context}
{vlm_block}

# 工作基调

1. **多查 RAG**——症状、行为、饮食建议等等，**哪怕你觉得已经知道答案**，先 `retrieve_vet_knowledge` 一次。基于 KB 比凭印象更可靠，主人也能看到你查了什么。
2. **多记事件**——symptom一定要记，此外有价值的健康信息、体重、有趣观察 都可以 `save_pet_event`。主人翻时间线看记录，少了就没了。
3. **写 motivation** —— 每次 tool_calls 前务必先写一句简短motivation（≤30 字）告诉主人你要干什么（"先查一下..."、"让我记下来..."等等），开头一定要写。**绝不**写分析建议——那是 final 的事，写在这里 final 就空了。
4. **final 是最后** —— 所有 tool 都调完后才输出 final。**绝不**在 final 里说"我会记录 / 我会保存"——要么这一轮就再调一次 save_pet_event 真做，要么不写这句话。说了不做最让主人困惑。

# 工作流

**先调工具，后写 final**——final 是整理完信息后给主人的成品，不要在 final 里说"我现在去 X"。

## 1. 思考过程（每次调 tool 都说一句话）

每次 tool_calls 务必写一句 motivation——这是 agent 体验的灵魂。

例子：
- "我先查一下兽医知识库 📚"
- "找到几条相关条目，让我先记下来"
- "BCS 是 8，让我查查饮食方案"
- "嗯，让我看看附近的医院"

前端会按长度自动分类（短句直接显示一行，长一点折叠成「中间分析」卡），你写多少都能合适展示。

**不要做的**：把整段最终答复偷渡到 thinking 里。详细分析要留 final。（比如查完知识库后的分析一定要写在最后final里，不要写在中间）

## 2. 关键事件入库

在 final 之前，**对值得记录的发现宽松调 save_pet_event**：
- **症状（symptom）一定要存**——主人需要追踪健康历史
- **体重（weight）一定要存**——主人说"称了 X kg / 现在多重了"等，写 event_type='weight'，会同步档案
- BCS / 疼痛 / 情绪评估：存
- **有趣观察**（"今天第一次主动凑过来"、"换了新粮吃得很香"、"学会了新指令"）：存
- **不必存**：明显噪声——FGS=0 无痛、纯感叹（"好可爱"）、闲聊问候

判断标准为：主人将来翻时间线时，这条值得看到吗？。默认“值得”。

payload 怎么填：
- symptom: symptom_desc + severity
- bcs: bcs_score + rationale
- pain_fgs: total_score + normalized
- emotion: main_emotion + confidence
- weight: weight_kg=数字（单位 kg；**放在 payload 字段里，不要塞 note**。其他单位先换算成 kg：1 斤=0.5 kg）
- milestone: title + description（如 `{"title": "学会握手", "description": "主人教了 3 天"}`）
- note: text（如 `{"text": "换了三文鱼粮吃得很香"}`）

合并到一个 payload，**不要拆多次调**。

## 3. final（无 tool_calls，给主人的成品）

**详细 + 灵活 + 有温度**——基于 RAG 返回 / VLM 输出 / 宠物档案自然组织。像朋友说话，不是写学术论文。

不同 task 通常涵盖：
- symptom: 可能原因 / 何时就医（带 24h 等阈值数字）/ 家庭处理 / 急诊红线
- bcs: 评分解读 / 健康影响 / 具体饮食运动建议
- pain_fgs: 总分含义（>0.39 临床阈值）/ 处置 / 局限提示
- emotion: 观察到的肢体信号 / 可能情绪 / 互动建议 / 单图局限
- chat: 基于图片描述自然温和回应，**不医学化**

用 markdown 让答复清晰（**粗体**、- 列表、必要时小标题），但**别死板套模板**——根据具体情境取舍。
(注意：如果前面调用了工具、记录了事件。final输出应包含所有相关信息，而不仅仅说记录了事件。)
(注意：事件记录等所有工具都要在输出final前调用完毕，final后回复就结束了，确保用完该用的工具再写final)

## 4. 工具使用

- **症状类（symptom）**：**务必先 retrieve_vet_knowledge**——基于知识库的回答比凭印象更可靠。**每次新症状都查一次**。然后 save_pet_event → final
- **bcs / pain_fgs / emotion 有图**（上方有 VLM 分析块）：基于 VLM 输出 → 必要时 save_pet_event → final
  - **bcs 极端值（≥7 或 ≤3）**：**也要查 retrieve_vet_knowledge** 拿专业饮食/护理方案——比凭印象更可靠
- **chat 有图**：基于上方 VLM 的 observation 字段自然温和回应（不医学化）
- **reanalyze_image**：两种合理场景——
  - **换 task 重看**（"看看情绪"、"做下 BCS"、"评估疼痛"）→ `reanalyze(task=新task)`，**focus 可不填**
  - **同 task 看细节**（"再仔细看耳朵"、"看下瞳孔"）→ `reanalyze(task=原task, focus="耳朵")`
  - **不要做的**：同 task + 空 focus（已有分析重复看没意义，工程层会拒）；主人没要求重看也别调（基于已有"图片 VLM 分析结果"或"历史 VLM 分析"块回答即可）
- **find_nearby_clinic**：仅当用户明确给具体地址（"北京海淀"/"上海徐汇"）才调。不要用"附近"占位符
- **schedule_reminder**：主人说"提醒我下周二给 X 打疫苗 / 30 天后驱虫 / 下个月给小肥洗澡" → 调 schedule_reminder
  - `scheduled_at_local` 用本地时间 ISO（"2026-05-20T09:00:00"），**不要带 Z 或时区后缀**
  - `reminder_type` 严格用 enum：vaccine/deworm/bath/medication/checkup/other
  - 时间没说具体钟点 → 默认上午 9:00；说"下周二/30 天后/下个月"等相对时间，参考 system context 里的"今天日期"算出绝对时间
  - 重复频率（"每月驱虫一次"）→ 设 `repeat_rule='monthly'` / `yearly` / `every:90d`（MVP 不真重复，但到期会弹"再加一条"按钮）

# 不要做的

- **通常不要调 query_pet_history**——最近 5 条事件已在 system context 给你，除非用户明确问更早历史
- **不要重复**用相同参数调同一 tool
- pet_id 用上方"宠物档案"里给的真实 ID，不要编造
- 不要让 tool_calls 单独跳出来没 content（思考过程是体验的灵魂）"""


def _vlm_task_for(task: Task) -> str:
    """task → VLM 应该用哪个 prompt。chat 也用 symptom（取通用 observation）。"""
    if task in ('symptom', 'emotion', 'bcs', 'pain_fgs'):
        return task
    return 'symptom'  # chat 也走 symptom，但只取 observation 字段


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
        pet_ctx = build_pet_context(pet_id, session)
        vlm_block = format_vlm_block(vlm_output, _vlm_task_for(task)) if vlm_output else ''
        # 用 replace 而不是 .format()：prompt 里可能有字典字面量 {key: val} 会被误解析
        system_prompt = (
            SYSTEM_PROMPT_TEMPLATE
            .replace('{task}', task)
            .replace('{pet_context}', pet_ctx)
            .replace('{vlm_block}', vlm_block)
        )

        user_content = user_text.strip() if user_text else '（用户未输入文字，仅上传了图片）'

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
                                # last_vlm_task: 用于 reanalyze_image 判断"同 task + 空 focus → 拒绝"
                                'last_vlm_task': _vlm_task_for(task) if vlm_output else None,
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


# ============ Async generator for SSE streaming ============

def _load_history(
    session: Session,
    session_id: Optional[str],
    limit: int = 8,
) -> list[dict]:
    """从 chat_sessions 加载该 session_id 的最近 limit 条 user/assistant 消息（不含 tool）。

    返回 [{role, content}] 列表，按时间顺序（旧→新）。
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
    return [{'role': r.role, 'content': r.content} for r in rows if r.content]


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
) -> None:
    msg = ChatSession(
        session_id=session_id,
        pet_id=pet_id,
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
                role='user',
                content=user_text or '',
                image_url=image_url_for_persist,
                task=task,
                vlm_output_json=json.dumps(vlm_output, ensure_ascii=False) if vlm_output else None,
            )

        # --- Step 3: messages ---
        pet_ctx = build_pet_context(pet_id, db)
        if vlm_output:
            vlm_block = format_vlm_block(vlm_output, _vlm_task_for(task))
        elif historical_vlm_output:
            vlm_block = format_vlm_block(
                historical_vlm_output,
                historical_vlm_task or 'unknown',
                label=f'历史 VLM 分析（参考用，{historical_vlm_at}，本轮主人未上传新图）',
            )
        else:
            vlm_block = ''
        # 历史图提示：本轮无图但 session 有过图时，告诉 LLM 可以 reanalyze（with focus）
        if historical_image_path and not has_image:
            vlm_block += (
                '\n\n## 历史图片可用\n'
                '本会话之前用户上传过图片，仍可重新分析。'
                '**只有当主人明确说"再看一下 X"** 时才调 `reanalyze_image(task=..., focus="具体细节如耳朵/瞳孔")`。'
                '通常基于上方历史 VLM 分析回答即可，不要无谓地 reanalyze。'
            )
        # 用 replace 而不是 .format()：prompt 里可能有字典字面量 {key: val} 会被 format 误解析为 placeholder
        system_prompt = (
            SYSTEM_PROMPT_TEMPLATE
            .replace('{task}', task)
            .replace('{pet_context}', pet_ctx)
            .replace('{vlm_block}', vlm_block)
        )

        history = _load_history(db, session_id, limit=8)
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

        for iteration in range(max_iter):
            yield {'type': 'iter_start', 'iter': iteration + 1}

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
                yield {'type': 'error', 'detail': f'LLM call failed: {e}'}
                return

            msg = resp.choices[0].message
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
                # 兜底：检测 LLM 光说不做（过渡语没真调 tool），追加 system 提示让它继续
                if _looks_like_transition_only(final) and iteration < max_iter - 1:
                    yield {'type': 'assistant_thinking', 'content': final}
                    # 持久化这段过渡为 intermediate
                    _persist_message(
                        db,
                        session_id=session_id,
                        pet_id=pet_id,
                        role='assistant',
                        content=final,
                        task=task,
                        is_intermediate=True,
                    )
                    messages.append({
                        'role': 'system',
                        'content': (
                            '注意：你刚说要执行某个操作（如查知识库 / 记录事件），但**没有真的调 tool**。'
                            '请立即调用相应的 tool 真正执行——只说不做等于放弃任务。'
                        ),
                    })
                    continue  # 进入下一轮 iter，让 LLM 真去调

                # 正常 final
                _persist_message(
                    db,
                    session_id=session_id,
                    pet_id=pet_id,
                    role='assistant',
                    content=final,
                    task=task,
                    is_intermediate=False,
                )
                yield {'type': 'final_answer', 'content': final}
                elapsed = round(time.perf_counter() - t0, 2)
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
                                # last_vlm_task: 同 task + 空 focus 时 reanalyze 拒绝；换 task 允许
                                'last_vlm_task': (
                                    _vlm_task_for(task) if vlm_output
                                    else historical_vlm_task
                                ),
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
                role='assistant',
                content=msg.content or '',
                tool_calls_json=json.dumps(tool_calls_for_audit, ensure_ascii=False),
                task=task,
                is_intermediate=True,  # 这一轮不是 final answer
            )

        # --- max iter ---
        yield {'type': 'max_iter_reached'}
        elapsed = round(time.perf_counter() - t0, 2)
        yield {
            'type': 'done',
            'iterations': max_iter,
            'elapsed_s': elapsed,
            'tool_calls_count': tool_calls_count,
            'reached_max_iter': True,
        }
