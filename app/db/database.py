"""SQLite 引擎 + Session 工厂。"""
from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlmodel import Session, SQLModel, create_engine

ROOT = Path(__file__).resolve().parent.parent.parent
# 允许测试用 PETPAL_DB_PATH 环境变量覆盖（避免冲突 / 隔离）
DB_PATH = Path(os.environ.get('PETPAL_DB_PATH') or (ROOT / 'data' / 'petpal.db'))
DB_URL = f'sqlite:///{DB_PATH}'

_engine = create_engine(
    DB_URL,
    connect_args={'check_same_thread': False},  # FastAPI 多线程需要
    echo=False,
)


def init_db() -> None:
    """启动时建表（幂等）+ 跑轻量迁移。"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # 导入模型让 SQLModel 注册
    from app.db import models  # noqa: F401
    SQLModel.metadata.create_all(_engine)
    _migrate_chat_sessions_v2()
    _migrate_reminders_p62()
    _migrate_users_v2()


def _migrate_chat_sessions_v2() -> None:
    """在 chat_sessions 加缺失列（如果还没有）。

    SQLModel 的 create_all 只在表不存在时建表，不会 alter 已有表，
    所以历史用户升级时需要这里补字段。
    """
    import sqlite3
    if not DB_PATH.exists():
        return
    conn = sqlite3.connect(str(DB_PATH))
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(chat_sessions)")}
        added = []
        if 'session_id' not in cols:
            conn.execute("ALTER TABLE chat_sessions ADD COLUMN session_id TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS ix_chat_sessions_session_id ON chat_sessions(session_id)")
            added.append('session_id')
        if 'image_url' not in cols:
            conn.execute("ALTER TABLE chat_sessions ADD COLUMN image_url TEXT")
            added.append('image_url')
        if 'task' not in cols:
            conn.execute("ALTER TABLE chat_sessions ADD COLUMN task TEXT")
            added.append('task')
        if 'is_intermediate' not in cols:
            conn.execute("ALTER TABLE chat_sessions ADD COLUMN is_intermediate INTEGER DEFAULT 0")
            added.append('is_intermediate')
        if 'vlm_output_json' not in cols:
            conn.execute("ALTER TABLE chat_sessions ADD COLUMN vlm_output_json TEXT")
            added.append('vlm_output_json')
        if added:
            conn.commit()
            print(f'[migrate] chat_sessions: added columns {added}')
    finally:
        conn.close()


def _migrate_reminders_p62() -> None:
    """P6.2: reminders 加 delayed_reason / notification_payload_json / preview_subject 列。"""
    import sqlite3
    if not DB_PATH.exists():
        return
    conn = sqlite3.connect(str(DB_PATH))
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(reminders)")}
        added = []
        if 'delayed_reason' not in cols:
            conn.execute("ALTER TABLE reminders ADD COLUMN delayed_reason TEXT")
            added.append('delayed_reason')
        if 'notification_payload_json' not in cols:
            conn.execute("ALTER TABLE reminders ADD COLUMN notification_payload_json TEXT")
            added.append('notification_payload_json')
        if 'preview_subject' not in cols:
            conn.execute("ALTER TABLE reminders ADD COLUMN preview_subject TEXT")
            added.append('preview_subject')
        if added:
            conn.commit()
            print(f'[migrate] reminders: added columns {added}')
    finally:
        conn.close()


def _migrate_users_v2() -> None:
    """V2: pets / chat_sessions 加 user_id 列 + 自动创建 demo 用户 + 回填历史数据。

    迁移策略：
    1. ALTER TABLE 加 user_id NULL 列（先允许 NULL 兼容旧数据）
    2. 创建 demo 用户（如果不存在）
    3. 把所有 user_id=NULL 的 pets / chat_sessions 回填到 demo
    """
    import sqlite3
    if not DB_PATH.exists():
        return
    conn = sqlite3.connect(str(DB_PATH))
    try:
        added = []
        # pets 加 user_id
        cols = {r[1] for r in conn.execute("PRAGMA table_info(pets)")}
        if 'user_id' not in cols:
            conn.execute("ALTER TABLE pets ADD COLUMN user_id INTEGER")
            conn.execute("CREATE INDEX IF NOT EXISTS ix_pets_user_id ON pets(user_id)")
            added.append('pets.user_id')
        # chat_sessions 加 user_id
        cols2 = {r[1] for r in conn.execute("PRAGMA table_info(chat_sessions)")}
        if 'user_id' not in cols2:
            conn.execute("ALTER TABLE chat_sessions ADD COLUMN user_id INTEGER")
            conn.execute("CREATE INDEX IF NOT EXISTS ix_chat_sessions_user_id ON chat_sessions(user_id)")
            added.append('chat_sessions.user_id')
        if added:
            conn.commit()
            print(f'[migrate] V2 added columns: {added}')

        # 回填 demo 用户
        users_table_exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        ).fetchone()
        if not users_table_exists:
            return  # SQLModel.create_all 应该已经创建过，但兜底跳过

        demo_row = conn.execute(
            "SELECT id FROM users WHERE email = 'demo@petpal.local' LIMIT 1"
        ).fetchone()
        if not demo_row:
            # 首次启动：创建 demo 用户
            from app.auth.security import hash_password
            demo_hash = hash_password('demo123')
            from datetime import datetime
            conn.execute(
                "INSERT INTO users (email, password_hash, name, is_demo, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ('demo@petpal.local', demo_hash, 'Demo 试用账号', 1, datetime.now().isoformat()),
            )
            conn.commit()
            print('[migrate] V2 created demo user (email=demo@petpal.local)')
            demo_row = conn.execute(
                "SELECT id FROM users WHERE email = 'demo@petpal.local' LIMIT 1"
            ).fetchone()

        demo_id = demo_row[0]

        # 回填 user_id NULL 的 pets → demo
        result = conn.execute(
            "UPDATE pets SET user_id = ? WHERE user_id IS NULL",
            (demo_id,),
        )
        if result.rowcount > 0:
            print(f'[migrate] V2 backfilled {result.rowcount} pets to demo user (id={demo_id})')
        # 回填 user_id NULL 的 chat_sessions → demo
        result2 = conn.execute(
            "UPDATE chat_sessions SET user_id = ? WHERE user_id IS NULL",
            (demo_id,),
        )
        if result2.rowcount > 0:
            print(f'[migrate] V2 backfilled {result2.rowcount} chat_sessions to demo user')
        conn.commit()
    finally:
        conn.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency。"""
    with Session(_engine) as session:
        yield session


@contextmanager
def session_scope() -> Iterator[Session]:
    """脚本 / 非 FastAPI 场景用。"""
    s = Session(_engine)
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()
