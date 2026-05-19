"""
将 data/vet_kb/*.md 解析 + 切 chunk + 入库。
- Chroma 持久化到 data/chroma/
- BM25 + chunks 元数据 持久化到 data/chroma/bm25.pkl

运行（项目根目录下）：
    python scripts/ingest_kb.py
"""
from __future__ import annotations

import os
import sys
# 必须在 import sentence_transformers / chromadb 之前
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')

# Windows PowerShell 默认 GBK，强制 stdout/stderr UTF-8 避免 emoji 编码挂掉
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import re
import pickle
from pathlib import Path

import yaml
import jieba
import chromadb
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parent.parent
KB_DIR = ROOT / 'data' / 'vet_kb'
CHROMA_DIR = ROOT / 'data' / 'chroma'
BM25_FILE = CHROMA_DIR / 'bm25.pkl'

COLLECTION = 'petpal_vet'
EMBED_MODEL = 'BAAI/bge-small-zh-v1.5'

# 兽医专有名词，加入 jieba 词典
JIEBA_WORDS = [
    '细小病毒', '犬瘟', '猫瘟', '猫白血病', '心丝虫', '皮肤真菌',
    '气管塌陷', '髌骨脱位', '胃扭转', '胰腺炎', 'BCS', 'PU/PD',
    '柏油样便', '反向喷嚏', '犬窝咳', '猫癣', '脂肪肝',
    '葡萄毒性', '巧克力中毒', '木糖醇', '布洛芬',
    '对乙酰氨基酚', '伊维菌素', '塞拉菌素', '阿福拉纳',
    '肥厚性心肌病', '多囊肾', '钩端螺旋体',
    'BOAS', '扁鼻犬', 'IBD', 'HGE',
]
for w in JIEBA_WORDS:
    jieba.add_word(w)


def parse_md(md_path: Path) -> list[dict]:
    """按 ^## 切分文件，提取 frontmatter + 正文"""
    content = md_path.read_text(encoding='utf-8')
    # P1.5: 剥离 HTML 注释（merge_review.py 把术语对照表包成 <!-- ... --> 放文件末尾，参考用不入库）
    content = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
    parts = re.split(r'^(?=## )', content, flags=re.MULTILINE)
    chunks = []
    for part in parts[1:]:
        m = re.match(r'## ([^\n]+)\n---\n(.*?)\n---\n(.*)', part, re.DOTALL)
        if not m:
            print(f'  ⚠ skip malformed: {md_path.name}: {part[:60].strip()}...')
            continue
        title = m.group(1).strip()
        try:
            meta = yaml.safe_load(m.group(2)) or {}
        except yaml.YAMLError as e:
            print(f'  ⚠ YAML error in {md_path.name} :: {title}: {e}')
            continue
        body = m.group(3).strip()
        chunks.append({
            'title': title,
            'body': body,
            'meta': meta,
            'file': md_path.stem,
        })
    return chunks


def chunk_to_doc(chunk: dict) -> str:
    """生成用于 embedding + BM25 的文本（标题进入语义空间）"""
    return f"{chunk['title']}\n\n{chunk['body']}"


def chunk_to_chroma_meta(chunk: dict) -> dict:
    """转换为 Chroma metadata（只支持 str/int/float/bool/None）"""
    m = chunk['meta']
    species = m.get('species') or []
    age_group = m.get('age_group') or []
    tags = m.get('tags') or []
    file_stem = chunk['file']
    # category 从文件名（去掉数字前缀）
    parts = file_stem.split('_')
    category = '_'.join(parts[1:]) if len(parts) > 1 else file_stem
    return {
        'title': chunk['title'],
        'category': category,
        'file': file_stem,
        'species_cat': '猫' in species,
        'species_dog': '狗' in species,
        'severity': str(m.get('severity', 'low')),
        'age_young': '幼' in age_group,
        'age_adult': '成' in age_group,
        'age_senior': '老' in age_group,
        'emergency': bool(m.get('emergency', False)),
        'tags': ','.join(tags) if isinstance(tags, list) else str(tags),
        'source': str(m.get('source', '')),
        'source_url': str(m.get('source_url', '')),
    }


def main() -> None:
    print(f'KB dir   : {KB_DIR}')
    print(f'Chroma   : {CHROMA_DIR}')
    print(f'HF mirror: {os.environ.get("HF_ENDPOINT")}')
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)

    # ---- 1. 解析所有 md ----
    print('\n=== Parsing markdown ===')
    all_chunks: list[dict] = []
    for md_path in sorted(KB_DIR.glob('*.md')):
        chunks = parse_md(md_path)
        print(f'  {md_path.name:40s}  {len(chunks):3d} chunks')
        all_chunks.extend(chunks)
    print(f'Total: {len(all_chunks)} chunks')

    if not all_chunks:
        print('No chunks parsed, abort.')
        return

    # ---- 2. 加载 embed 模型 ----
    print(f'\n=== Loading embed model: {EMBED_MODEL} (may download ~95MB on first run) ===')
    embedder = SentenceTransformer(EMBED_MODEL)

    # ---- 3. 生成 embeddings ----
    print('\n=== Embedding documents ===')
    docs = [chunk_to_doc(c) for c in all_chunks]
    embeddings = embedder.encode(
        docs,
        batch_size=32,
        normalize_embeddings=True,
        show_progress_bar=True,
    )

    # ---- 4. 写入 Chroma ----
    print('\n=== Writing to Chroma ===')
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    try:
        client.delete_collection(COLLECTION)
        print(f'  dropped old collection: {COLLECTION}')
    except Exception:
        pass
    col = client.get_or_create_collection(
        name=COLLECTION,
        metadata={'hnsw:space': 'cosine'},
    )

    # 自动 dedup：同 file 内重复 title 加 #2 / #3 后缀，避免 Chroma DuplicateIDError
    ids: list[str] = []
    seen: dict[str, int] = {}
    for c in all_chunks:
        base = f"{c['file']}::{c['title']}"
        seen[base] = seen.get(base, 0) + 1
        cid = base if seen[base] == 1 else f'{base}#{seen[base]}'
        ids.append(cid)
    dup_count = sum(v - 1 for v in seen.values() if v > 1)
    if dup_count:
        print(f'  ⚠ dedup: {dup_count} duplicate title(s) got #N suffix')
    metas = [chunk_to_chroma_meta(c) for c in all_chunks]
    col.add(
        ids=ids,
        documents=docs,
        metadatas=metas,
        embeddings=embeddings.tolist(),
    )
    print(f'Chroma collection "{COLLECTION}" now has {col.count()} docs.')

    # ---- 5. 构建 + 持久化 BM25 ----
    print('\n=== Building BM25 ===')
    tokenized = [list(jieba.cut(d)) for d in docs]
    bm25 = BM25Okapi(tokenized)

    chunks_with_id = []
    for cid, chunk in zip(ids, all_chunks):
        chunks_with_id.append({
            'id': cid,
            'title': chunk['title'],
            'body': chunk['body'],
            'meta': chunk['meta'],
            'file': chunk['file'],
        })

    with open(BM25_FILE, 'wb') as f:
        pickle.dump({
            'bm25': bm25,
            'chunks': chunks_with_id,
            'embed_model': EMBED_MODEL,
        }, f)
    size_kb = BM25_FILE.stat().st_size / 1024
    print(f'BM25 saved: {BM25_FILE.name} ({size_kb:.1f} KB)')

    print('\n[OK] Ingest complete')


if __name__ == '__main__':
    main()
