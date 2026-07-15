"""记忆 V2：滚动健康画像（docs/memory_v2_design.md 的实现）。

三个层次，逐级降级、永不阻塞聊天路径：
1. summary_text（LLM 增量归纳，水位线触发后台再生）——最好
2. facts 模板文本（确定性代码即时计算，无 LLM 依赖）——摘要缺失/过旧时的兜底
3. 出任何异常 → 返回空串，context 组装照常

facts 由代码算、summary 由 LLM 写：关键数字永远可审计、可再生。
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlmodel import Session, select

from app.db.models import Pet, PetEvent, PetHealthSummary

# LLM 归纳触发水位：自上次归纳起新增事件数
REGEN_EVENT_THRESHOLD = 8
# 摘要视为过旧的天数（过旧则降级用 facts 模板，同时后台再生）
STALE_DAYS = 30

_inflight_lock = threading.Lock()
_inflight_pets: set[int] = set()


# ---------------- 确定性 facts ----------------

def compute_health_facts(pet_id: int, session: Session, window_days: int = 180) -> dict[str, Any]:
    """从 pet_events 确定性计算关键健康事实（不经 LLM，随时可重算）。"""
    since = datetime.now() - timedelta(days=window_days)
    events = session.exec(
        select(PetEvent)
        .where(PetEvent.pet_id == pet_id, PetEvent.happened_at >= since)
        .order_by(PetEvent.happened_at.asc())
    ).all()

    def payload(e: PetEvent) -> dict:
        try:
            return json.loads(e.payload_json) if e.payload_json else {}
        except json.JSONDecodeError:
            return {}

    facts: dict[str, Any] = {'window_days': window_days, 'events_total': len(events)}

    weights = [(e.happened_at, payload(e).get('weight_kg')) for e in events
               if e.event_type == 'weight' and isinstance(payload(e).get('weight_kg'), (int, float))]
    if weights:
        (t0, w0), (t1, w1) = weights[0], weights[-1]
        facts['weight_trend'] = {
            'start_kg': w0, 'current_kg': w1,
            'delta_kg': round(w1 - w0, 2),
            'delta_pct': round((w1 - w0) / w0 * 100, 1) if w0 else None,
            'from': t0.strftime('%Y-%m-%d'), 'to': t1.strftime('%Y-%m-%d'),
            'points': len(weights),
        }

    for etype, key in (('vaccine', 'last_vaccine'), ('grooming', 'last_grooming')):
        rows = [e for e in events if e.event_type == etype]
        if rows:
            e = rows[-1]
            label = payload(e).get('vaccine_name') or payload(e).get('description') or ''
            facts[key] = {'date': e.happened_at.strftime('%Y-%m-%d'), 'what': label[:40]}

    # 驱虫历史上记在 note 里，关键词识别
    deworm = [e for e in events if e.event_type == 'note' and '驱虫' in (payload(e).get('text') or '') + (e.note or '')]
    if deworm:
        facts['last_deworm'] = {'date': deworm[-1].happened_at.strftime('%Y-%m-%d')}

    recent_30 = datetime.now() - timedelta(days=30)
    concerns = [e for e in events
                if e.event_type == 'symptom' and e.happened_at >= recent_30
                and payload(e).get('severity') in ('medium', 'high', 'critical')]
    facts['open_concerns'] = [
        {'date': e.happened_at.strftime('%m-%d'),
         'desc': (payload(e).get('symptom_desc') or '')[:40],
         'severity': payload(e).get('severity')}
        for e in concerns[-3:]
    ]

    resolved = [e for e in events
                if e.event_type == 'symptom' and e.happened_at < recent_30]
    if resolved:
        e = resolved[-1]
        facts['last_resolved_symptom'] = {
            'date': e.happened_at.strftime('%Y-%m-%d'),
            'desc': (payload(e).get('symptom_desc') or '')[:40],
        }

    for etype, key, field in (('bcs', 'bcs_latest', 'bcs_score'), ('pain_fgs', 'fgs_latest', 'total_score')):
        rows = [e for e in events if e.event_type == etype and payload(e).get(field) is not None]
        if rows:
            e = rows[-1]
            facts[key] = {'date': e.happened_at.strftime('%Y-%m-%d'), 'score': payload(e).get(field)}

    miles = [e for e in events if e.event_type == 'milestone']
    facts['milestones_recent'] = [
        {'date': e.happened_at.strftime('%m-%d'),
         'title': (payload(e).get('title') or e.note or '')[:30]}
        for e in miles[-2:]
    ]
    return facts


def facts_to_template_text(facts: dict[str, Any], pet_name: str) -> str:
    """降级路径：facts → 确定性中文摘要（无 LLM）。"""
    parts: list[str] = []
    wt = facts.get('weight_trend')
    if wt:
        direction = '下降' if wt['delta_kg'] < 0 else '上升' if wt['delta_kg'] > 0 else '持平'
        parts.append(
            f"体重近 {facts['window_days']} 天 {wt['start_kg']}→{wt['current_kg']}kg"
            f"（{direction} {abs(wt['delta_kg'])}kg / {wt['delta_pct']}%，{wt['points']} 次记录）")
    if facts.get('bcs_latest'):
        parts.append(f"最近体态 BCS {facts['bcs_latest']['score']}/9（{facts['bcs_latest']['date']}）")
    if facts.get('fgs_latest'):
        parts.append(f"最近疼痛 FGS {facts['fgs_latest']['score']}/10（{facts['fgs_latest']['date']}）")
    if facts.get('last_vaccine'):
        lv = facts['last_vaccine']
        parts.append(f"上次疫苗 {lv['date']}" + (f"（{lv['what']}）" if lv.get('what') else ''))
    if facts.get('last_deworm'):
        parts.append(f"上次驱虫 {facts['last_deworm']['date']}")
    if facts.get('last_grooming'):
        parts.append(f"上次洗护 {facts['last_grooming']['date']}")
    if facts.get('open_concerns'):
        cs = '；'.join(f"{c['date']} {c['desc']}({c['severity']})" for c in facts['open_concerns'])
        parts.append(f"近 30 天在关注：{cs}")
    elif facts.get('last_resolved_symptom'):
        ls = facts['last_resolved_symptom']
        parts.append(f"近 30 天无新症状；更早的「{ls['desc']}」（{ls['date']}）已恢复")
    if facts.get('milestones_recent'):
        ms = '、'.join(f"{m['title']}({m['date']})" for m in facts['milestones_recent'])
        parts.append(f"里程碑：{ms}")
    if not parts:
        return ''
    return f"{pet_name} 的关键事实：" + '；'.join(parts) + '。'


# ---------------- 注入块（聊天路径唯一入口） ----------------

def get_health_summary_block(pet_id: int, session: Session) -> str:
    """返回注入 system prompt 的「长期健康画像」块；任何异常返回空串。"""
    try:
        pet = session.get(Pet, pet_id)
        if not pet:
            return ''
        row = session.exec(
            select(PetHealthSummary).where(PetHealthSummary.pet_id == pet_id)
        ).first()

        text: Optional[str] = None
        if row and row.summary_text:
            age_days = (datetime.now() - row.generated_at).days
            if age_days <= STALE_DAYS:
                text = row.summary_text
        if not text:
            facts = compute_health_facts(pet_id, session)
            text = facts_to_template_text(facts, pet.name)
        if not text:
            return ''
        return (
            '\n长期健康画像（系统自动维护，跨越最近半年，比"最近事件"看得更远）：\n'
            f'{text}\n'
            '——回答"总结/回顾/上次某事是什么时候"这类问题时优先引用画像；'
            '画像+最近事件已足够时不必调 query_pet_history。'
        )
    except Exception:
        return ''


# ---------------- LLM 归纳 + 水位线触发 ----------------

_SUMMARIZE_PROMPT = """你是宠物健康档案归纳器。基于【关键事实】和【新事件】，把【旧画像】更新为新的健康画像。

