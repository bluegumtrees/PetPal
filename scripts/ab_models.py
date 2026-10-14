# -*- coding: utf-8 -*-
"""模型 A/B：同一组提问跑多个 LLM/VLM 组合，对比延迟、工具调用和回答。

用隔离的数据库跑（PETPAL_DB_PATH 指到一个临时库，先用 seed_demo 灌黄金数据），
走同步 run_agent（不落 chat_sessions），所以不会污染线上 demo 账号。

服务器用法（仓库根目录）：
    docker compose run --rm -T --entrypoint sh \
      -e PETPAL_DB_PATH=/app/data/ab_test.db backend -c \
      "python scripts/seed_demo.py >/dev/null && python scripts/ab_models.py \
         --models qwen=qwen/qwen3-235b-a22b-2507:qwen/qwen3-vl-235b-a22b-instruct:DeepInfra \
                  4o-mini=openai/gpt-4o-mini:openai/gpt-4o-mini: \
                  4o=openai/gpt-4o:openai/gpt-4o:"

--models 每项格式  标签=LLM_MODEL:VLM_MODEL:PROVIDER_ORDER（provider 留空=OpenRouter 自动路由）
报告写到 data/ab_report.md + data/ab_report.json。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ASSETS = ROOT / 'scripts' / 'demo_data' / 'assets'
PET_ID = 23  # 蛋蛋（seed_demo 固定 id）

PROMPTS = [
    ('symptom',   '蛋蛋今天吐了两次，还有点没精神，是怎么回事？', None),
    ('history',   '蛋蛋最近体重趋势怎么样？上次疫苗是什么时候？', None),
    ('reminder',  '下周二早上九点提醒我带蛋蛋去打疫苗', None),
    ('bcs_image', '帮我看看蛋蛋现在的体态', 'cat_body_tire.jpg'),
    ('fgs_image', '蛋蛋这两天老眯着眼，是不是哪里疼？', 'cat_fgs_day3_squint.jpg'),
    ('general',   '猫能吃巧克力吗？', None),
]


def parse_models(specs: list[str]) -> dict[str, dict]:
    out = {}
    for spec in specs:
        label, rest = spec.split('=', 1)
        llm, vlm, provider = (rest.split(':') + ['', ''])[:3]
        out[label] = {'LLM_MODEL': llm, 'VLM_MODEL': vlm or llm, 'LLM_PROVIDER_ORDER': provider}
    return out


def run_one(text: str, image: str | None) -> dict:
    from app.agent.planner import run_agent
    t0 = time.perf_counter()
    try:
        res = run_agent(text, pet_id=PET_ID,
                        image_path=str(ASSETS / image) if image else None, verbose=False)
        calls = []
        for c in res.get('tool_calls') or []:
            args = c.get('args') or c.get('arguments') or {}
            calls.append({'tool': c.get('tool') or c.get('name'),
                          'args': json.dumps(args, ensure_ascii=False)[:220],
                          'status': (c.get('result') or {}).get('status') if isinstance(c.get('result'), dict) else None})
        vlm = res.get('vlm_output') or {}
        vlm_brief = {k: vlm.get(k) for k in ('bcs_score', 'fgs_total', 'score', 'normalized', 'emotion', 'symptom_desc')
                     if isinstance(vlm, dict) and vlm.get(k) is not None}
        return {'ok': True, 'task': res.get('task'), 'iterations': res.get('iterations'),
                'elapsed': round(time.perf_counter() - t0, 1), 'tool_calls': calls,
                'vlm': vlm_brief, 'final': (res.get('final_answer') or '').strip()}
    except Exception as e:  # noqa: BLE001
        return {'ok': False, 'elapsed': round(time.perf_counter() - t0, 1),
                'error': f'{type(e).__name__}: {e}'[:300], 'trace': traceback.format_exc()[-600:]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--models', nargs='+', required=True)
    ap.add_argument('--out', default=str(ROOT / 'data' / 'ab_report'))
    ap.add_argument('--prompts', default='', help='只跑这些提问 id，逗号分隔（默认全部）')
    args = ap.parse_args()
    models = parse_models(args.models)
    global PROMPTS
    if args.prompts:
        keep = {x.strip() for x in args.prompts.split(',') if x.strip()}
        PROMPTS = [p for p in PROMPTS if p[0] in keep]

    results: dict[str, dict[str, dict]] = {}
    for label, env in models.items():
        for k, v in env.items():
            os.environ[k] = v
        results[label] = {}
        print(f'\n===== {label}: LLM={env["LLM_MODEL"]} VLM={env["VLM_MODEL"]} provider={env["LLM_PROVIDER_ORDER"] or "auto"}', flush=True)
        for pid, text, image in PROMPTS:
            r = run_one(text, image)
            results[label][pid] = r
            if r['ok']:
                tools = ','.join(c['tool'] or '?' for c in r['tool_calls']) or '-'
                print(f'  [{pid:10s}] {r["elapsed"]:5.1f}s task={r["task"]:8s} tools={tools} | {r["final"][:60]!r}', flush=True)
            else:
                print(f'  [{pid:10s}] {r["elapsed"]:5.1f}s ERROR {r["error"]}', flush=True)

    # ---- 报告 ----
    out = Path(args.out)
    out.with_suffix('.json').write_text(json.dumps({'models': models, 'results': results}, ensure_ascii=False, indent=2), encoding='utf-8')

    lines = [f'# 模型 A/B 报告 {datetime.now():%Y-%m-%d %H:%M}', '',
             '| 标签 | LLM | VLM | provider |', '|---|---|---|---|']
    for label, env in models.items():
        lines.append(f'| {label} | {env["LLM_MODEL"]} | {env["VLM_MODEL"]} | {env["LLM_PROVIDER_ORDER"] or "auto"} |')
    lines += ['', '## 延迟一览（秒）', '', '| 提问 | ' + ' | '.join(models) + ' |', '|---|' + '---|' * len(models)]
    for pid, _, _ in PROMPTS:
        cells = []
        for label in models:
            r = results[label][pid]
            cells.append(f'{r["elapsed"]}' if r['ok'] else f'ERR')
        lines.append(f'| {pid} | ' + ' | '.join(cells) + ' |')
    lines += ['', '## 工具调用一览', '', '| 提问 | ' + ' | '.join(models) + ' |', '|---|' + '---|' * len(models)]
    for pid, _, _ in PROMPTS:
        cells = []
        for label in models:
            r = results[label][pid]
            cells.append(('<br>'.join(c['tool'] or '?' for c in r['tool_calls']) or '-') if r['ok'] else 'ERR')
        lines.append(f'| {pid} | ' + ' | '.join(cells) + ' |')
    for pid, text, image in PROMPTS:
        lines += ['', f'## {pid}：{text}' + (f'（图：{image}）' if image else ''), '']
        for label in models:
            r = results[label][pid]
            lines.append(f'### {label}（{r["elapsed"]}s）')
            if not r['ok']:
                lines += ['', f'ERROR: {r["error"]}', '']
                continue
            if r['vlm']:
                lines.append(f'- VLM: `{json.dumps(r["vlm"], ensure_ascii=False)}`')
            for c in r['tool_calls']:
                lines.append(f'- `{c["tool"]}` {c["args"]}' + (f' → {c["status"]}' if c['status'] else ''))
            lines += ['', r['final'], '']
    out.with_suffix('.md').write_text('\n'.join(lines), encoding='utf-8')
    print(f'\n报告: {out.with_suffix(".md")}', flush=True)


if __name__ == '__main__':
    main()
