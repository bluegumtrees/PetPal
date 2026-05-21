"""FastAPI auth dependencies：get_current_user / get_current_user_optional + ownership helpers。"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from app.auth.security import decode_access_token
from app.db.database import get_session
from app.db.models import Pet, User


def _extract_token(request: Request) -> Optional[str]:
    """从 Authorization: Bearer <token> 头提取。"""
    auth = request.headers.get('authorization') or request.headers.get('Authorization')
    if not auth:
        return None
    parts = auth.split()
    if len(parts) != 2 or parts[0].lower() != 'bearer':
        return None
    return parts[1]


def get_current_user(
    request: Request,
    session: Session = Depends(get_session),
) -> User:
    """要求登录。未登录或 token 无效 → 401。"""
    token = _extract_token(request)
    if not token:
        raise HTTPException(401, 'not authenticated')
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(401, 'invalid or expired token')
    user_id = int(payload.get('sub', 0))
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(401, 'user not found')
    return user


def get_current_user_optional(
    request: Request,
    session: Session = Depends(get_session),
) -> Optional[User]:
    """可选登录（如 chat 历史接口想兼容 demo 模式）。无 token 返回 None，不抛错。"""
    token = _extract_token(request)
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    user_id = int(payload.get('sub', 0))
    return session.get(User, user_id)


def ensure_pet_owned_by(pet_id: int, user: User, session: Session) -> Pet:
    """检查 pet 存在 + 未软删 + 属于当前 user。否则 404。

    安全设计：故意不区分"pet 不存在" vs "pet 不属于你"——都返回 404，避免信息泄露。
    """
    pet = session.get(Pet, pet_id)
    if not pet or pet.deleted_at or pet.user_id != user.id:
        raise HTTPException(404, f'pet {pet_id} not found')
    return pet
