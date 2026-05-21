"""PetPal FastAPI 入口。"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.agent import router as agent_router
from app.api.auth import router as auth_router
from app.api.events import router as events_router
from app.api.pets import router as pets_router
from app.api.reminders import router as reminders_router
from app.api.sessions import router as sessions_router
from app.api.vet import router as vet_router
from app.db.database import init_db
from app.services.scheduler import shutdown_scheduler, start_scheduler

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT / 'data' / 'uploads'
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    init_db()
    await start_scheduler()
    yield
    # shutdown
    await shutdown_scheduler()


app = FastAPI(
    title="PetPal API",
    description="多模态宠物管家 Agent",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件（宠物头像等用户上传内容）
app.mount('/static', StaticFiles(directory=str(UPLOAD_DIR)), name='static')

app.include_router(auth_router)
app.include_router(vet_router)
app.include_router(pets_router)
app.include_router(events_router)
app.include_router(agent_router)
app.include_router(sessions_router)
app.include_router(reminders_router)


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "service": "petpal",
        "version": app.version,
        "env": os.getenv("APP_ENV", "dev"),
        "time": datetime.now().isoformat(timespec="seconds"),
    }


@app.get("/")
async def root() -> dict:
    return {"msg": "PetPal API up. Try /api/health or /docs"}
