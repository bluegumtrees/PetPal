# 🐾 PetPal 智能宠物管家

一个**真正的多模态 AI Agent**：宠物主人用「拍照 + 文字」提问，系统先把输入路由到 5 类任务（症状识别 / 体态评分 / 疼痛评估 / 情绪解读 / 闲聊），调 VLM 看图，再由主控 LLM **自主编排 7 个工具**（兽医知识库 RAG / 高德地图 / 时间线读写 / 追加更新事件 / 重看图 / 日程提醒）完成端到端服务——给出有温度的建议，并把每次关键发现持久化进宠物的健康档案。

其中一个核心设计是把同行评议的临床疼痛量表 **FGS（Feline Grimace Scale, Evangelista et al. 2019, *Scientific Reports*）prompt 化**为 VLM 的结构化输出 schema，让通用视觉模型输出医学级的疼痛评估。

🔗 **在线 Demo**：http://114.55.95.6/ —— [一键进入演示账号](http://114.55.95.6/login?demo=1)（黄金演示数据：两只宠物半年健康档案 + 14 条真实 agent 会话，`scripts/seed_demo.py` 随时一键重置）

---

## 系统架构

```
前端 (React 19 + Vite + Tailwind v4 + V4 设计系统 6 主题)
  卡片流 UI · 图片上传 · 宠物切换 · per-pet 会话持久化 · JWT 登录
        │  POST /api/agent/chat/stream  (multipart: text / image / pet_id / session_id)
        ▼
FastAPI + StreamingResponse (SSE)  ── async generator + asyncio.to_thread
        │
  ① 路由     classify_task(text, has_image)  → symptom / bcs / pain_fgs / emotion / chat
  ② VLM      按 task 选 prompt（FGS 5-AU schema 等）→ Pydantic 校验 + 失败重试
  ③ Context  注入宠物档案 + 长期健康画像（记忆 V2）+ 最近 5 条事件 + VLM 输出
  ④ Agent loop (max_iter=7)
        │   LLM(messages, tools) → tool_calls → 执行 → 结果回灌 → 循环
        │   ├─ retrieve_vet_knowledge   兽医 RAG（三阶段检索）
        │   ├─ save_pet_event / update_pet_event   写 / 追加时间线
        │   ├─ reanalyze_image          多轮重看历史图（换 task / focus）
        │   ├─ find_nearby_clinic       高德地图 POI
        │   ├─ schedule_reminder        APScheduler 日程提醒
        │   └─ query_pet_history        查更早历史
  ⑤ 持久化   每条 message 入库（session_id / tool_calls_json / vlm_output_json 全审计）
        │
        ▼
检索 (Chroma 向量 + BM25/jieba → RRF → CrossEncoder rerank)
持久化 (SQLModel + SQLite，6 表) · 高德 Web API · SMTP / APScheduler
```

## 核心特性

