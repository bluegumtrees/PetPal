"""Auth API：register / login / me / demo 登录。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session, select

from app.auth.deps import get_current_user
from app.auth.security import create_access_token, hash_password, verify_password
from app.db.database import get_session
from app.db.models import User

router = APIRouter(prefix='/api/auth', tags=['auth'])

DEMO_EMAIL = 'demo@petpal.local'
DEMO_PASSWORD = 'demo123'


# === Schemas ===

class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=72)
    name: str = Field(..., min_length=1, max_length=50)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: dict  # {id, email, name, is_demo}


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    is_demo: bool
    created_at: datetime


def _user_to_dict(u: User) -> dict:
    return {
        'id': u.id,
        'email': u.email,
        'name': u.name,
        'is_demo': bool(u.is_demo),
    }


# === Endpoints ===

@router.post('/register', response_model=TokenOut)
async def register(data: RegisterIn, session: Session = Depends(get_session)):
    # 邮箱去重
    existing = session.exec(select(User).where(User.email == data.email)).first()
    if existing:
        raise HTTPException(400, 'email already registered')

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        name=data.name,
        is_demo=False,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    token = create_access_token(user.id, user.email, user.is_demo)
    return TokenOut(access_token=token, user=_user_to_dict(user))


@router.post('/login', response_model=TokenOut)
async def login(data: LoginIn, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == data.email)).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, 'invalid email or password')
    token = create_access_token(user.id, user.email, user.is_demo)
    return TokenOut(access_token=token, user=_user_to_dict(user))


@router.post('/demo-login', response_model=TokenOut)
async def demo_login(session: Session = Depends(get_session)):
    """一键登 demo 账号（无需密码），用于朋友试用。"""
    user = session.exec(select(User).where(User.email == DEMO_EMAIL)).first()
    if not user:
        # 首次自动创建 demo 用户
        user = User(
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            name='Demo 试用账号',
            is_demo=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
    token = create_access_token(user.id, user.email, True)
    return TokenOut(access_token=token, user=_user_to_dict(user))


@router.get('/me', response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        is_demo=bool(user.is_demo),
        created_at=user.created_at,
    )
