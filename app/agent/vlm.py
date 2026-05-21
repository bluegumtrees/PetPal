"""
VLM 调用模块 - 4 任务：
  symptom     症状识别
  emotion     情绪 / 肢体信号推断（不断言）
  bcs         WSAVA 9 分制体态评估
  pain_fgs    Feline Grimace Scale 5 AU 疼痛评分（Evangelista 2019）

设计要点：
- 走 OpenRouter，模型默认 gpt-4o-mini
- 图片本地 → Pillow resize 1024 → base64
- response_format=json_object 强制 JSON
- Pydantic 严格校验，失败重试 1 次（降温度 + 提示）
"""
from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path
from typing import Any, Literal, Optional

from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image
from pydantic import BaseModel, Field, ValidationError

load_dotenv()

Task = Literal['symptom', 'emotion', 'bcs', 'pain_fgs']


# ============ OpenAI client (lazy) ============

_client: Optional[OpenAI] = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = os.getenv('OPENROUTER_API_KEY')
        base_url = os.getenv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1')
        if not api_key or api_key == 'sk-or-v1-xxx':
            raise RuntimeError(
                'OPENROUTER_API_KEY missing or placeholder in .env. '
                'Copy .env.example to .env and fill the real key.'
            )
        _client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            default_headers={
                'HTTP-Referer': 'https://github.com/petpal',  # OpenRouter optional
                'X-Title': 'PetPal',
            },
        )
    return _client


# ============ Image utilities ============

def encode_image(image_path: str | Path, max_size: int = 1024,
                 quality: int = 85) -> str:
    """读图 → 转 RGB → 长边 max_size resize → JPEG → base64。"""
    img = Image.open(image_path)
    if img.mode != 'RGB':
        img = img.convert('RGB')
    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode('ascii')


# ============ Pydantic schemas ============

class SymptomResult(BaseModel):
    observation: str
    visible_details: list[str] = []  # 结构化罗列图中所有临床相关细节
    possible_symptoms: list[str]
    severity: Literal['low', 'medium', 'high']
    urgency: Literal['routine', 'within_24h', 'emergency']
    recommendation: str
    caveat: str = ''


class BodySignal(BaseModel):
    part: str
    state: str


class CandidateEmotion(BaseModel):
    emotion: str
    confidence: float = Field(..., ge=0.0, le=1.0)


class EmotionResult(BaseModel):
    observation: str
    body_signals: list[BodySignal]
    candidate_emotions: list[CandidateEmotion]
    caveat: str
    suggestion: str


class BCSResult(BaseModel):
    observation: str
    bcs_score: int = Field(..., ge=1, le=9)
    rationale: str
    diet_advice: str
    caveat: str = ''


class ActionUnit(BaseModel):
    name: Literal[
        'Ear position', 'Orbital tightening',
        'Muzzle tension', 'Whiskers change', 'Head position',
    ]
    score: int = Field(..., ge=0, le=2)
    rationale: str


class PainFGSResult(BaseModel):
    action_units: list[ActionUnit]
    total_score: int = Field(..., ge=0, le=10)
    max_score: int = 10
    normalized: float = Field(..., ge=0.0, le=1.0)
    interpretation: str
    recommendation: str
    caveat: str = ''
    source: str = 'Evangelista et al. 2019, Scientific Reports'


TASK_SCHEMA: dict[Task, type[BaseModel]] = {
    'symptom': SymptomResult,
    'emotion': EmotionResult,
    'bcs': BCSResult,
    'pain_fgs': PainFGSResult,
}


# ============ Prompts ============

SYMPTOM_PROMPT = """你是一位经验丰富的临床兽医。根据宠物照片识别可能的健康问题。
你的视觉描述会被下游 LLM 当作"它自己看到的图"用来回答主人——**所以观察要详细具体，不要简略**。

严格按以下 JSON schema 输出（字段名英文，内容中文）：
{
  "observation": "对图片观察的详细客观描述（3-5 句，覆盖所见部位、颜色、形状、数量、对称性、与周围/正常状态的对比等具体特征）",
  "visible_details": [
    "按需罗列图中所有临床相关细节（每条一短句，越具体越好）",
    "例如：部位 X 的颜色/形状/大小；分泌物 / 排泄物的颜色 / 质地 / 量；体表异常（红肿/脱毛/伤口）；姿态异常；周围环境；左右对称性；与正常状态的差异",
    "下游 LLM 会基于这些细节给主人具体建议——细节越多，回答越有用"
  ],
  "possible_symptoms": ["症状1", "症状2"],
  "severity": "low | medium | high",
  "urgency": "routine | within_24h | emergency",
  "recommendation": "给宠物主人的具体处置建议",
  "caveat": "不确定性或局限说明（可空字符串）"
}

要求：
1. **observation 必须详细**（至少 3 句），不要只写 1 句话
2. **visible_details 至少 3 条**——只要图里有东西就罗列出来；图里啥都没有（如纯白背景）才允许少于 3 条
3. severity 反映医学严重度；urgency 反映就医时间窗
4. 不要捏造，看不到的不要说；看不见的部位明确标注"不可见"
5. 急诊红线（呕血、便血、呼吸困难、抽搐、休克体征）一律 severity=high + urgency=emergency
6. 若图中是无症状的健康宠物或非动物物体，possible_symptoms 给空数组，severity=low（但 observation 和 visible_details 仍要描述图中看到的东西）
"""

