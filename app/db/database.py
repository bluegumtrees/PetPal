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
