#!/bin/bash
set -e

cd /app

# 首次启动：自动 ingest 知识库（生成 Chroma + bm25.pkl）
if [ ! -f /app/data/chroma/bm25.pkl ]; then
    echo "[entrypoint] First run detected, ingesting KB (will download BGE models ~200MB)..."
    python scripts/ingest_kb.py
    echo "[entrypoint] KB ingest complete."
else
    echo "[entrypoint] KB already ingested, skip."
fi

# 启动 FastAPI
echo "[entrypoint] Starting uvicorn on port 8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