EMOTION_PROMPT = """你是资深的猫狗行为学家（Feline / Canine Behaviorist）。
**重要约束：单张静态图不能可靠判断持续情绪，只能识别此刻的肢体信号。**

严格按以下 JSON schema 输出（字段名英文，内容中文）：
{
  "observation": "对图片中宠物的客观描述",
  "body_signals": [
    {"part": "耳朵", "state": "略向后侧倾"},
    {"part": "瞳孔", "state": "正常竖瞳"},
    {"part": "尾巴", "state": "卷在身侧"},
    {"part": "姿势", "state": "蜷缩坐姿"}
  ],
  "candidate_emotions": [
    {"emotion": "警觉/轻度紧张", "confidence": 0.6},
    {"emotion": "放松观察", "confidence": 0.3},
    {"emotion": "恐惧", "confidence": 0.1}
  ],
  "caveat": "单张图无法判断动态信号（尾巴抽打频率、呼吸节奏），建议视频或现场持续观察 30 秒",
  "suggestion": "实用建议"
}

要求：
1. **绝不断言情绪**，必须给出 2-4 个 candidate_emotions + confidence
2. confidence 总和接近 1.0（容忍 ±0.05）
3. body_signals 至少覆盖：耳朵、瞳孔/眼睛、尾巴、姿势 4 项
4. 看不到的部位明确写"不可见"
"""

BCS_PROMPT = """你是一位宠物营养医师，按 WSAVA 9 分制 Body Condition Score 评估宠物体态。

严格按以下 JSON schema 输出（字段名英文，内容中文）：
{
  "observation": "图片中宠物的体型、姿势描述",
  "bcs_score": 1-9 的整数,
  "rationale": "评分依据：肋骨/腰部/腹线的可见度",
  "diet_advice": "饮食建议",
  "caveat": "局限说明"
}

评分标准（WSAVA 9 分制）:
- 1/9 极瘦：肋骨脊椎可见无脂肪
- 2/9 很瘦：肋骨易见
- 3/9 偏瘦：肋骨易触及，皮下脂肪很少
- 4/9 略瘦：肋骨易触，薄层脂肪覆盖
- 5/9 理想：肋骨可触不可见，腰部明显
- 6/9 略胖：肋骨稍难触及
- 7/9 偏胖：肋骨难触及，无腰
- 8/9 很胖：肋骨需用力按
- 9/9 极胖：肋骨摸不到，脂肪明显

要求：
1. 侧身全身照评分准确度最高；正面/背面照在 caveat 注明"角度限制"
2. 看不见的部位不要捏造，反映在 rationale 中
3. 若图非全身（仅头部或半身），bcs_score 保守给 5 + caveat="无法评分"
"""

