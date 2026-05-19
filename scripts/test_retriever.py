"""临时 smoke test - 验证三阶段检索能跑通。"""
from __future__ import annotations

import os
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# 让 app.* 能 import
sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from app.rag.retriever import get_retriever

QUERIES = [
    '猫呕吐带血',
    '狗咳嗽',
    'BCS 5 是什么',
    '幼犬疫苗',
    '误食巧克力',
]

r = get_retriever()

for q in QUERIES:
    print(f'\n=== {q} (no rerank) ===')
    rs = r.search(q, top_k=3, rerank=False)
    for i, x in enumerate(rs):
        print(f'  #{i+1} [{x["score"]:.3f}] {x["title"]}  ({x["file"]})')

print('\n\n#### with rerank (will download reranker on first run) ####')
for q in QUERIES:
    print(f'\n=== {q} (rerank) ===')
    rs = r.search(q, top_k=3, rerank=True)
    for i, x in enumerate(rs):
        print(f'  #{i+1} [{x["score"]:.3f}] {x["title"]}  ({x["file"]})')