- **真 Agent，不是 chatbot**：基于 OpenAI Function Calling 协议，LLM 自主决定调哪些工具、按什么顺序、调几次；每步 `tool_calls` 持久化可审计，前端卡片流可视化整个决策过程。
- **临床量表 prompt 化** ⭐：FGS 的 5 个 Action Units（耳位 / 眼睑 / 口鼻 / 胡须 / 头位）× 0/1/2 评分编码为 VLM 输出 schema，输出 `total_score/10 + normalized` 并对照 0.39 临床阈值。
- **多 task VLM**：症状 / 情绪 / 体态（WSAVA 9 分制）/ 疼痛 / 闲聊各有独立 prompt 与 Pydantic schema；情绪任务**不断言**，输出 `candidate_emotions + confidence` 并标注单图局限。
- **三阶段检索 RAG**：稠密（BGE-small-zh + Chroma）+ 稀疏（BM25 + jieba）→ RRF 融合 → CrossEncoder 重排；知识库 473 条，带 `species / severity / emergency` 等 metadata 过滤。
- **MCP 标准接入**：兽医知识库检索封装为标准 MCP server（`mcp_server.py`），Claude Code / Claude Desktop / Cursor 等任意 MCP 客户端可直接调用（附 stdio 冒烟测试）。
- **多模态长期跟踪**：Recharts 时序对比图（BCS / 体重 / FGS），多次拍照看趋势；体重四入口（档案 / 编辑 / 称重 / LLM 口述）统一到单一数据源。
- **分层记忆（记忆 V2）** ⭐：`pet_health_summaries` 滚动健康画像——关键事实由代码确定性计算（体重趋势 / 上次疫苗驱虫 / 近 30 天关注点），叙事由 LLM 增量归纳（事件水位线触发后台再生），~300 token 常驻注入 context，三层降级永不阻塞聊天。agent 把画像当索引自主决定往哪个时间窗挖细节——记忆不是替代工具，是让工具调用变聪明。
- **日程提醒**：APScheduler（UTC 调度 + 启动恢复策略）+ per-user SMTP 邮件，支持疫苗 / 驱虫 / 洗澡 / 体检等。
- **账号体系**：JWT 鉴权 + bcrypt，多用户数据隔离，多宠物切换 + 软删。
- **流式体验**：SSE 12+ 事件类型，前端 `fetch + ReadableStream` 手动解析（EventSource 不支持 multipart 上传）。
- **V4 设计系统**：6 主题（饼干 / 珊瑚 / 薄荷 / 浆果 / 单色 / 暗色），基于 **OKLCH 色彩空间** 保证主题切换的感知一致性；移动端响应式抽屉。

## 目录结构

```
pet/
├── app/                          # 后端
│   ├── main.py                   # FastAPI 入口 + lifespan + CORS + StaticFiles
│   ├── agent/                    # ★ Agent 核心
│   │   ├── planner.py            #   run_agent_stream 主循环 + SSE 事件 + 行为兜底
│   │   ├── tools.py              #   7 个 Function Calling tool schema + dispatch
│   │   ├── router.py             #   5 task 文本路由（含多轮上下文继承）
│   │   ├── vlm.py                #   VLM 5 task prompt + Pydantic schema（含 FGS）
│   │   ├── context.py            #   宠物档案 + 画像 + 最近事件注入 system prompt
│   │   └── memory.py             #   ★ 记忆 V2：滚动健康画像（facts 确定性计算 + LLM 增量归纳）
│   ├── rag/retriever.py          # 三阶段检索：dense + sparse → RRF → rerank
│   ├── auth/                     # JWT 鉴权（security / deps）
│   ├── services/                 # APScheduler 提醒 + SMTP 邮件
│   ├── db/                       # SQLModel 6 表（users/pets/events/reminders/chat_sessions/health_summaries）
│   └── api/                      # REST 路由（agent/pets/events/reminders/sessions/auth/vet）
├── web/src/                      # 前端 React 19
│   ├── pages/                    #   Chat / Dashboard / PetList / PetDetail / Login ...
│   ├── components/               #   卡片流组件 + v4/ 设计系统组件
│   ├── context/                  #   Auth / Pet / Sidebar 全局状态
│   └── hooks/                    #   useSession（per-pet 会话）/ useTheme（6 主题）
├── data/vet_kb/                  # 473 条兽医知识库（21 个 md，YAML frontmatter）
├── eval/                         # 评测：retriever + agent E2E（脚本 + 报告 + 迭代史）
├── docs/                         # 设计文档（memory_v2_design 等）
├── scripts/                      # ingest_kb / MSD 翻译 / seed_demo 黄金账号重置 / smoke tests
├── Dockerfile.backend / Dockerfile.frontend / docker-compose.yml
├── nginx.conf                    # 前端容器反代 /api → backend
└── DEPLOY.md                     # 阿里云 ECS 部署手册
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 · FastAPI · SQLModel + SQLite · APScheduler · PyJWT + bcrypt |
| LLM / VLM | Qwen3-235B-A22B-Instruct-2507（主控）+ Qwen3-VL-235B（视觉），经 OpenRouter |
| 检索 | ChromaDB · sentence-transformers（BGE-small-zh + BGE-reranker-base）· rank-bm25 + jieba |
| 前端 | React 19 · Vite · Tailwind v4 · react-router-dom 7 · Recharts · 原生 fetch SSE |
| 部署 | Docker Compose 双容器（FastAPI + nginx 反代）· 阿里云 ECS |

> 模型最初用 `gpt-4o-mini`，部署到国内 ECS 后因 OpenAI 直连受限，迁移到通义千问 Qwen3 系列。

## 知识库

兽医知识库共 **473 条**，存于 `data/vet_kb/` 的 21 个 markdown（每条带 YAML frontmatter：`species / severity / age_group / emergency / tags / source / source_url`）：

- **133 条手写骨架**：参考 PetMD / AAHA / WSAVA 等权威指南，按系统分类（消化 / 呼吸 / 皮肤 / 眼耳 / 急救 / 行为 / 营养减重等）。
- **293 条 MSD 翻译**：来自 **Merck（默克）兽医手册**——全球兽医百科金标准，覆盖慢性病 / 传染病 / 幼宠抚育 / 营养 / 繁育，GPT-4o 辅助翻译 + 人工 review，急诊红线条目逐字保留。
- **47 条 Cornell 翻译**：康奈尔猫科健康中心——喂养营养 / 饮水 / 老年关怀 / 行为问题专题。

每条切分为一个二级标题块（约 200–400 字，中文 RAG 的较优 chunk 长度）。

## 快速开始（本地）

> 国内网络：向量 / 重排模型走镜像 `HF_ENDPOINT=https://hf-mirror.com`（代码已内置）。