PAIN_FGS_PROMPT = """你是 Feline Behaviorist + 兽医，使用 Feline Grimace Scale (FGS) 评估猫的疼痛。
FGS 是 Evangelista 等 2019 年发表在 Scientific Reports 的同行评议工具。

严格按以下 5 个 Action Units 评分（0/1/2），输出 JSON：
{
  "action_units": [
    {"name": "Ear position",        "score": 0, "rationale": "..."},
    {"name": "Orbital tightening",  "score": 0, "rationale": "..."},
    {"name": "Muzzle tension",      "score": 0, "rationale": "..."},
    {"name": "Whiskers change",     "score": 0, "rationale": "..."},
    {"name": "Head position",       "score": 0, "rationale": "..."}
  ],
  "total_score": 0,
  "max_score": 10,
  "normalized": 0.0,
  "interpretation": "解释总分与 0.39 临床阈值的关系",
  "recommendation": "处置建议",
  "caveat": "局限说明",
  "source": "Evangelista et al. 2019, Scientific Reports"
}

判定标准（来自 FGS 训练手册）:

1. **Ear position** 耳朵位置
   - 0 = 双耳朝前（ears facing forward）
   - 1 = 双耳略向外侧分开（slightly pulled apart）
   - 2 = 双耳明显向外侧旋转/侧贴（markedly rotated outwards）

2. **Orbital tightening** 眼睑紧张
   - 0 = 眼睛睁开（eyes opened）
   - 1 = 眼睑半闭（partially closed）
   - 2 = 眯成缝（squinted）

3. **Muzzle tension** 口鼻紧张
   - 0 = 口鼻放松圆形（relaxed, round shape）
   - 1 = 轻度紧张（mild tension）
   - 2 = 紧绷椭圆形（tense, elliptical shape）

4. **Whiskers change** 胡须变化
   - 0 = 胡须松弛弯曲（loose and curved）
   - 1 = 略直略前移（slightly straight）
   - 2 = 笔直前指（straight and moving forward, away from face）

5. **Head position** 头部位置
   - 0 = 头部高于肩线（head above shoulder line）
   - 1 = 头部与肩平（aligned with shoulder line）
   - 2 = 头部低于肩线或下垂（below shoulder line / tilted down）

阈值：normalized > 0.39（即总分 ≥ 4/10）= 临床显著疼痛，需镇痛干预。

要求：
1. 5 个 AU **全部输出**，不可缺
2. 看不到的部位 score 给 0 + rationale 注明"图中不可见"
3. **不要把"紧张/警觉"误判为疼痛**——FGS 是疼痛专用工具，紧张应走 emotion 任务
4. 若图中是狗或其他非猫动物，所有 score=0 + caveat="FGS 仅适用于猫"
5. total_score 必须等于 5 个 score 的和，normalized = total_score / 10
"""

TASK_PROMPT: dict[Task, str] = {
    'symptom': SYMPTOM_PROMPT,
    'emotion': EMOTION_PROMPT,
    'bcs': BCS_PROMPT,
    'pain_fgs': PAIN_FGS_PROMPT,
}


# ============ Main API ============

def analyze(
    image_path: str | Path,
    task: Task,
    species: Optional[str] = None,
    extra: Optional[str] = None,
    model: Optional[str] = None,
) -> dict[str, Any]:
    """VLM 单图分析。

    Args:
        image_path: 本地图片路径
        task: 'symptom' | 'emotion' | 'bcs' | 'pain_fgs'
        species: 可选，'猫' / '狗' 等辅助提示
        extra: 可选，主人附加描述（"今天没吃饭"）
        model: 默认 .env 的 VLM_MODEL

    Returns:
        Pydantic 校验后的 dict
    """
    if task not in TASK_PROMPT:
        raise ValueError(f'Unknown task: {task}; allowed: {list(TASK_PROMPT)}')

    system_prompt = TASK_PROMPT[task]
    schema_cls = TASK_SCHEMA[task]

    parts = []
    if species:
        parts.append(f'宠物种类：{species}')
    if extra:
        parts.append(f'主人补充描述：{extra}')
    parts.append('请严格按 system 中的 JSON schema 评估这张图。')
    user_text = '\n'.join(parts)

    img_b64 = encode_image(image_path)
    client = get_client()
    model_name = model or os.getenv('VLM_MODEL', 'openai/gpt-4o-mini')

    def call(temperature: float, retry_hint: str = '') -> str:
        sys_content = system_prompt
        if retry_hint:
            sys_content += '\n\n' + retry_hint
        resp = client.chat.completions.create(
            model=model_name,
            messages=[
                {'role': 'system', 'content': sys_content},
                {
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': user_text},
                        {
                            'type': 'image_url',
                            'image_url': {
                                'url': f'data:image/jpeg;base64,{img_b64}',
                            },
                        },
                    ],
                },
            ],
            response_format={'type': 'json_object'},
            temperature=temperature,
            max_tokens=1500,
        )
        return resp.choices[0].message.content or '{}'

    # 第一轮：低温
    raw = call(temperature=0.2)
    try:
        return schema_cls(**json.loads(raw)).model_dump()
    except (json.JSONDecodeError, ValidationError) as e:
        # 第二轮：零温 + 错误提示
        print(f'[vlm/{task}] first parse failed: {type(e).__name__}: {str(e)[:200]}')
        hint = (
            '严重提醒：上次输出不符合 schema。'
            '请只输出一个合法 JSON 对象，所有字段都按 schema 完整给出，不要带 markdown 代码块。'
        )
        raw2 = call(temperature=0.0, retry_hint=hint)
        try:
            return schema_cls(**json.loads(raw2)).model_dump()
        except (json.JSONDecodeError, ValidationError) as e2:
            # 第二次还失败：返回原始 raw + error 标记
            return {
                '_error': 'schema_validation_failed_twice',
                '_error_detail': str(e2)[:300],
                '_raw_first': raw,
                '_raw_second': raw2,
            }
