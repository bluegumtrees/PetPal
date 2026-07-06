"""
PetPal Vet KB - MCP Server

把 PetPal 的三阶段兽医知识库检索（dense + BM25 → RRF → CrossEncoder rerank）
封装为 MCP (Model Context Protocol) 标准工具。任何支持 MCP 的客户端
（Claude Code / Claude Desktop / Cursor 等）都能像内置工具一样调用本知识库，
无需了解 PetPal 的内部实现。

运行（stdio 传输）：
    python mcp_server.py

依赖：pip install mcp（仅本地工具链需要，不进生产镜像）；
检索本身复用项目已有依赖与 data/chroma 索引（先跑 scripts/ingest_kb.py）。
"""
from __future__ import annotations

import contextlib
import sys

from mcp.server.fastmcp import FastMCP

from app.rag.retriever import get_retriever

mcp = FastMCP('petpal-vet-kb')

# stdio 模式下 stdout 是 JSON-RPC 信道，检索器的模型加载日志必须改道 stderr
_to_stderr = lambda: contextlib.redirect_stdout(sys.stderr)  # noqa: E731

_SPECIES_WHERE = {'cat': 'species_cat', 'dog': 'species_dog'}


@mcp.tool()
def search_vet_knowledge(
    query: str,
    top_k: int = 3,
    species: str | None = None,
    emergency_only: bool = False,
) -> str:
    """三阶段混合检索中文兽医知识库（257 条：MSD 默克兽医手册翻译 + 手写骨架）。

    适用于宠物症状、护理、急救、行为等问题的专业知识查询。

    Args:
        query: 中文自然语言问题，例如“猫一直吐怎么办”。
        top_k: 返回条数，默认 3。
        species: 可选物种过滤，"cat" 或 "dog"。
        emergency_only: 只返回急诊红线条目。
    """
    where: dict = {}
    if species in _SPECIES_WHERE:
        where[_SPECIES_WHERE[species]] = True
    if emergency_only:
        where['emergency'] = True

    with _to_stderr():
        results = get_retriever().search(query, top_k=top_k, where=where or None)

    if not results:
        return '知识库中未找到相关内容。'

    blocks = []
    for i, r in enumerate(results, 1):
        meta = r['meta']
        tags = []
        if meta.get('emergency'):
            tags.append('急诊红线')
        if meta.get('severity'):
            tags.append(f"severity={meta['severity']}")
        tag_str = f"，{'，'.join(tags)}" if tags else ''
        source = meta.get('source') or r['file']
        blocks.append(
            f"[{i}] {r['title']}（score={r['score']:.3f}{tag_str}）\n"
            f"来源: {source}\n"
            f"{r['body']}"
        )
    return '\n\n'.join(blocks)


@mcp.tool()
def get_kb_overview() -> str:
    """返回兽医知识库概况：条目总数、主题文件数、急诊条目数、物种覆盖。"""
    with _to_stderr():
        retriever = get_retriever()

    chunks = retriever._chunks  # 只读统计，直接用检索器已加载的 chunk 表
    files = sorted({c['file'] for c in chunks})
    n_emergency = sum(1 for c in chunks if c['meta'].get('emergency'))
    n_cat = sum(1 for c in chunks if '猫' in (c['meta'].get('species') or []))
    n_dog = sum(1 for c in chunks if '狗' in (c['meta'].get('species') or []))

    lines = [
        f'知识库共 {len(chunks)} 条，覆盖 {len(files)} 个主题文件。',
        f'急诊红线条目 {n_emergency} 条；涉及猫 {n_cat} 条、狗 {n_dog} 条。',
        '主题文件：' + '、'.join(f.replace('.md', '') for f in files),
    ]
    return '\n'.join(lines)


if __name__ == '__main__':
    mcp.run()