```bash
# 1. 后端
python -m venv .venv
.venv\Scripts\Activate.ps1          # Windows PowerShell；Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt     # 慢可加 -i https://pypi.tuna.tsinghua.edu.cn/simple

cp .env.example .env                 # 填入 OPENROUTER_API_KEY（生成 / VLM 必需）
python scripts/ingest_kb.py          # 知识库灌库（首次下载 BGE 模型 ~100MB）
uvicorn app.main:app --reload --port 8000

# 2. 前端（另开终端）
cd web
pnpm install
pnpm dev                             # 打开 http://localhost:5173
```

### 环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter 密钥（LLM / VLM 必需）|
| `LLM_MODEL` / `VLM_MODEL` | 模型名，默认走 Qwen3 系列 |
| `AMAP_KEY` | 高德 Web API key（找医院功能，可选）|
| `SMTP_*` | 邮件提醒；全部留空 → dry-run 模式（控制台打印，适合演示）|
| `PETPAL_JWT_SECRET` | 生产**必须**设置；dev 有 fallback |
| `PETPAL_DEV_MODE` | `1` 开启 `trigger_now` 等调试入口，生产设 `0` |

## 评测

```bash
python -m eval.eval_retriever     # 检索器多配置 hit@k 对比
python -m eval.eval_agent         # Agent 端到端（多 case × 多 run）
```

报告见 `eval/report_retriever.md` 与 `eval/report_agent.md`。

### 主要结果

- **检索器**（32 query × 4 配置，473 条库）：`hybrid + rerank` **hit@5 93.3% / hit@1 83.3%**——扩库近一倍后原库条目 hit@5 保持 100% 不退化（新增营养库 90%）。OOK（库外问题）top-1 相似度仍显著低于库内（0.639 vs 0.987），可作 agent 判断"无相关知识"的信号。
- **Agent 端到端**（30 case × 3 run = 90，多轮稳定性协议）：经六轮"评测 → 诊断 → 修复"迭代，pass rate 从 38.9% → **86.7%**（稳定通过 23/30，task 路由与工具红线双 100%，中位延迟 ~28s）。其中一次迭代定位到某推理供应商聊天模板对消息角色顺序的隐性要求——完整侦破过程与逐轮归因见 [`eval/iteration_history.md`](./eval/iteration_history.md)。
  （前代 10 case 套件曾达 96.7%；30 case 版补充营养咨询 / 记忆召回 / 工具红线 / OOK 拒答等更难场景。）

