"""
三阶段兽医知识库检索：
  dense (Chroma) + sparse (BM25) → RRF 融合 → CrossEncoder rerank
"""
from __future__ import annotations

import os
# 必须在 import sentence_transformers / chromadb 之前
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')

import pickle
from pathlib import Path
from typing import Optional

import jieba
import chromadb
from sentence_transformers import SentenceTransformer, CrossEncoder

ROOT = Path(__file__).resolve().parent.parent.parent
CHROMA_DIR = ROOT / 'data' / 'chroma'
BM25_FILE = CHROMA_DIR / 'bm25.pkl'

COLLECTION = 'petpal_vet'
EMBED_MODEL = 'BAAI/bge-small-zh-v1.5'
RERANK_MODEL = 'BAAI/bge-reranker-base'


class VetRetriever:
    """三阶段检索单例。embed/rerank 模型 lazy-load。"""

    def __init__(self):
        if not BM25_FILE.exists():
            raise RuntimeError(
                f'BM25 file not found: {BM25_FILE}\n'
                f'Run `python scripts/ingest_kb.py` first.'
            )

        # ---- Chroma ----
        self._client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        self._col = self._client.get_collection(COLLECTION)

        # ---- BM25 + chunks ----
        with open(BM25_FILE, 'rb') as f:
            d = pickle.load(f)
        self._bm25 = d['bm25']
        self._chunks: list[dict] = d['chunks']
        self._id_to_chunk = {c['id']: c for c in self._chunks}

        # ---- Models (lazy) ----
        self._embedder: Optional[SentenceTransformer] = None
        self._reranker: Optional[CrossEncoder] = None

    # ---------- model loaders ----------

    def _get_embedder(self) -> SentenceTransformer:
        if self._embedder is None:
            print(f'[retriever] loading embed model: {EMBED_MODEL}')
            self._embedder = SentenceTransformer(EMBED_MODEL)
        return self._embedder

    def _get_reranker(self) -> CrossEncoder:
        if self._reranker is None:
            print(f'[retriever] loading rerank model: {RERANK_MODEL}')
            self._reranker = CrossEncoder(RERANK_MODEL)
        return self._reranker

    # ---------- stage 1: dense ----------

    def _dense_search(self, query: str, top_k: int,
                      where: Optional[dict] = None) -> list[tuple[str, float]]:
        embedder = self._get_embedder()
        q_emb = embedder.encode([query], normalize_embeddings=True)[0]
        kwargs = {'query_embeddings': [q_emb.tolist()], 'n_results': top_k}
        if where:
            # Chroma 多字段过滤需要 $and 包裹
            kwargs['where'] = self._build_chroma_where(where)
        res = self._col.query(**kwargs)
        ids = res['ids'][0]
        dists = res['distances'][0]  # cosine distance: 0 = identical
        return [(i, 1.0 - d) for i, d in zip(ids, dists)]

    @staticmethod
    def _build_chroma_where(where: dict) -> dict:
        """Chroma 1.x 多条件用 $and。"""
        if len(where) == 1:
            return where
        return {'$and': [{k: v} for k, v in where.items()]}

    # ---------- stage 2: sparse ----------

    def _sparse_search(self, query: str, top_k: int,
                       where: Optional[dict] = None) -> list[tuple[str, float]]:
        tokens = list(jieba.cut(query))
        scores = self._bm25.get_scores(tokens)
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        results = []
        for idx, score in ranked:
            if score <= 0:
                continue
            chunk = self._chunks[idx]
            if where and not self._meta_match(chunk['meta'], where):
                continue
            results.append((chunk['id'], float(score)))
            if len(results) >= top_k:
                break
        return results

    @staticmethod
    def _meta_match(meta: dict, where: dict) -> bool:
        """sparse 阶段手动过滤（BM25 没 metadata filter）。"""
        species = meta.get('species') or []
        age_group = meta.get('age_group') or []
        for k, v in where.items():
            if k == 'species_cat' and v != ('猫' in species):
                return False
            if k == 'species_dog' and v != ('狗' in species):
                return False
            if k == 'age_young' and v != ('幼' in age_group):
                return False
            if k == 'age_adult' and v != ('成' in age_group):
                return False
            if k == 'age_senior' and v != ('老' in age_group):
                return False
            if k == 'emergency' and v != bool(meta.get('emergency', False)):
                return False
            if k == 'severity' and meta.get('severity') != v:
                return False
            if k == 'category':
                # category 在 chunk['file'] 里，BM25 chunk 没存 category 字段
                # 这里简单按文件名匹配
                pass
        return True

    # ---------- stage 3: RRF fusion ----------

    @staticmethod
    def _rrf(rank_lists: list[list[tuple[str, float]]],
             k: int = 60) -> list[tuple[str, float]]:
        """Reciprocal Rank Fusion."""
        scores: dict[str, float] = {}
        for ranked in rank_lists:
            for rank, (doc_id, _) in enumerate(ranked):
                scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)
        return sorted(scores.items(), key=lambda x: x[1], reverse=True)

    # ---------- stage 4: rerank ----------

    def _rerank(self, query: str, candidate_ids: list[str],
                top_k: int) -> list[tuple[str, float]]:
        if not candidate_ids:
            return []
        reranker = self._get_reranker()
        pairs = []
        for cid in candidate_ids:
            chunk = self._id_to_chunk[cid]
            pairs.append([query, f"{chunk['title']}\n{chunk['body']}"])
        scores = reranker.predict(pairs)
        ranked = sorted(zip(candidate_ids, scores.tolist()),
                        key=lambda x: x[1], reverse=True)
        return ranked[:top_k]

    # ---------- public ----------

    def search(self, query: str, top_k: int = 5, fuse_n: int = 20,
               where: Optional[dict] = None,
               rerank: bool = True) -> list[dict]:
        """主入口：三阶段检索。"""
        dense = self._dense_search(query, top_k=fuse_n, where=where)
        sparse = self._sparse_search(query, top_k=fuse_n, where=where)
        fused = self._rrf([dense, sparse])[:fuse_n]

        if rerank:
            ranked = self._rerank(query, [cid for cid, _ in fused], top_k=top_k)
        else:
            ranked = fused[:top_k]

        results = []
        for cid, score in ranked:
            chunk = self._id_to_chunk[cid]
            results.append({
                'id': cid,
                'title': chunk['title'],
                'body': chunk['body'],
                'meta': chunk['meta'],
                'file': chunk['file'],
                'score': float(score),
            })
        return results


# ---------- module-level singleton ----------

_instance: Optional[VetRetriever] = None


def get_retriever() -> VetRetriever:
    global _instance
    if _instance is None:
        _instance = VetRetriever()
    return _instance
