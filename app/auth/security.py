"""V2 auth：bcrypt 密码 hash + JWT token 生成/验证。

注：直接用 bcrypt 库（不走 passlib），避免 passlib 1.7.4 与 bcrypt 4.x 的兼容性 bug。
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt

# JWT 配置
ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_DAYS = 7


def _get_secret() -> str:
    """从 env 拿 JWT secret。生产必须设 PETPAL_JWT_SECRET；dev 用默认值。"""
    secret = os.getenv('PETPAL_JWT_SECRET')
    if not secret:
        # dev fallback；生产部署一定要 .env 配 PETPAL_JWT_SECRET
        return 'petpal-dev-jwt-secret-DO-NOT-USE-IN-PROD'
    return secret


# === 密码 hash ===

def _to_72_bytes(plain: str) -> bytes:
    """bcrypt 算法上限 72 字节，超长截断（业界普遍做法）。"""
    pwd_bytes = plain.encode('utf-8')
    return pwd_bytes[:72] if len(pwd_bytes) > 72 else pwd_bytes


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_to_72_bytes(plain), bcrypt.gensalt(rounds=12)).decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_to_72_bytes(plain), hashed.encode('utf-8'))
    except Exception:
        return False


# === JWT ===

def create_access_token(user_id: int, email: str, is_demo: bool = False) -> str:
    """生成 7 天 token。"""
    now = datetime.now(timezone.utc)
    payload = {
        'sub': str(user_id),
        'email': email,
        'is_demo': is_demo,
        'iat': int(now.timestamp()),
        'exp': int((now + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)).timestamp()),
    }
    return jwt.encode(payload, _get_secret(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """解码 + 校验。返回 payload 或 None（无效/过期）。"""
    try:
        return jwt.decode(token, _get_secret(), algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
