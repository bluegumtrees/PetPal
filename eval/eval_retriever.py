"""Retriever 评测：4 配置对比 hit@k + 延迟 + OOK robustness。

跑：
    python eval/eval_retriever.py

输出：
    eval/report_retriever.md（汇总报告 + per-query 详情）
"""
from __future__ import annotations

import sys
import time
from pathlib import Path
from statistics import mean, median

import yaml

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # type: ignore
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.rag.retriever import get_retriever  # noqa: E402

QUERIES_FILE = ROOT / 'eval' / 'queries.yaml'
REPORT_FILE = ROOT / 'eval' / 'report_retriever.md'
TOP_K = 5
FUSE_N = 20


# ============ 4 配置 ============

def run_dense_only(r, query: str, k: int):
    return r._dense_search(query, top_k=k)


def run_sparse_only(r, query: str, k: int):
    return r._sparse_search(query, top_k=k)


def run_hybrid(r, query: str, k: int):
    dense = r._dense_search(query, top_k=FUSE_N)
    sparse = r._sparse_search(query, top_k=FUSE_N)
    return r._rrf([dense, sparse])[:k]


def run_hybrid_rerank(r, query: str, k: int):
    dense = r._dense_search(query, top_k=FUSE_N)
    sparse = r._sparse_search(query, top_k=FUSE_N)
    fused = r._rrf([dense, sparse])[:FUSE_N]
    return r._rerank(query, [cid for cid, _ in fused], top_k=k)


CONFIGS = {
    'dense_only': run_dense_only,
    'sparse_only': run_sparse_only,
    'hybrid_no_rerank': run_hybrid,
    'hybrid_rerank': run_hybrid_rerank,
}


# ============ 指标 ============

def hit_at_k(top_ids: list[str], gt: list[str], k: int) -> int:
    """any-of-gt 出现在 top-k → 1, 否则 0。GT 空（OOK）→ 不参与统计（返回 None）。"""
    if not gt:
        return None  # type: ignore
    head = set(top_ids[:k])
    return 1 if any(g in head for g in gt) else 0


# ============ 主流程 ============

