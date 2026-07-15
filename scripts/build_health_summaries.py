# -*- coding: utf-8 -*-
"""记忆 V2 回填：为宠物生成/重生成滚动健康画像。

用法：
    python scripts/build_health_summaries.py            # 所有未删除宠物
    python scripts/build_health_summaries.py 23 24      # 指定 pet_id

服务器（部署后跑一次，之后由 save_pet_event 水位线自动维护）：
    docker compose exec backend python scripts/build_health_summaries.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # type: ignore
except Exception:
    pass

from sqlmodel import Session, select  # noqa: E402

from app.agent.memory import compute_health_facts, facts_to_template_text, generate_summary_llm  # noqa: E402
from app.db.database import _engine, init_db  # noqa: E402
from app.db.models import Pet  # noqa: E402


def main() -> None:
    init_db()
    ids = [int(a) for a in sys.argv[1:]] if len(sys.argv) > 1 else None
    with Session(_engine) as s:
        pets = s.exec(select(Pet).where(Pet.deleted_at.is_(None))).all()
        if ids:
            pets = [p for p in pets if p.id in ids]
        for p in pets:
            print(f'== {p.name} (id={p.id}) ==')
            facts = compute_health_facts(p.id, s)
            print('  facts 模板:', facts_to_template_text(facts, p.name)[:120], '…')
            ok = generate_summary_llm(p.id, s)
            print('  LLM 画像:', '✓' if ok else '✗（降级模板兜底可用）')


if __name__ == '__main__':
    main()
