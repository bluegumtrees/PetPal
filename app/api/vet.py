"""兽医知识库搜索 API。"""
from __future__ import annotations

from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.rag.retriever import get_retriever

router = APIRouter(prefix='/api/vet', tags=['vet'])


class SearchResult(BaseModel):
    id: str
    title: str
    body: str
    meta: dict
    file: str
    score: float


class SearchResponse(BaseModel):
    query: str
    count: int
    filters: dict
    results: list[SearchResult]


@router.get('/search', response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1, description='查询文本'),
    top_k: int = Query(5, ge=1, le=20),
    species: Optional[Literal['cat', 'dog']] = Query(None),
    emergency_only: bool = Query(False, description='只看 emergency=true'),
    severity: Optional[Literal['low', 'medium', 'high']] = Query(None),
    rerank: bool = Query(True, description='是否走 CrossEncoder rerank'),
):
    where: dict = {}
    if species == 'cat':
        where['species_cat'] = True
    elif species == 'dog':
        where['species_dog'] = True
    if emergency_only:
        where['emergency'] = True
    if severity:
        where['severity'] = severity

    try:
        retriever = get_retriever()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    results = retriever.search(
        query=q,
        top_k=top_k,
        where=where or None,
        rerank=rerank,
    )
    return SearchResponse(
        query=q,
        count=len(results),
        filters=where,
        results=[SearchResult(**r) for r in results],
    )


@router.get('/stats')
async def stats():
    """知识库统计——前端首页可显示。"""
    try:
        retriever = get_retriever()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    chunks = retriever._chunks  # noqa: SLF001  - 内部用
    total = len(chunks)
    emergency = sum(1 for c in chunks if c['meta'].get('emergency'))
    by_file: dict[str, int] = {}
    for c in chunks:
        by_file[c['file']] = by_file.get(c['file'], 0) + 1
    return {
        'total': total,
        'emergency': emergency,
        'by_file': by_file,
    }