## MCP Server

`mcp_server.py` 把三阶段兽医检索封装为 [MCP（Model Context Protocol）](https://modelcontextprotocol.io) 标准工具——任何支持 MCP 的客户端（Claude Code / Claude Desktop / Cursor …）都能像用内置工具一样查询本知识库，无需了解 PetPal 内部实现：

- `search_vet_knowledge(query, top_k, species, emergency_only)`：三阶段混合检索，支持物种 / 急诊过滤
- `get_kb_overview()`：知识库规模与主题概况

```bash
pip install mcp                      # 仅本地工具链需要，不进生产镜像
python scripts/mcp_smoke_test.py     # stdio 冒烟测试：initialize → list_tools → call_tool 全流程
```

Claude Code 一行接入（在仓库根目录、venv 激活状态下）：

```bash
claude mcp add petpal-vet -- python mcp_server.py
```

或在项目 `.mcp.json`：

```json
{ "mcpServers": { "petpal-vet": { "command": "python", "args": ["mcp_server.py"] } } }
```

> 实现细节两则（均为踩坑产物）：① stdio 模式下 stdout 是 JSON-RPC 信道，检索器的模型加载日志已重定向到 stderr；② 检索栈在**启动时**同步加载（约 10–30s）——曾尝试懒加载到首次调用来加速握手，但事件循环运行中做 C 扩展 import 会在 Windows 上触发加载器死锁（py-spy 定位到 numpy DLL 初始化）。因此 Claude Code 用户请调大启动超时：`setx MCP_TIMEOUT 120000`（一次设置永久生效），重开终端后连接。

## 部署

Docker Compose 双容器（backend FastAPI + frontend nginx 反代 `/api`）：

```bash
cp .env.example .env && vim .env     # 填密钥，生产记得 PETPAL_DEV_MODE=0
docker compose up -d --build
curl http://localhost/api/health
```

阿里云 ECS 完整部署步骤（含国内镜像加速、常见踩坑）见 [`DEPLOY.md`](./DEPLOY.md)。

---

## 设计取舍记录

几个值得一提的工程决策：

- **便宜文本路由 vs VLM 路由**：用一次轻量文本调用做 task 分类，比让 VLM 看图后决定便宜 5–10×，且避免路由错时重跑 VLM。
- **Context Engineering > Tool Engineering**：把宠物档案 + 最近事件直接注入 system prompt，减少 agent 反复调 `query_pet_history`。
- **不依赖 LLM 完全听话**：关键行为用工程兜底——`save_pet_event` 去重、RAG 单轮限次、"光说不做"检测重试、`pending_motivation` 补帧（适配 Qwen3 把动作描述与 tool_calls 拆两步输出的行为模式）。
- **emotion 任务诚实标注局限**：单张静态图无法判断动态信号（尾巴抽打 / 呼吸节奏），故输出候选情绪 + 置信度而非断言。
- **LLM 应用的故障面不只在模型和 prompt，还在聊天模板层**：迁移 Qwen 后出现"时好时坏"的空回复，逐层排查（工程兜底 → provider 锁定 → 逐轮埋点 finish_reason/provider → 三变体对照实验）后定位：某供应商的聊天模板要求对话以 user/tool 消息收尾，而所有纠偏重试恰好都以 system 消息结尾——"需要抢救的轮次必死"。7 处纠偏改 user 角色后根治，评测从 38.9% 跳回正轨（完整过程见 `eval/iteration_history.md`）。
- **记忆是分层压缩，不是塞更多消息**：facts 由代码算（可审计可再生）、叙事由 LLM 写（增量归纳）、注入开销恒定与事件总量解耦；评测中"总结健康状况"类 case 由 0/3 → 3/3，还意外让 agent 学会用画像当索引做精准分窗查询。

## License

MIT
