"""构造注入 system prompt 的「当前宠物」上下文。

设计思想：每次 agent 启动自动准备好宠物档案 + 最近事件，
**减少 agent 反复调用 query_pet_history 的成本**——context engineering > tool engineering。
"""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Optional

from sqlmodel import Session, select

from app.db.models import Pet, PetEvent


SPECIES_ZH = {'cat': '猫', 'dog': '狗'}
GENDER_ZH = {'male': '公', 'female': '母', 'unknown': '未知'}


def compute_age_text(birthday: Optional[date]) -> str:
    if not birthday:
        return '未知'
    today = date.today()
    months = (today.year - birthday.year) * 12 + (today.month - birthday.month)
    if today.day < birthday.day:
        months -= 1
    if months < 12:
        return f'{months} 月龄'
    years = months // 12
    rem_months = months % 12
    if rem_months == 0:
        return f'{years} 岁'
    return f'{years} 岁 {rem_months} 月'


def build_pet_context(
    pet_id: int,
    session: Session,
    recent_events_limit: int = 5,
) -> str:
    """返回多行文本，注入到 system prompt。"""
    pet = session.get(Pet, pet_id)
    if not pet or pet.deleted_at:
        return '当前没有选定宠物。'

    species = SPECIES_ZH.get(pet.species, pet.species)
    gender = GENDER_ZH.get(pet.gender or '', pet.gender or '未知')
    age = compute_age_text(pet.birthday)

    lines = [
        f'当前宠物档案：',
        f'  - 名字：{pet.name}',
        f'  - 物种：{species}',
        f'  - 品种：{pet.breed or "未知"}',
        f'  - 年龄：{age}',
        f'  - 性别：{gender}',
        f'  - 体重：{pet.weight_kg or "未记录"} kg',
        f'  - 绝育：{"是" if pet.neutered else "否" if pet.neutered is False else "未知"}',
        f'  - pet_id：{pet.id}（调 tool 时用这个 ID）',
    ]

    # 记忆 V2：长期健康画像（LLM 摘要 → facts 模板降级 → 空串，永不阻塞）
    from app.agent.memory import get_health_summary_block
    summary_block = get_health_summary_block(pet_id, session)
    if summary_block:
        lines.append(summary_block)

    # 最近事件
    stmt = (
        select(PetEvent)
        .where(PetEvent.pet_id == pet_id)
        .order_by(PetEvent.happened_at.desc())
        .limit(recent_events_limit)
    )
    events = session.exec(stmt).all()

    if events:
        lines.append('')
        lines.append(f'最近 {len(events)} 条事件（从新到旧）：')
        for e in events:
            try:
                payload = json.loads(e.payload_json) if e.payload_json else {}
            except json.JSONDecodeError:
                payload = {}
            payload_str = json.dumps(payload, ensure_ascii=False) if payload else '{}'
            lines.append(f'  - id={e.id} {e.happened_at:%Y-%m-%d} [{e.event_type}] {payload_str}')
    else:
        lines.append('')
        lines.append('暂无事件记录。')

    return '\n'.join(lines)


def format_vlm_block(vlm_output: dict, task: str, label: str | None = None) -> str:
    """把 VLM 输出格式化为可读文本块。

    label: 自定义块标题；不传则默认"你看到的图片"。
        历史 VLM 注入时建议传 "你之前看到的图片（参考用，本轮主人未上传新图）"。
    """
    if not vlm_output or vlm_output.get('_error'):
        return ''
    if label:
        header = f'{label}，task={task}'
    else:
        header = f'你看到的图片（自动视觉分析，task={task}）'
    lines = [f'\n{header}：']
    lines.append(json.dumps(vlm_output, ensure_ascii=False, indent=2))
    return '\n'.join(lines)
