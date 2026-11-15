# 🐾 PetPal — Multimodal Pet-Care Agent

**English** | [中文](README.zh.md)

![Python](https://img.shields.io/badge/Python-3.12-3776ab) ![React](https://img.shields.io/badge/React-19-61dafb) ![License](https://img.shields.io/badge/License-MIT-green) [![Demo](https://img.shields.io/badge/Demo-live-e8a34f)](https://petpal-ai.top/login?demo=1)

A pet owner sends a photo or a sentence. PetPal does five things:
- recognises symptoms;
- scores body condition;
- assesses pain;
- reads emotion;
- when needed, it searches a veterinary knowledge base, finds nearby clinics or sets reminders.

Every finding is written to that pet's own health timeline, so several pets can be followed over months.

How it works:
- A text router sorts each request into one of 5 task types.
- A vision-language model (VLM) reads the image.
- A controlling LLM orchestrates 7 tools through function calling.
- The whole process streams to the front end over SSE as a feed of cards.
- The retrieval stack is also packaged as a standard MCP server.

One core design: I turned the **Feline Grimace Scale** (FGS; Evangelista et al., *Scientific Reports* 2019) into a structured-output schema for the VLM. The model scores 5 facial action units one by one and compares the total with the 0.39 clinical threshold. A general vision model therefore gives a pain assessment that is grounded and explainable.

🔗 **Live demo:** https://petpal-ai.top/ — or [enter the demo account in one click](https://petpal-ai.top/login?demo=1). It has two pets with six months of health records and 14 real agent conversations. `scripts/seed_demo.py` resets it at any time.

> The user interface and the knowledge base are in Chinese.

---

## Architecture

```
Front end (React 19 + Vite + Tailwind v4, 6-theme design system)
  card feed UI · image upload · pet switcher · per-pet sessions · JWT login
        │  POST /api/agent/chat/stream  (multipart: text / image / pet_id / session_id)
        ▼
FastAPI + StreamingResponse (SSE)   async generator + asyncio.to_thread
        │
  ① Router     classify_task(text, has_image) → symptom / bcs / pain_fgs / emotion / chat
  ② VLM        task-specific prompt (e.g. FGS 5-AU schema) → Pydantic validation + retry
  ③ Context    pet profile + long-term health summary (memory v2) + last 5 events + VLM output
  ④ Agent loop (max_iter=7)
        │   LLM(messages, tools) → tool_calls → execute → feed results back → repeat
        │   ├─ retrieve_vet_knowledge   vet RAG (three-stage retrieval)
        │   ├─ save_pet_event / update_pet_event   write / extend the timeline
        │   ├─ reanalyze_image          look at an earlier image again (new task / focus)
        │   ├─ find_nearby_clinic       map POI search
        │   ├─ schedule_reminder        APScheduler reminders
        │   └─ query_pet_history        older history
  ⑤ Persistence every message is stored (session_id / tool_calls_json / vlm_output_json, fully auditable)
        │
        ▼
Retrieval (Chroma vectors + BM25/jieba → RRF → CrossEncoder rerank)
Storage (SQLModel + SQLite, 6 tables) · map web API · SMTP / APScheduler
```

## Key features

| Module | What it does |
|---|---|
| Agent loop | The LLM decides which tools to call, in what order and how often. Every step is stored and can be replayed, and the card feed shows each decision live. |
| Clinical scale (FGS) | Ear position, orbital tightening, muzzle tension, whiskers and head position are each scored 0/1/2 in the VLM schema. The total is compared with the 0.39 threshold, with reasons. |
| Multi-task vision | Symptoms, emotion, body condition (WSAVA 9-point scale) and pain each have their own prompt and Pydantic validation. Emotion is reported as candidates with confidence, never as a verdict. |
| Three-stage retrieval | Dense (BGE + Chroma) and sparse (BM25 + jieba) results are fused with RRF, then re-ranked by a CrossEncoder. The 473-entry knowledge base carries species, severity and emergency tags. |
| Layered memory | Key facts are computed by code, and the health narrative is summarised incrementally by the LLM. A profile of about 300 tokens stays in context, and the agent uses it as an index to decide which part of history to query. |
| Long-term tracking | Weight, body-condition and FGS curves over time. Assessment results are stored on a side path, so charts do not depend on the model choosing to save them. |
| Reminders | APScheduler with recovery on restart. Repeating reminders schedule their next run, and missed runs after downtime skip forward to the next future time. |
| Guardrails | Code-level guards for 15+ failure modes: saying but not doing (detected and retried), hallucinated arguments, empty replies, repeated calls, auto-extraction of a missing weight, reuse of an earlier image analysis, blocking invented addresses, and more. |
| MCP | The retrieval stack is a standard MCP server that Claude Code, Claude Desktop or Cursor can call directly. |
| Engineering base | JWT multi-user isolation, SSE streaming (12+ event types), OKLCH six-theme design system, responsive mobile layout. |

## Evaluation

```bash
python -m eval.eval_retriever     # retriever configurations compared on hit@k
python -m eval.eval_agent         # agent end to end (30 cases × 3 runs)
```

- **Retriever** (32 queries × 4 configurations, 473-entry library).
  - Hybrid + rerank reaches hit@5 93.3% and hit@1 83.3%. Re-ranking alone adds 30 points of hit@1.
  - After the library nearly doubled, hit@5 on the original entries stayed at 100%.
  - Out-of-library questions have a much lower top-1 similarity than in-library ones (0.639 vs 0.987), so the agent can tell when the knowledge base has nothing relevant.
- **Agent end to end** (30 cases × 3 runs, multi-turn stability protocol).
  - Six rounds of evaluate → diagnose → fix raised the pass rate from 38.9% to 86.7%.
  - Task routing and tool red lines are both at 100%, and the median latency is about 28 s.
  - One round traced a failure to a hidden requirement in an inference provider's chat template about message-role order. The full investigation is in [`eval/iteration_history.md`](./eval/iteration_history.md).

The full reports are `eval/report_retriever.md` and `eval/report_agent.md`.

## Knowledge base

473 Chinese veterinary entries in 21 markdown files under `data/vet_kb/`. Each entry has YAML front matter (species, severity, emergency, tags, source and so on) and is split by second-level heading into retrieval units of 200–400 characters.

- 133 hand-written core entries, based on guidelines such as PetMD, AAHA and WSAVA. They cover digestion, respiration, skin, first aid, behaviour, nutrition and weight loss.
- 293 entries translated from the MSD (Merck) Veterinary Manual, covering chronic and infectious disease, raising young animals, nutrition and breeding. They were translated with GPT-4o and reviewed by hand, and emergency red-line entries are kept word for word.
- 47 entries translated from the Cornell Feline Health Center: feeding, drinking, senior care and behaviour.

## Repository layout

```
pet/
├── app/                          # back end
│   ├── main.py                   # FastAPI entry + lifespan + CORS + StaticFiles
│   ├── agent/                    # agent core
│   │   ├── planner.py            #   main loop + SSE events + guardrails
│   │   ├── tools.py              #   7 tool schemas + dispatch
│   │   ├── router.py             #   5-task text router
│   │   ├── vlm.py                #   VLM prompts + Pydantic schemas per task
│   │   ├── context.py            #   profile + summary + recent events injection
│   │   └── memory.py             #   memory v2: rolling health summary
│   ├── rag/retriever.py          # three-stage retrieval
│   ├── auth/ services/ db/ api/  # auth / reminder e-mail / SQLModel 6 tables / REST routes
├── web/src/                      # React 19 front end
├── data/vet_kb/                  # 473-entry vet knowledge base
├── eval/                         # retrieval and agent evaluation (scripts, reports, iteration history)
├── docs/                         # design docs (memory_v2_design etc.)
├── scripts/                      # ingest_kb / seed_demo reset / MSD translation, etc.
└── DEPLOY.md                     # deployment guide
```

## Tech stack

| Layer | Technology |
|---|---|
| Back end | Python 3.12 · FastAPI · SQLModel + SQLite · APScheduler · PyJWT + bcrypt |
| LLM / VLM | Qwen3-235B-A22B-Instruct-2507 as controller + Qwen3-VL-235B for vision, via OpenRouter |
| Retrieval | ChromaDB · BGE-small-zh + BGE-reranker-base · rank-bm25 + jieba |
| Front end | React 19 · Vite · Tailwind v4 · react-router-dom 7 · Recharts · native fetch SSE |
| Deployment | Docker Compose, two containers (FastAPI + nginx reverse proxy) on a cloud VM |

> Development started with gpt-4o-mini. After deployment, direct OpenAI access was restricted in the hosting region, so the project moved to the Qwen3 family. The pitfalls are in the design notes below.

## Quick start (local)

```bash
# 1. Back end
python -m venv .venv
.venv\Scripts\Activate.ps1          # Windows PowerShell; Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env                 # add OPENROUTER_API_KEY
python scripts/ingest_kb.py          # build the knowledge base (first run downloads ~100 MB of BGE models)
uvicorn app.main:app --reload --port 8000

# 2. Front end (second terminal)
cd web
pnpm install
pnpm dev                             # open http://localhost:5173
```

### Environment variables (`.env`)

| Variable | Meaning |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter key, required for LLM and VLM |
| `LLM_MODEL` / `VLM_MODEL` | model names, Qwen3 by default |
| `AMAP_KEY` | map web API key for the clinic finder, optional |
| `SMTP_*` | e-mail reminders; if empty, dry-run mode prints to the console |
| `PETPAL_JWT_SECRET` | required in production; development has a fallback |
| `PETPAL_DEV_MODE` | `1` enables debug endpoints such as `trigger_now`; use `0` in production |

## MCP server

`mcp_server.py` exposes the three-stage vet retrieval as standard [MCP](https://modelcontextprotocol.io) tools. Clients such as Claude Code, Claude Desktop and Cursor can query the knowledge base without knowing PetPal's internals.

- `search_vet_knowledge(query, top_k, species, emergency_only)`: hybrid search with species and emergency filters.
- `get_kb_overview()`: size and topics of the knowledge base.

```bash
pip install mcp                      # local tooling only, not in the production image
python scripts/mcp_smoke_test.py     # stdio smoke test
claude mcp add petpal-vet -- python mcp_server.py   # add to Claude Code in one line
```

Two lessons:
- In stdio mode, stdout is the JSON-RPC channel, so the retriever's model-loading logs must go to stderr.
- The retrieval stack loads synchronously at start-up (about 10–30 s). I tried lazy loading to speed up the handshake. Importing C extensions while the event loop was running then deadlocked the loader on Windows (py-spy traced it to numpy DLL initialisation). Claude Code users should therefore raise the start-up timeout: `setx MCP_TIMEOUT 120000`.

## Deployment

```bash
cp .env.example .env && vim .env     # add keys; set PETPAL_DEV_MODE=0 in production
docker compose up -d --build
curl http://localhost/api/health
```

Step-by-step server notes are in [`DEPLOY.md`](./DEPLOY.md).

---

## Design notes

- **A text router, not the VLM, chooses the task.** One light text call classifies the request. This is 5–10× cheaper than letting the VLM look first, and a wrong route does not require re-running the vision analysis.
- **Context before tools.** Pet profile, health summary and recent events go straight into the system prompt, so the agent rarely needs the history tool. Each tool round trip saved is more than ten seconds of latency.
- **Guardrails catch failures but do not decide for the model.**
  - An early version auto-saved events the model forgot to save. In production it overruled the model and filled the timeline with low-value records, so I removed it.
  - Instead, assessment results are stored on a side path, so charts do not depend on saving behaviour. The model saves only what it considers worth keeping.
  - The same restraint applies to images: if the model asks to analyse the same image again, it gets its previous analysis back instead of an error, and the front end hides the duplicate card.
- **The emotion task does not give verdicts.** A single still image cannot show dynamic signals such as tail lashing or breathing rhythm, so the output is candidate emotions with confidence, and the limits are stated.
- **LLM applications can fail in the chat-template layer, not only in the model or prompt.**
  - After moving to Qwen, empty replies appeared intermittently.
  - I investigated layer by layer: engineering guards, pinning the provider, per-turn logging of finish_reason and provider, and a three-variant controlled experiment.
  - The cause: one provider's chat template expects a conversation to end with a user or tool message, and every corrective retry ended with a system message. The turns that most needed rescue were therefore always lost.
  - Changing 7 corrective messages to the user role fixed it, and the evaluation recovered from 38.9%. Details are in `eval/iteration_history.md`.
- **Memory is layered compression, not more messages.**
  - Key facts are computed deterministically by code, so they can be audited and recomputed. The narrative is summarised incrementally by the LLM.
  - The injection cost is constant and independent of the number of events.
  - After launch, the "summarise this pet's health" evaluation cases went from 0/3 to 3/3. An unexpected gain: the agent began to use the profile as an index and chose for itself which time window to query.

## License

MIT
