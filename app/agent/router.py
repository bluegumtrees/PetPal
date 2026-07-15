"""Task router：根据用户文字（+ 是否有图）分类到 5 个 task 之一。

用便宜文本模型做意图分类（比让 VLM 看图后再决定 task 便宜 5-10×）。
"""
from __future__ import annotations

import json
import os
from typing import Literal, Optional

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

Task = Literal['chat', 'symptom', 'emotion', 'bcs', 'pain_fgs']

_client: Optional[OpenAI] = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.getenv('OPENROUTER_API_KEY'),
            base_url=os.getenv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
        )
    return _client


ROUTER_PROMPT = """你是 PetPal 的意图分类器。根据用户消息判断属于以下哪类：

- chat: 闲聊/分享/感性发言/对宠物的赞美感慨（无明确医学/行为询问）
- symptom: 描述医学症状或异常（呕吐/腹泻/咳嗽/受伤/拒食/出血/中毒等）
- emotion: 询问宠物情绪/行为状态（"它今天怎么了"、"为什么躲起来"、"是不是生气了"）
- bcs: 询问体态/胖瘦/体重/体型评估
- pain_fgs: 询问宠物是否疼痛/不舒服/痛苦（强调"疼"或"不舒服"）

只输出 JSON：{"task": "..."}
"""


_HINT_KEYWORDS: dict[Task, tuple[str, ...]] = {
    'bcs':       ('BCS', '体态', '胖瘦', '体重', '侧照', '侧身', '全身', '上传一张', '拍张', '照片'),
    'pain_fgs':  ('FGS', '疼痛', '疼不疼', '镇痛', 'Grimace'),
    'emotion':   ('情绪', '心情', '行为', '紧张', '放松', '焦虑', '肢体语言'),
    'symptom':   ('症状', '呕吐', '腹泻', '咳嗽', '皮肤', '受伤', '出血'),
}


def _infer_from_hint(hint: str) -> Task:
    """看最近 assistant 内容含哪类关键词，推断用户接下来要做的 task。"""
    for task, kws in _HINT_KEYWORDS.items():
        if any(k in hint for k in kws):
            return task
    return 'chat'


def classify_task(text: str, has_image: bool, recent_assistant_hint: str | None = None) -> Task:
    """根据用户文字 + 是否带图（+ 上轮 assistant 提示），返回 5 task 之一。

    规则：
    - 无文字 + 无图 → ValueError
    - 无文字 + 有图：
        * 若 recent_assistant_hint 含「体态/疼痛/情绪/症状」类关键词 → 继承对应 task
        * 否则 → 'chat'（默认温和回应，不强行医学化）
    - 有文字 → LLM router 决定
    """
    text = (text or '').strip()
    if not text and not has_image:
        raise ValueError('empty input: need text or image')
    if not text and has_image:
        if recent_assistant_hint:
            inferred = _infer_from_hint(recent_assistant_hint)
            if inferred != 'chat':
                return inferred
        return 'chat'

    client = _get_client()
    model = os.getenv('LLM_MODEL', 'openai/gpt-4o-mini')

    extra_hint = '\n（注：用户同时附了图片）' if has_image else ''

    resp = client.chat.completions.create(
        model=model,
        messages=[
            {'role': 'system', 'content': ROUTER_PROMPT},
            {'role': 'user', 'content': f'用户消息：{text}{extra_hint}'},
        ],
        response_format={'type': 'json_object'},
        temperature=0.0,
        max_tokens=20,
    )
    raw = resp.choices[0].message.content or '{}'
    try:
        data = json.loads(raw)
        task = data.get('task', 'chat')
        if task not in ('chat', 'symptom', 'emotion', 'bcs', 'pain_fgs'):
            return 'chat'
        # 视觉评估任务（emotion/bcs/pain_fgs）没图跑不了 VLM——
        # 纯文字的"焦虑/胖瘦/疼吗"类咨询降级为 chat 走 RAG 咨询路径
        if task in ('emotion', 'bcs', 'pain_fgs') and not has_image:
            return 'chat'
        return task
    except json.JSONDecodeError:
        return 'chat'
