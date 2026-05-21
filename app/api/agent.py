"""Agent API：
  - POST /api/agent/chat          非流式（保留兼容）
  - POST /api/agent/chat/stream   SSE 流式
"""
from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.agent.planner import run_agent, run_agent_stream
from app.auth.deps import ensure_pet_owned_by, get_current_user
from app.db.database import get_session
from app.db.models import User

router = APIRouter(prefix='/api/agent', tags=['agent'])

ROOT = Path(__file__).resolve().parent.parent.parent
UPLOAD_DIR = ROOT / 'data' / 'uploads'  # 静态根
CHAT_IMG_SUBDIR = 'chat'                # 实际位置 data/uploads/chat/


def _save_chat_image(image: UploadFile) -> tuple[Path, str]:
    """保存聊天图片到 data/uploads/chat/，返回 (绝对路径, /static URL)。"""
    if not image.content_type or not image.content_type.startswith('image/'):
        raise HTTPException(400, 'image must be image/*')
    target_dir = UPLOAD_DIR / CHAT_IMG_SUBDIR
    target_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(image.filename or 'upload.jpg').suffix or '.jpg'
    fname = f'{uuid.uuid4().hex}{ext}'
    abs_path = target_dir / fname
    with abs_path.open('wb') as f:
        shutil.copyfileobj(image.file, f)
    url = f'/static/{CHAT_IMG_SUBDIR}/{fname}'
    return abs_path, url


@router.post('/chat')
async def chat(
    pet_id: int = Form(...),
    text: str = Form(''),
    image: Optional[UploadFile] = File(None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """非流式 - 保留兼容 P4 测试脚本。"""
    text = (text or '').strip()
    has_image = image is not None and image.filename
    if not text and not has_image:
        raise HTTPException(400, 'must provide text or image')

    ensure_pet_owned_by(pet_id, user, session)

    image_path = None
    if has_image:
        image_path, _ = _save_chat_image(image)

    try:
        return run_agent(
            user_text=text,
            pet_id=pet_id,
            image_path=str(image_path) if image_path else None,
            verbose=False,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f'agent failed: {e}')


@router.post('/chat/stream')
async def chat_stream(
    pet_id: int = Form(...),
    session_id: str = Form(...),
    text: str = Form(''),
    image: Optional[UploadFile] = File(None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """SSE 流式入口。

    multipart/form-data:
      - pet_id (int, required)
      - session_id (str, required) - 客户端生成 UUID，per-pet long-running
      - text (str, optional)
      - image (file, optional)
      - Authorization: Bearer <jwt> header (required V2)

    SSE events 见 planner.run_agent_stream 文档。
    """
    text = (text or '').strip()
    has_image = image is not None and image.filename
    if not text and not has_image:
        raise HTTPException(400, 'must provide text or image')

    ensure_pet_owned_by(pet_id, user, session)

    image_path = None
    image_url = None
    if has_image:
        image_path, image_url = _save_chat_image(image)

    user_id_for_persist = user.id

    async def event_gen():
        try:
            async for event in run_agent_stream(
                user_text=text,
                pet_id=pet_id,
                session_id=session_id,
                image_path=str(image_path) if image_path else None,
                image_url_for_persist=image_url,
                user_id=user_id_for_persist,
            ):
                yield f'data: {json.dumps(event, ensure_ascii=False)}\n\n'
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print('=' * 60)
            print('[/api/agent/chat/stream] UNCAUGHT EXCEPTION')
            print(tb)
            print('=' * 60)
            detail = f'{type(e).__name__}: {str(e)}'
            yield f'data: {json.dumps({"type": "error", "detail": detail})}\n\n'

    return StreamingResponse(
        event_gen(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',  # nginx 不缓冲
        },
    )
