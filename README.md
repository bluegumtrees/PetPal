# 🐾 PetPal 智能宠物管家

![Python](https://img.shields.io/badge/Python-3.12-3776ab) ![React](https://img.shields.io/badge/React-19-61dafb) ![License](https://img.shields.io/badge/License-MIT-green) [![Demo](https://img.shields.io/badge/Demo-%E5%9C%A8%E7%BA%BF%E4%BD%93%E9%AA%8C-e8a34f)](http://114.55.95.6/login?demo=1)

宠物主人拍张照片或者说句话，PetPal 识别症状、评估体态、判断疼痛、解读情绪，需要时查兽医知识库、找附近医院、设日程提醒，并把每次发现记进这只宠物自己的健康时间线。多只宠物、长期跟踪。

输入先经文本路由分成 5 类任务，VLM 负责看图，主控 LLM 通过 Function Calling 自主编排 7 个工具，全过程以 SSE 流式推送到前端卡片流。已部署在阿里云 ECS，检索栈另封装为标准 MCP server。

其中一个核心设计：把发表在 *Scientific Reports* 的猫科疼痛量表 FGS（Evangelista et al. 2019）改写成 VLM 的结构化输出 schema，5 个面部动作单元逐项打分、对照 0.39 临床阈值，让通用视觉模型输出有依据、可解释的疼痛评估。

🔗 在线 Demo：http://114.55.95.6/ ，或[一键进入演示账号](http://114.55.95.6/login?demo=1)（两只宠物半年健康档案 + 14 条真实 agent 会话，`scripts/seed_demo.py` 随时一键重置）

<!-- TODO: 招牌流程 GIF 放这里（建议 40s：打开呕吐多轮会话看工具卡片流，切趋势页点 FGS 康复曲线弹出原图；ScreenToGif 录制，900px 宽，10MB 内） -->

---

## 系统架构

```
前端 (React 19 + Vite + Tailwind v4 + 6 主题设计系统)
  卡片流 UI · 图片上传 · 宠物切换 · per-pet 会话持久化 · JWT 登录
        │  POST /api/agent/chat/stream  (multipart: text / image / pet_id / session_id)
        ▼
FastAPI + StreamingResponse (SSE)   async generator + asyncio.to_thread
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

| 模块 | 做了什么 |
|---|---|
| Agent 循环 | LLM 自主决定调哪些工具、什么顺序、调几次；每一步入库可回放，前端卡片流直播决策过程 |
| 临床量表 FGS | 耳位、眼睑、口鼻、胡须、头位五项各 0/1/2 分编进 VLM schema，总分对照 0.39 临床阈值，附判断依据 |
| 多任务视觉 | 症状、情绪、体态（WSAVA 9 分制）、疼痛各有独立 prompt 与 Pydantic 校验；情绪只报候选与置信度，不下断言 |
| 三阶段检索 | 稠密（BGE + Chroma）与稀疏（BM25 + jieba）RRF 融合后 CrossEncoder 重排；473 条知识库带物种、严重度、急诊标签 |
| 分层记忆 | 关键事实由代码计算，健康叙事由 LLM 增量归纳，约 300 token 画像常驻上下文；agent 拿它当索引，自己决定往哪段历史深挖 |
| 长期跟踪 | 体重、BCS、FGS 时序曲线；评估结果产生时旁路入库，图表不依赖模型自觉存档 |
| 日程提醒 | APScheduler 调度加启动恢复；重复提醒触发后自动排下一次，停机跨期会跳到未来时点续上 |
| 行为兜底 | 只说不做、幻觉参数、空回复、重复调用各有代码层护栏，宁可代码多写一层，不赌模型自觉 |
| MCP 接入 | 检索栈封装为标准 MCP server，Claude Code / Claude Desktop / Cursor 可直接调用 |
| 工程底座 | JWT 多用户隔离、SSE 流式（12+ 事件类型）、OKLCH 六主题设计系统、移动端响应式 |

## 评测

```bash
python -m eval.eval_retriever     # 检索器多配置 hit@k 对比
python -m eval.eval_agent         # Agent 端到端（30 case × 3 run）
```

- 检索器（32 query × 4 配置，473 条库）：hybrid + rerank 组合 hit@5 93.3%，hit@1 83.3%，重排单独贡献 hit@1 +30%。扩库近一倍后，原库条目 hit@5 保持 100% 没有退化。库外问题的 top-1 相似度显著低于库内（0.639 对 0.987），agent 可以据此判断"知识库没有相关内容"。
- Agent 端到端（30 case × 3 run，多轮稳定性协议）：六轮"评测、归因、修复"迭代把 pass rate 从 38.9% 提到 86.7%，任务路由与工具红线两项 100%，中位延迟约 28 秒。其中一轮定位到推理供应商聊天模板对消息角色顺序的隐性要求，完整侦破过程见 [`eval/iteration_history.md`](./eval/iteration_history.md)。

报告全文在 `eval/report_retriever.md` 与 `eval/report_agent.md`。

## 知识库

473 条中文兽医知识，存于 `data/vet_kb/` 的 21 个 markdown，每条带 YAML frontmatter（species / severity / emergency / tags / source 等），按二级标题切分为 200 到 400 字的检索单元：

- 133 条手写骨架，参考 PetMD、AAHA、WSAVA 等权威指南，覆盖消化、呼吸、皮肤、急救、行为、营养减重等
- 293 条 Merck 兽医手册（MSD）翻译，覆盖慢性病、传染病、幼宠抚育、营养与繁育，GPT-4o 辅助翻译加人工 review，急诊红线条目逐字保留
- 47 条康奈尔猫科健康中心翻译，喂养、饮水、老年关怀与行为专题

## 目录结构

```
pet/
├── app/                          # 后端
│   ├── main.py                   # FastAPI 入口 + lifespan + CORS + StaticFiles
│   ├── agent/                    # Agent 核心
│   │   ├── planner.py            #   主循环 + SSE 事件 + 行为兜底
│   │   ├── tools.py              #   7 个 tool schema + dispatch
│   │   ├── router.py             #   5 task 文本路由
│   │   ├── vlm.py                #   VLM 各任务 prompt + Pydantic schema
│   │   ├── context.py            #   档案 + 画像 + 最近事件注入
│   │   └── memory.py             #   记忆 V2：滚动健康画像
│   ├── rag/retriever.py          # 三阶段检索
│   ├── auth/ services/ db/ api/  # 鉴权 / 提醒邮件 / SQLModel 6 表 / REST 路由
├── web/src/                      # 前端 React 19
├── data/vet_kb/                  # 473 条兽医知识库
├── eval/                         # 检索与 agent 评测（脚本 + 报告 + 迭代史）
├── docs/                         # 设计文档（memory_v2_design 等）
├── scripts/                      # ingest_kb / seed_demo 黄金账号重置 / MSD 翻译等
└── DEPLOY.md                     # 阿里云 ECS 部署手册
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 · FastAPI · SQLModel + SQLite · APScheduler · PyJWT + bcrypt |
| LLM / VLM | Qwen3-235B-A22B-Instruct-2507 主控 + Qwen3-VL-235B 视觉，经 OpenRouter |
| 检索 | ChromaDB · BGE-small-zh + BGE-reranker-base · rank-bm25 + jieba |
| 前端 | React 19 · Vite · Tailwind v4 · react-router-dom 7 · Recharts · 原生 fetch SSE |
| 部署 | Docker Compose 双容器（FastAPI + nginx 反代）· 阿里云 ECS |

> 最初用 gpt-4o-mini 开发，部署到国内 ECS 后 OpenAI 直连受限，迁移到 Qwen3 系列（迁移的坑见取舍记录）。

## 快速开始（本地）

> 国内网络：向量与重排模型走镜像 `HF_ENDPOINT=https://hf-mirror.com`，代码已内置。

```bash
# 1. 后端
python -m venv .venv
.venv\Scripts\Activate.ps1          # Windows PowerShell；Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt     # 慢可加 -i https://pypi.tuna.tsinghua.edu.cn/simple

cp .env.example .env                 # 填入 OPENROUTER_API_KEY
python scripts/ingest_kb.py          # 知识库灌库（首次下载 BGE 模型约 100MB）
uvicorn app.main:app --reload --port 8000

# 2. 前端（另开终端）
cd web
pnpm install
pnpm dev                             # 打开 http://localhost:5173
```

### 环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter 密钥，LLM 与 VLM 必需 |
| `LLM_MODEL` / `VLM_MODEL` | 模型名，默认 Qwen3 系列 |
| `AMAP_KEY` | 高德 Web API key，找医院功能用，可选 |
| `SMTP_*` | 邮件提醒；留空则走 dry-run 模式，控制台打印，适合演示 |
| `PETPAL_JWT_SECRET` | 生产必须设置；开发环境有 fallback |
| `PETPAL_DEV_MODE` | 设 `1` 开启 `trigger_now` 等调试入口，生产设 `0` |

## MCP Server

`mcp_server.py` 把三阶段兽医检索封装为 [MCP](https://modelcontextprotocol.io) 标准工具，Claude Code、Claude Desktop、Cursor 等客户端可以直接查询这套知识库，不需要了解 PetPal 内部实现：

- `search_vet_knowledge(query, top_k, species, emergency_only)`：混合检索，支持物种与急诊过滤
- `get_kb_overview()`：知识库规模与主题概况

```bash
pip install mcp                      # 仅本地工具链需要，不进生产镜像
python scripts/mcp_smoke_test.py     # stdio 冒烟测试
claude mcp add petpal-vet -- python mcp_server.py   # Claude Code 一行接入
```

两个踩坑记录：stdio 模式下 stdout 是 JSON-RPC 信道，检索器的模型加载日志要重定向到 stderr；检索栈在启动时同步加载（约 10 到 30 秒），曾试过懒加载来加速握手，结果事件循环运行中做 C 扩展 import 在 Windows 上触发加载器死锁（py-spy 定位到 numpy DLL 初始化），所以 Claude Code 用户请调大启动超时 `setx MCP_TIMEOUT 120000`。

## 部署

```bash
cp .env.example .env && vim .env     # 填密钥，生产记得 PETPAL_DEV_MODE=0
docker compose up -d --build
curl http://localhost/api/health
```

阿里云 ECS 完整步骤（含国内镜像加速与常见踩坑）见 [`DEPLOY.md`](./DEPLOY.md)。

---

## 设计取舍记录

- **文本路由，而不是让 VLM 决定**：一次轻量文本调用做任务分类，比让 VLM 看完图再决定便宜 5 到 10 倍，路由错了也不用重跑视觉分析。
- **Context 优先于工具**：宠物档案、健康画像、最近事件直接注入 system prompt，agent 大多数时候不需要调历史查询工具；少一次工具往返就少十几秒延迟。
- **兜底接住失败，但不替模型决策**：早期版本在模型漏存事件时由系统自动补存，上线后发现它会替模型做主、存进大量低价值记录，删掉了。改成评估结果旁路入库（图表不依赖存档行为），模型只存它认为值得记的。同样的克制用在重看图片上：模型重复要求分析同一张图时不报错，直接递给它上次的分析结果，前端把重复卡片藏起来。
- **情绪任务不下断言**：单张静态图判断不了尾巴抽打、呼吸节奏这些动态信号，所以输出候选情绪加置信度，并明确标注局限。
- **LLM 应用的故障面不只在模型和 prompt，还在聊天模板层**：迁移 Qwen 后出现时好时坏的空回复，逐层排查（工程兜底、供应商锁定、逐轮埋点 finish_reason 与 provider、三变体对照实验）后定位：某供应商的聊天模板要求对话以 user 或 tool 消息收尾，而所有纠偏重试恰好都以 system 消息结尾，等于需要抢救的轮次必死。7 处纠偏消息改成 user 角色后根治，评测从 38.9% 回到正轨，完整过程见 `eval/iteration_history.md`。
- **记忆是分层压缩，不是塞更多消息**：关键事实由代码确定性计算（可审计可重算），叙事由 LLM 增量归纳，注入开销恒定、与事件总量无关。上线后"总结健康状况"类评测 case 从 0/3 到 3/3；意外收获是 agent 开始拿画像当索引，自己决定往哪个时间窗做精准查询。

## License

MIT
