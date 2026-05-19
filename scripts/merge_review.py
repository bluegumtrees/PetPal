"""把 data/vet_kb/_review/<group>_*.md 合并到 4 个主文件。

每个 _review 文件的 "## 术语对照" 段抽出来，按文件 stem 分组放主文件最末尾的
HTML 注释里（ingest_kb.py 已加 re.sub 剥离 HTML 注释 → 不入库 / 不污染 embed）。

主体 ## 条目按 group 顺序 cat 到对应主文件。

用法：
    python scripts/merge_review.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # type: ignore
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
REVIEW_DIR = ROOT / 'data' / 'vet_kb' / '_review'
KB_DIR = ROOT / 'data' / 'vet_kb'

OUTPUT = {
    'B': ('12_chronic_senior.md', '慢性病 / 老年高发'),
    'C': ('13_digestive_food.md', '消化 / 食物相关'),
    'D': ('14_behavior_msd.md', '行为问题'),
    'E': ('15_emergency_infectious.md', '急诊 / 严重感染'),
}

INTRO_TEMPLATE = """# {title}

> 主题来自 MSD Veterinary Manual（Merck 默克兽医手册）owner 版，GPT-4o 翻译 + 人工 review。
> 每个 `## ` 块为独立检索单元，含机器可读 frontmatter。

"""


def split_main_and_terms(content: str) -> tuple[str, str]:
    """切出主体（正常 ## 条目段）+ 末尾 ## 术语对照段。

    术语对照段以 "## 术语对照" 开头，整段（不含标题行）作为 terms 返回。
    """
    # 匹配 "## 术语对照..." 开头的一行 + 之后所有内容
    m = re.search(r'^## 术语对照[^\n]*\n', content, flags=re.MULTILINE)
    if not m:
        return content.strip(), ''
    main = content[:m.start()].rstrip()
    terms_body = content[m.end():].rstrip()  # 去掉标题行，只保留术语列表
    return main, terms_body


def main():
    for group, (filename, title) in OUTPUT.items():
        files = sorted(REVIEW_DIR.glob(f'{group}_*.md'))
        if not files:
            print(f'group {group}: no review files, skip')
            continue

        main_blocks: list[str] = []
        terms_blocks: list[str] = []
        for fp in files:
            content = fp.read_text(encoding='utf-8')
            main, terms = split_main_and_terms(content)
            main_blocks.append(
                f'<!-- source: _review/{fp.name} -->\n\n{main}'
            )
            if terms:
                terms_blocks.append(f'### {fp.stem}\n{terms}')

        body = INTRO_TEMPLATE.format(title=title)
        body += '\n\n'.join(main_blocks)
        body += '\n\n'
        if terms_blocks:
            body += '<!-- 术语对照（参考用，不入库；ingest_kb.py 已剥离 HTML 注释）\n\n'
            body += '\n\n'.join(terms_blocks)
            body += '\n\n-->\n'

        out_path = KB_DIR / filename
        out_path.write_text(body, encoding='utf-8')
        print(f'wrote {filename}: {len(main_blocks)} review files merged, {len(body)} chars')


if __name__ == '__main__':
    main()
