# PetPal 智能宠物管家

多模态 AI Agent — 拍照识别症状/情绪/体态，调用兽医知识库 + 地图 + 提醒等工具，给出建议并持久化宠物档案。

## 技术栈

- **后端**: Python 3.11 + FastAPI + ChromaDB + SQLite + OpenAI SDK (via OpenRouter)
- **前端**: React 18 + Vite + Tailwind CSS（JSX + JSDoc）
- **VLM/LLM**: `openai/gpt-4o-mini` via OpenRouter
- **检索**: BGE-small-zh-v1.5 + rank-bm25 + BGE-reranker-base

## 开发

### 后端

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 前端

```powershell
cd web
pnpm install
pnpm dev
```

打开 http://localhost:5173

## Phase 进度

- [x] P0 环境 + 骨架
- [ ] P1 兽医种子知识库 + RAG
- [ ] P2 VLM 调通
- [ ] P3 多宠物档案 CRUD
- [ ] P4 Agent + Function Calling
- [ ] P5 3 核心场景前端 + SSE
- [ ] P6 时间序列对比 + 提醒 + 邮件
- [ ] P7 评测 + 部署 HF Spaces