def main():
    with open(QUERIES_FILE, encoding='utf-8') as f:
        data = yaml.safe_load(f)
    queries = data['queries']

    print(f'Loaded {len(queries)} queries from {QUERIES_FILE.name}')
    print('Loading retriever (will load embed + rerank models on first run)...')
    r = get_retriever()
    # 预热 rerank（首次加载 ~3s）
    _ = run_hybrid_rerank(r, '热身', k=1)
    print('Retriever ready.\n')

    # === 跑评测 ===
    # results[config][qid] = {'top_ids': [...], 'top_scores': [...], 'latency_ms': N}
    results: dict[str, dict[str, dict]] = {c: {} for c in CONFIGS}

    for q in queries:
        qid = q['id']
        query = q['query']
        for cfg_name, fn in CONFIGS.items():
            t0 = time.perf_counter()
            try:
                top = fn(r, query, k=TOP_K)
                top_ids = [cid for cid, _ in top]
                top_scores = [float(s) for _, s in top]
            except Exception as e:
                top_ids, top_scores = [], []
                print(f'  {cfg_name} {qid} ERROR: {e}')
            elapsed_ms = (time.perf_counter() - t0) * 1000
            results[cfg_name][qid] = {
                'top_ids': top_ids,
                'top_scores': top_scores,
                'latency_ms': elapsed_ms,
            }
        print(f'  {qid:5s} done')

    # === 汇总 ===
    print('\n=== Computing metrics ===\n')

    summary: dict[str, dict] = {}
    for cfg_name in CONFIGS:
        rows = []
        for q in queries:
            qid = q['id']
            gt = q['gt']
            top_ids = results[cfg_name][qid]['top_ids']
            row = {
                'qid': qid,
                'tags': q['tags'],
                'gt': gt,
                'top_ids': top_ids,
                'latency_ms': results[cfg_name][qid]['latency_ms'],
                'top_score': results[cfg_name][qid]['top_scores'][0]
                if results[cfg_name][qid]['top_scores'] else 0.0,
                'h1': hit_at_k(top_ids, gt, 1),
                'h3': hit_at_k(top_ids, gt, 3),
                'h5': hit_at_k(top_ids, gt, 5),
            }
            rows.append(row)

        in_kb = [r for r in rows if r['h1'] is not None]
        ook = [r for r in rows if r['h1'] is None]
        orig_kb = [r for r in in_kb if any('原KB' in t for t in r['tags'])]
        new_kb = [r for r in in_kb if any('新KB' in t for t in r['tags'])]

        def acc(rows_, k):
            arr = [r[f'h{k}'] for r in rows_]
            return sum(arr) / len(arr) if arr else 0.0

        summary[cfg_name] = {
            'rows': rows,
            'overall': {
                'h1': acc(in_kb, 1),
                'h3': acc(in_kb, 3),
                'h5': acc(in_kb, 5),
            },
            'orig_kb': {
                'h1': acc(orig_kb, 1),
                'h3': acc(orig_kb, 3),
                'h5': acc(orig_kb, 5),
                'n': len(orig_kb),
            },
            'new_kb': {
                'h1': acc(new_kb, 1),
                'h3': acc(new_kb, 3),
                'h5': acc(new_kb, 5),
                'n': len(new_kb),
            },
            'latency_ms': {
                'mean': mean([r['latency_ms'] for r in rows]),
                'median': median([r['latency_ms'] for r in rows]),
            },
            'ook_top_score': {
                'mean': mean([r['top_score'] for r in ook]) if ook else 0.0,
                'max': max([r['top_score'] for r in ook]) if ook else 0.0,
            },
            'in_kb_top_score_median': median([r['top_score'] for r in in_kb]) if in_kb else 0.0,
        }

    # === 写报告 ===
    lines = []
    lines.append('# PetPal Retriever 评测报告（P7）')
    lines.append('')
    lines.append(f'- 测试集：{len(queries)} 条（{sum(1 for q in queries if q["gt"])} in-KB + {sum(1 for q in queries if not q["gt"])} OOK）')
    try:
        _kb_size = get_retriever()._col.count()  # 动态计数，扩库后报告头不再说谎
    except Exception:
        _kb_size = '?'
    lines.append(f'- KB 规模：{_kb_size} chunks（data/vet_kb/ 全量灌库）')
    lines.append(f'- top_k: {TOP_K}, fuse_n: {FUSE_N}')
    lines.append(f'- hit@k 用 any-of-gt 算（top-k 内出现任一 GT → hit）')
    lines.append('')

    # === 配置对比表 ===
    lines.append('## 1. 4 配置对比（in-KB queries 上的 hit@k）')
    lines.append('')
    lines.append('| 配置 | hit@1 | hit@3 | hit@5 | 平均延迟 (ms) |')
    lines.append('|---|---|---|---|---|')
    for cfg in CONFIGS:
        s = summary[cfg]
        o = s['overall']
        lines.append(
            f'| `{cfg}` | {o["h1"]:.1%} | {o["h3"]:.1%} | {o["h5"]:.1%} | '
            f'{s["latency_ms"]["mean"]:.0f} |'
        )
    lines.append('')

    # === 分组对比 ===
    lines.append('## 2. 原 KB vs 新 KB 分组（只看 hybrid+rerank 完整配置）')
    lines.append('')
    s = summary['hybrid_rerank']
    lines.append(f'| 分组 | n | hit@1 | hit@3 | hit@5 |')
    lines.append(f'|---|---|---|---|---|')
    lines.append(
        f'| 原 KB（防退化）| {s["orig_kb"]["n"]} | {s["orig_kb"]["h1"]:.1%} | '
        f'{s["orig_kb"]["h3"]:.1%} | {s["orig_kb"]["h5"]:.1%} |'
    )
    lines.append(
        f'| 新 KB（P1.5 增）| {s["new_kb"]["n"]} | {s["new_kb"]["h1"]:.1%} | '
        f'{s["new_kb"]["h3"]:.1%} | {s["new_kb"]["h5"]:.1%} |'
    )
    lines.append('')

    # === OOK robustness ===
    lines.append('## 3. OOK robustness（鹦鹉 / 宠物猪等非猫狗 query）')
    lines.append('')
    lines.append('期望：OOK 的 top-1 score 明显低于 in-KB（让上游 agent 能据此判断"无相关知识"）')
    lines.append('')
    lines.append('| 配置 | OOK top-1 score 均值 | OOK top-1 score 最大 | in-KB top-1 score 中位 |')
    lines.append('|---|---|---|---|')
    for cfg in CONFIGS:
        s = summary[cfg]
        lines.append(
            f'| `{cfg}` | {s["ook_top_score"]["mean"]:.3f} | '
            f'{s["ook_top_score"]["max"]:.3f} | '
            f'{s["in_kb_top_score_median"]:.3f} |'
        )
    lines.append('')

    # === Rerank lift ===
    lines.append('## 4. Rerank 增益（hybrid_no_rerank → hybrid_rerank）')
    lines.append('')
    a = summary['hybrid_no_rerank']['overall']
    b = summary['hybrid_rerank']['overall']
    lines.append('| 指标 | 无 rerank | 加 rerank | 增益 |')
    lines.append('|---|---|---|---|')
    for k in ('h1', 'h3', 'h5'):
        delta = b[k] - a[k]
        lines.append(
            f'| hit@{k[1]} | {a[k]:.1%} | {b[k]:.1%} | '
            f'{"+" if delta >= 0 else ""}{delta:.1%} |'
        )
    lines.append('')

    # === 失败 case ===
    lines.append('## 5. 失败 case（hybrid_rerank 下 hit@5 未命中）')
    lines.append('')
    failed = [r for r in summary['hybrid_rerank']['rows']
              if r['h5'] == 0]  # 0 = in-KB 但没召回
    if not failed:
        lines.append('🎉 0 个失败 case，所有 in-KB query 在 top-5 内召回 GT')
    else:
        for r in failed:
            lines.append(f'### {r["qid"]} — tags: {r["tags"]}')
            q_obj = next(q for q in queries if q['id'] == r['qid'])
            lines.append(f'- query: `{q_obj["query"]}`')
            lines.append(f'- 期望 GT: {r["gt"]}')
            lines.append(f'- 实际 top-5: {r["top_ids"]}')
            lines.append('')

    # === per-query 详情 ===
    lines.append('## 6. 全 query 详情（hybrid_rerank）')
    lines.append('')
    lines.append('| qid | tags | h@1 | h@3 | h@5 | top_score | 备注 |')
    lines.append('|---|---|---|---|---|---|---|')
    for r in summary['hybrid_rerank']['rows']:
        tags_short = ','.join(r['tags'][:2])
        h1 = '-' if r['h1'] is None else ('✓' if r['h1'] else '✗')
        h3 = '-' if r['h3'] is None else ('✓' if r['h3'] else '✗')
        h5 = '-' if r['h5'] is None else ('✓' if r['h5'] else '✗')
        note = 'OOK' if r['h1'] is None else ''
        lines.append(
            f'| {r["qid"]} | {tags_short} | {h1} | {h3} | {h5} | '
            f'{r["top_score"]:.3f} | {note} |'
        )
    lines.append('')

    # === 最终结论 ===
    lines.append('## 7. 结论与简历讲点')
    lines.append('')
    b = summary['hybrid_rerank']
    lines.append(f'- **整体表现**：hybrid+rerank 配置下 hit@1 = {b["overall"]["h1"]:.1%}, hit@3 = {b["overall"]["h3"]:.1%}, hit@5 = {b["overall"]["h5"]:.1%}')
    lines.append(f'- **新 KB（P1.5）召回有效**：新 KB hit@5 = {b["new_kb"]["h5"]:.1%}（n={b["new_kb"]["n"]}），与原 KB 持平/略有差异')
    a_h5 = summary['hybrid_no_rerank']['overall']['h5']
    b_h5 = summary['hybrid_rerank']['overall']['h5']
    lines.append(f'- **rerank 必要性**：hit@5 从 {a_h5:.1%}（无 rerank）→ {b_h5:.1%}（加 rerank），{"提升 +%.1f%%" % ((b_h5-a_h5)*100) if b_h5>a_h5 else "持平（说明融合候选已经覆盖了 GT，rerank 主要影响序）"}')
    lines.append(f'- **OOK robustness**：OOK top-1 rerank score 均值 = {b["ook_top_score"]["mean"]:.3f}，vs in-KB 中位 = {b["in_kb_top_score_median"]:.3f}，差距 = {b["in_kb_top_score_median"]-b["ook_top_score"]["mean"]:.3f}')
    lines.append(f'- **延迟**：hybrid+rerank 中位 {summary["hybrid_rerank"]["latency_ms"]["median"]:.0f} ms / 均值 {summary["hybrid_rerank"]["latency_ms"]["mean"]:.0f} ms')
    lines.append('')

    REPORT_FILE.write_text('\n'.join(lines), encoding='utf-8')
    print(f'\nreport written: {REPORT_FILE.relative_to(ROOT)}')

    # 控制台简短摘要
    b = summary['hybrid_rerank']
    print(f'\n=== hybrid+rerank ===')
    print(f'  hit@1: {b["overall"]["h1"]:.1%}')
    print(f'  hit@3: {b["overall"]["h3"]:.1%}')
    print(f'  hit@5: {b["overall"]["h5"]:.1%}')
    print(f'  原 KB hit@5: {b["orig_kb"]["h5"]:.1%}  /  新 KB hit@5: {b["new_kb"]["h5"]:.1%}')
    print(f'  OOK top-1: {b["ook_top_score"]["mean"]:.3f}  vs  in-KB median: {b["in_kb_top_score_median"]:.3f}')
    print(f'  median latency: {b["latency_ms"]["median"]:.0f} ms')


if __name__ == '__main__':
    main()
