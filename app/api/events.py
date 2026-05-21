"""宠物事件时间序列 API。

payload_json 在 SQLite 里存 JSON 字符串，API 层解码为 dict 给前端。
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.deps import ensure_pet_owned_by, get_current_user
from app.db.database import get_session
from app.db.models import ChatSession, Pet, PetEvent, User

router = APIRouter(prefix='/api/events', tags=['events'])


# === IO Schemas ===

class EventCreate(BaseModel):
    pet_id: int
    event_type: str  # 'bcs' / 'symptom' / 'vaccine' / 'grooming' / 'photo' / 'feeding' / 'weight' / 'emotion' / 'pain_fgs'
    payload: dict[str, Any] = {}
    image_url: Optional[str] = None
    note: Optional[str] = None
    happened_at: Optional[datetime] = None


class EventOut(BaseModel):
    id: int
    pet_id: int
    event_type: str
    payload: dict[str, Any]
    image_url: Optional[str] = None
    note: Optional[str] = None
    happened_at: datetime
    created_at: datetime


def _to_out(e: PetEvent) -> EventOut:
    try:
        payload = json.loads(e.payload_json) if e.payload_json else {}
    except json.JSONDecodeError:
        payload = {}
    return EventOut(
        id=e.id,
        pet_id=e.pet_id,
        event_type=e.event_type,
        payload=payload,
        image_url=e.image_url,
        note=e.note,
        happened_at=e.happened_at,
        created_at=e.created_at,
    )


# === Endpoints ===

@router.get('', response_model=list[EventOut])
async def list_events(
    pet_id: int = Query(..., description='宠物 ID'),
    event_type: Optional[str] = Query(None),
    days_back: Optional[int] = Query(None, ge=1, le=3650, description='只返回最近 N 天的事件；不传则不限'),
    limit: int = Query(200, ge=1, le=1000),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    ensure_pet_owned_by(pet_id, user, session)
    stmt = select(PetEvent).where(PetEvent.pet_id == pet_id)
    if event_type:
        stmt = stmt.where(PetEvent.event_type == event_type)
    if days_back is not None:
        since = datetime.now() - timedelta(days=days_back)
        stmt = stmt.where(PetEvent.happened_at >= since)
    stmt = stmt.order_by(PetEvent.happened_at.desc()).limit(limit)
    return [_to_out(e) for e in session.exec(stmt).all()]


@router.post('', response_model=EventOut)
async def create_event(
    data: EventCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    ensure_pet_owned_by(data.pet_id, user, session)
    e = PetEvent(
        pet_id=data.pet_id,
        event_type=data.event_type,
        payload_json=json.dumps(data.payload, ensure_ascii=False),
        image_url=data.image_url,
        note=data.note,
        happened_at=data.happened_at or datetime.now(),
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return _to_out(e)


@router.delete('/{event_id}')
async def delete_event(
    event_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    e = session.get(PetEvent, event_id)
    if not e:
        raise HTTPException(404, 'event not found')
    # 检查 event 所属 pet 归当前用户
    ensure_pet_owned_by(e.pet_id, user, session)
    session.delete(e)
    session.commit()
    return {'ok': True, 'event_id': event_id}


# === Timeline aggregation ===
# 时序图专用聚合端点：bcs / pain_fgs 直接从 chat_sessions.vlm_output_json 取
# （不依赖 LLM 主动调 save_pet_event，数据更完整）；weight 仍走 pet_events。

class TimelinePoint(BaseModel):
    id: int  # weight 时是 pet_event.id；bcs/pain_fgs 时是 chat_session.id（用于删除）
    ts: datetime
    value: float
    image_url: Optional[str] = None
    note: Optional[str] = None
    extra: dict[str, Any] = {}
    source: str  # 'vlm' | 'pet_event'


class TimelineOut(BaseModel):
    metric: str
    points: list[TimelinePoint]


_VLM_METRICS = {
    'bcs': 'bcs_score',
    'pain_fgs': 'total_score',
}


@router.get('/timeline', response_model=TimelineOut)
async def get_timeline(
    pet_id: int = Query(..., description='宠物 ID'),
    metric: str = Query(..., description="bcs / pain_fgs / weight"),
    days_back: Optional[int] = Query(None, ge=1, le=3650),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    ensure_pet_owned_by(pet_id, user, session)
    since = datetime.now() - timedelta(days=days_back) if days_back else None

    points: list[TimelinePoint] = []

    if metric == 'weight':
        stmt = select(PetEvent).where(
            PetEvent.pet_id == pet_id,
            PetEvent.event_type == 'weight',
        )
        if since is not None:
            stmt = stmt.where(PetEvent.happened_at >= since)
        stmt = stmt.order_by(PetEvent.happened_at.asc())
        for e in session.exec(stmt).all():
            try:
                payload = json.loads(e.payload_json) if e.payload_json else {}
            except json.JSONDecodeError:
                payload = {}
            w = payload.get('weight_kg')
            if not isinstance(w, (int, float)):
                continue
            points.append(TimelinePoint(
                id=e.id,
                ts=e.happened_at,
                value=float(w),
                image_url=e.image_url,
                note=e.note,
                extra={
                    'previous': payload.get('previous'),
                    'delta': payload.get('delta'),
                    'source_tag': payload.get('source'),
                },
                source='pet_event',
            ))
    elif metric in _VLM_METRICS:
        vlm_field = _VLM_METRICS[metric]
        # 每次 VLM 跑完都会持久化到 user msg 的 vlm_output_json 字段
        stmt = select(ChatSession).where(
            ChatSession.pet_id == pet_id,
            ChatSession.task == metric,
            ChatSession.vlm_output_json.is_not(None),
        )
        if since is not None:
            stmt = stmt.where(ChatSession.created_at >= since)
        stmt = stmt.order_by(ChatSession.created_at.asc())
        for row in session.exec(stmt).all():
            try:
                vlm = json.loads(row.vlm_output_json) if row.vlm_output_json else None
            except json.JSONDecodeError:
                vlm = None
            if not vlm or vlm.get('_error'):
                continue
            v = vlm.get(vlm_field)
            if not isinstance(v, (int, float)):
                continue
            # rationale / normalized 等额外字段一并保留，前端 Tooltip 可用
            extra = {k: vlm.get(k) for k in ('rationale', 'normalized', 'caveat') if vlm.get(k) is not None}
            points.append(TimelinePoint(
                id=row.id,
                ts=row.created_at,
                value=float(v),
                image_url=row.image_url,
                note=row.content or None,
                extra=extra,
                source='vlm',
            ))
    else:
        raise HTTPException(400, f"unsupported metric: {metric}")

    return TimelineOut(metric=metric, points=points)


@router.delete('/timeline/point')
async def delete_timeline_point(
    metric: str = Query(..., description='bcs / pain_fgs / weight'),
    id: int = Query(..., description='weight 时是 pet_event.id；bcs/pain_fgs 时是 chat_session.id'),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """删除一个时序图数据点。

    - weight: 真删 PetEvent 行（同步从事件时间线消失）
    - bcs / pain_fgs: 软删——把 chat_sessions.vlm_output_json 置 null
    """
    if metric == 'weight':
        e = session.get(PetEvent, id)
        if not e or e.event_type != 'weight':
            raise HTTPException(404, 'weight event not found')
        ensure_pet_owned_by(e.pet_id, user, session)
        session.delete(e)
        session.commit()
        return {'ok': True, 'mode': 'hard_delete', 'id': id}
    if metric in _VLM_METRICS:
        row = session.get(ChatSession, id)
        if not row or row.task != metric or row.vlm_output_json is None:
            raise HTTPException(404, 'chat session row with vlm output not found')
        # chat_session 归属：通过 pet_id 验证
        if row.pet_id is None:
            raise HTTPException(404, 'chat session has no pet')
        ensure_pet_owned_by(row.pet_id, user, session)
        row.vlm_output_json = None
        session.add(row)
        session.commit()
        return {'ok': True, 'mode': 'soft_delete', 'id': id}
    raise HTTPException(400, f'unsupported metric: {metric}')