要求：
- ≤300 字，直接输出画像正文，不要标题/开场白
- 按顺序覆盖：体重体态趋势 → 已解决的健康事件 → 进行中的关注点 → 行为与里程碑
- 日期用相对表述（如"三个月前绝育"，今天是 {today}）
- 只做事实归纳，禁止诊断措辞和建议
- 数字必须与【关键事实】一致，不得编造"""


def generate_summary_llm(pet_id: int, session: Session, since_event_id: int = 0) -> bool:
    """全量/增量归纳并落库。返回是否成功（失败不抛，降级路径兜底）。"""
    from app.agent.planner import _get_client  # 延迟导入避免环

    pet = session.get(Pet, pet_id)
    if not pet:
        return False
    facts = compute_health_facts(pet_id, session)
    row = session.exec(
        select(PetHealthSummary).where(PetHealthSummary.pet_id == pet_id)
    ).first()
    old_text = (row.summary_text or '') if row else ''

    new_events = session.exec(
        select(PetEvent)
        .where(PetEvent.pet_id == pet_id, PetEvent.id > (row.events_covered if row else 0))
        .order_by(PetEvent.happened_at.asc())
    ).all()
    ev_lines = []
    for e in new_events[-30:]:
        ev_lines.append(f'{e.happened_at:%Y-%m-%d} [{e.event_type}] {e.payload_json[:120]} {e.note or ""}')

    model = os.getenv('LLM_MODEL', 'openai/gpt-4o-mini')
    try:
        resp = _get_client().chat.completions.create(
            model=model,
            messages=[
                {'role': 'system', 'content': _SUMMARIZE_PROMPT.replace('{today}', datetime.now().strftime('%Y-%m-%d'))},
                {'role': 'user', 'content': (
                    f'宠物：{pet.name}（{pet.species}，{pet.breed or "品种未知"}）\n\n'
                    f'【关键事实】\n{json.dumps(facts, ensure_ascii=False, indent=1)}\n\n'
                    f'【旧画像】\n{old_text or "（无）"}\n\n'
                    f'【新事件】\n' + ('\n'.join(ev_lines) or '（无）')
                )},
            ],
            temperature=0.3,
            max_tokens=600,
        )
        text = (resp.choices[0].message.content or '').strip()
        if not text:
            return False
    except Exception as e:
        print(f'[memory] summarize failed pet={pet_id}: {str(e)[:80]}', flush=True)
        return False

    max_event_id = max((e.id for e in new_events), default=(row.events_covered if row else 0))
    if row is None:
        row = PetHealthSummary(pet_id=pet_id)
    row.summary_text = text
    row.facts_json = json.dumps(facts, ensure_ascii=False)
    row.events_covered = max_event_id or 0
    row.generated_at = datetime.now()
    row.model = model
    session.add(row)
    session.commit()
    print(f'[memory] summary regenerated pet={pet_id} ({len(text)}ch, watermark={row.events_covered})', flush=True)
    return True


def maybe_schedule_regen(pet_id: int) -> None:
    """save_pet_event 后调用：新增事件数过水位 → 后台线程再生（不阻塞聊天）。"""
    try:
        from app.db.database import session_scope
        with session_scope() as s:
            row = s.exec(
                select(PetHealthSummary).where(PetHealthSummary.pet_id == pet_id)
            ).first()
            watermark = row.events_covered if row else 0
            fresh = s.exec(
                select(PetEvent.id).where(PetEvent.pet_id == pet_id, PetEvent.id > watermark)
            ).all()
            if len(fresh) < REGEN_EVENT_THRESHOLD and row is not None:
                return
        with _inflight_lock:
            if pet_id in _inflight_pets:
                return
            _inflight_pets.add(pet_id)

        def _worker():
            try:
                from app.db.database import session_scope as scope
                with scope() as s2:
                    generate_summary_llm(pet_id, s2)
            finally:
                with _inflight_lock:
                    _inflight_pets.discard(pet_id)

        threading.Thread(target=_worker, daemon=True, name=f'memory-regen-{pet_id}').start()
    except Exception:
        pass
