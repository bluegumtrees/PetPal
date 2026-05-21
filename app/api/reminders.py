"""Reminders CRUD + dev trigger_now。

时区约定：scheduled_at 全程 naive UTC（DB / API / scheduler）。
前端 datetime-local 提交时本地 → UTC ISO；显示时 toLocaleString 转本地。
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.auth.deps import ensure_pet_owned_by, get_current_user
from app.db.database import get_session
from app.db.models import Pet, Reminder, User
from app.services.email import _REMINDER_TYPE_LABEL  # type: ignore
from app.services.scheduler import (
    add_reminder_job,
    remove_reminder_job,
    trigger_now as scheduler_trigger_now,
)

router = APIRouter(prefix='/api/reminders', tags=['reminders'])

ALLOWED_TYPES = {'vaccine', 'deworm', 'bath', 'medication', 'checkup', 'other'}


# === Schemas ===

class ReminderCreate(BaseModel):
    pet_id: int
    reminder_type: str = Field(..., max_length=30)
    scheduled_at: datetime  # 前端传 UTC ISO ("...Z" 或带 offset)；naive 视为 UTC
    message: str = Field('', max_length=500)
    repeat_rule: Optional[str] = Field(default=None, max_length=50)


class ReminderOut(BaseModel):
    id: int
    pet_id: int
    reminder_type: str
    scheduled_at: datetime
    message: str
    repeat_rule: Optional[str] = None
    notified: bool
    notification_channel: Optional[str] = None
    delayed_reason: Optional[str] = None
    notification_payload: Optional[dict[str, Any]] = None
    preview_subject: Optional[str] = None
    created_at: datetime


def _to_naive_utc(dt: datetime) -> datetime:
    """前端可能传 aware datetime（带 tz info）→ 转 UTC 后去掉 tz。"""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt  # naive 视为 UTC


def _row_to_out(r: Reminder) -> ReminderOut:
    payload = None
    if r.notification_payload_json:
        try:
            payload = json.loads(r.notification_payload_json)
        except json.JSONDecodeError:
            payload = None
    return ReminderOut(
        id=r.id,
        pet_id=r.pet_id,
        reminder_type=r.reminder_type,
        scheduled_at=r.scheduled_at,
        message=r.message,
        repeat_rule=r.repeat_rule,
        notified=bool(r.notified),
        notification_channel=r.notification_channel,
        delayed_reason=r.delayed_reason,
        notification_payload=payload,
        preview_subject=r.preview_subject,
        created_at=r.created_at,
    )


def _ensure_pet(pet_id: int, user: User, session: Session) -> Pet:
    """V2: 检查 pet 归属当前 user，否则 404。"""
    return ensure_pet_owned_by(pet_id, user, session)


def _build_preview_subject(pet_name: str, reminder_type: str) -> str:
    label = _REMINDER_TYPE_LABEL.get(reminder_type, '📝 提醒')
    return f'[PetPal] {pet_name} · {label}提醒'


# === Endpoints ===

@router.get('', response_model=list[ReminderOut])
async def list_reminders(
    pet_id: int = Query(..., description='宠物 ID'),
    include_notified: bool = Query(True, description='是否包含已触发的'),
    limit: int = Query(100, ge=1, le=500),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_pet(pet_id, user, session)
    stmt = select(Reminder).where(Reminder.pet_id == pet_id)
    if not include_notified:
        stmt = stmt.where(Reminder.notified == False)  # noqa: E712
    stmt = stmt.order_by(Reminder.scheduled_at.desc()).limit(limit)
    return [_row_to_out(r) for r in session.exec(stmt).all()]


@router.post('', response_model=ReminderOut)
async def create_reminder(
    data: ReminderCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if data.reminder_type not in ALLOWED_TYPES:
        raise HTTPException(400, f'reminder_type must be one of {sorted(ALLOWED_TYPES)}')
    pet = _ensure_pet(data.pet_id, user, session)
    scheduled_utc = _to_naive_utc(data.scheduled_at)

    r = Reminder(
        pet_id=data.pet_id,
        reminder_type=data.reminder_type,
        scheduled_at=scheduled_utc,
        message=data.message,
        repeat_rule=data.repeat_rule,
        preview_subject=_build_preview_subject(pet.name, data.reminder_type),
    )
    session.add(r)
    session.commit()
    session.refresh(r)

    # 排进 scheduler（过期的也排——scheduler 会判断；MVP 不在创建时启动恢复逻辑）
    # 仅未来时间排程；过去时间不排（避免立即触发"补发"假象）
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    if scheduled_utc > now_utc:
        add_reminder_job(r.id, scheduled_utc)
    return _row_to_out(r)


@router.delete('/{reminder_id}')
async def delete_reminder(
    reminder_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    r = session.get(Reminder, reminder_id)
    if not r:
        raise HTTPException(404, 'reminder not found')
    _ensure_pet(r.pet_id, user, session)  # 验证 reminder 所属 pet 归当前 user
    remove_reminder_job(reminder_id)
    session.delete(r)
    session.commit()
    return {'ok': True, 'reminder_id': reminder_id}


@router.post('/{reminder_id}/trigger_now')
async def trigger_now_endpoint(
    reminder_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """dev-only：立即触发一条 reminder（演示用）。

    需要 env PETPAL_DEV_MODE=1 才允许调用，避免生产环境被乱触发。
    """
    if os.getenv('PETPAL_DEV_MODE') != '1':
        raise HTTPException(403, 'trigger_now is dev-only; set PETPAL_DEV_MODE=1 to enable')
    r = session.get(Reminder, reminder_id)
    if not r:
        raise HTTPException(404, 'reminder not found')
    _ensure_pet(r.pet_id, user, session)  # 验证归属
    if r.notified:
        raise HTTPException(400, 'reminder already triggered')
    result = await scheduler_trigger_now(reminder_id)
    return result
