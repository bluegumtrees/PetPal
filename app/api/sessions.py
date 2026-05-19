"""会话历史 API。

  - GET  /api/sessions?pet_id=...&limit=20    列出该宠物所有 session（按最近活跃排序）
  - GET  /api/sessions/{session_id}/messages  加载某 session 的全部消息
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.db.database import get_session
from app.db.models import ChatSession

router = APIRouter(prefix='/api/sessions', tags=['sessions'])


class MessageOut(BaseModel):
    id: int
    session_id: str
    pet_id: Optional[int]
    role: str
    content: str
    tool_calls: Optional[list[dict]] = None
    image_url: Optional[str] = None
    task: Optional[str] = None
    is_intermediate: bool = False
    vlm_output: Optional[dict] = None
    created_at: datetime


class SessionSummary(BaseModel):
    session_id: str
    pet_id: Optional[int]
    message_count: int
    first_at: datetime
    last_at: datetime
    last_user_text: Optional[str]


def _row_to_msg(row: ChatSession) -> MessageOut:
    tc = None
    if row.tool_calls_json:
        try:
            tc = json.loads(row.tool_calls_json)
        except json.JSONDecodeError:
            tc = None
    vlm = None
    if row.vlm_output_json:
        try:
            vlm = json.loads(row.vlm_output_json)
        except json.JSONDecodeError:
            vlm = None
    return MessageOut(
        id=row.id,
        session_id=row.session_id,
        pet_id=row.pet_id,
        role=row.role,
        content=row.content,
        tool_calls=tc,
        image_url=row.image_url,
        task=row.task,
        is_intermediate=bool(row.is_intermediate),
        vlm_output=vlm,
        created_at=row.created_at,
    )


@router.get('', response_model=list[SessionSummary])
async def list_sessions(
    pet_id: int = Query(...),
    limit: int = Query(20, ge=1, le=100),
    session: Session = Depends(get_session),
):
    """该宠物历史 session 概要列表（按最近活跃倒序）。"""
    # 聚合：每个 session_id 的消息数 + 最早/最晚时间
    stmt = (
        select(
            ChatSession.session_id,
            func.count(ChatSession.id).label('message_count'),
            func.min(ChatSession.created_at).label('first_at'),
            func.max(ChatSession.created_at).label('last_at'),
        )
        .where(ChatSession.pet_id == pet_id)
        .where(ChatSession.session_id.is_not(None))
        .group_by(ChatSession.session_id)
        .order_by(func.max(ChatSession.created_at).desc())
        .limit(limit)
    )
    rows = session.exec(stmt).all()

    out = []
    for sid, cnt, first_at, last_at in rows:
        # 找该 session 第一条 user msg 作为预览
        first_user = session.exec(
            select(ChatSession)
            .where(ChatSession.session_id == sid)
            .where(ChatSession.role == 'user')
            .order_by(ChatSession.created_at.asc())
            .limit(1)
        ).first()
        out.append(SessionSummary(
            session_id=sid,
            pet_id=pet_id,
            message_count=cnt,
            first_at=first_at,
            last_at=last_at,
            last_user_text=first_user.content[:80] if first_user else None,
        ))
    return out


@router.get('/{session_id}/messages', response_model=list[MessageOut])
async def get_session_messages(
    session_id: str,
    session: Session = Depends(get_session),
):
    """加载某 session 全部消息（按时间正序）。"""
    rows = session.exec(
        select(ChatSession)
        .where(ChatSession.session_id == session_id)
        .order_by(ChatSession.created_at.asc())
    ).all()
    if not rows:
        # session 不存在或没消息 → 返回空数组（不是 404，因为客户端可能拿新建的 UUID）
        return []
    return [_row_to_msg(r) for r in rows]


@router.delete('/{session_id}')
async def delete_session(
    session_id: str,
    session: Session = Depends(get_session),
):
    """删除某 session 全部消息（用户主动重置）。"""
    rows = session.exec(
        select(ChatSession).where(ChatSession.session_id == session_id)
    ).all()
    for r in rows:
        session.delete(r)
    session.commit()
    return {'ok': True, 'deleted': len(rows)}
