"""把 MSD Veterinary Manual 文章翻译 + 改写成中文知识库条目（落到 data/vet_kb/_review/）。

用法：
    python scripts/translate_msd.py --sample 2        # 只跑前 2 条
    python scripts/translate_msd.py --groups B        # 只跑 B 组
    python scripts/translate_msd.py                    # 全跑 48 条
    python scripts/translate_msd.py --resume          # 跳过已生成的（默认就是 resume）

设计：
- 抓 MSD HTML → BeautifulSoup 取 <main> → 调 OpenRouter gpt-4o 翻译
- 每篇拆 2-3 个独立检索单元（## 标题 + frontmatter + 三栏正文）
- 末尾附 ## 术语对照 (10 条以内) 供人工 review，**不入库**（merge 主文件时手动剔除）
- 落到 data/vet_kb/_review/<group>_<##>_<slug>.md，等用户 review + merge

不依赖 PetMD 那条死路。MSD = Merck Vet Manual，全球兽医百科金标准。
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI

# Windows GBK 控制台 emoji 兜底
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # type: ignore
except Exception:
    pass

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
REVIEW_DIR = ROOT / 'data' / 'vet_kb' / '_review'
REVIEW_DIR.mkdir(parents=True, exist_ok=True)

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
BASE_URL = 'https://www.merckvetmanual.com'
MODEL = 'openai/gpt-4o'

# 48 条文章：(group, topic_zh, path)
ARTICLES: list[tuple[str, str, str]] = [
    # ===== B 慢性病 / 老年高发（12） =====
    ('B', '猫慢性肾病 (CKD)', '/cat-owners/kidney-and-urinary-tract-disorders-of-cats/noninfectious-diseases-of-the-urinary-system-of-cats'),
    ('B', '狗骨关节炎', '/dog-owners/bone-joint-and-muscle-disorders-of-dogs/osteoarthritis-degenerative-joint-disease'),
    ('B', '猫甲亢', '/cat-owners/hormonal-disorders-of-cats/disorders-of-the-thyroid-gland-in-cats'),
    ('B', '狗甲减', '/dog-owners/hormonal-disorders-of-dogs/disorders-of-the-thyroid-gland-in-dogs'),
    ('B', '狗库欣综合征', '/dog-owners/hormonal-disorders-of-dogs/disorders-of-the-adrenal-glands-in-dogs'),
    ('B', '猫糖尿病/胰腺', '/cat-owners/hormonal-disorders-of-cats/disorders-of-the-pancreas-in-cats'),
    ('B', '狗糖尿病/胰腺', '/dog-owners/hormonal-disorders-of-dogs/disorders-of-the-pancreas-in-dogs'),
    ('B', '狗心衰', '/dog-owners/heart-and-blood-vessel-disorders-of-dogs/heart-failure-in-dogs'),
    ('B', '猫心病/HCM', '/cat-owners/heart-and-blood-vessel-disorders-of-cats/heart-disease-and-heart-failure-in-cats'),
    ('B', '狗白内障 (晶状体)', '/dog-owners/eye-disorders-of-dogs/disorders-of-the-lens-in-dogs'),
    ('B', '狗青光眼', '/dog-owners/eye-disorders-of-dogs/glaucoma-in-dogs'),
    ('B', '狗牙周/口腔病', '/dog-owners/digestive-disorders-of-dogs/dental-disorders-of-dogs'),

    # ===== C 消化 / 食物相关（12） =====
    ('C', '狗食物过敏', '/dog-owners/skin-disorders-of-dogs/allergies-in-dogs'),
    ('C', '猫食物过敏', '/cat-owners/skin-disorders-of-cats/allergies-of-cats'),
    ('C', '狗呕吐综述', '/dog-owners/digestive-disorders-of-dogs/vomiting-in-dogs'),
    ('C', '猫呕吐综述', '/cat-owners/digestive-disorders-of-cats/vomiting-in-cats'),
    ('C', '狗肝胆病', '/dog-owners/digestive-disorders-of-dogs/disorders-of-the-liver-and-gallbladder-in-dogs'),
    ('C', '猫肝病/脂肪肝', '/cat-owners/digestive-disorders-of-cats/disorders-of-the-liver-and-gallbladder-in-cats'),
    ('C', '狗胃肠紊乱', '/dog-owners/digestive-disorders-of-dogs/disorders-of-the-stomach-and-intestines-in-dogs'),
    ('C', '猫胃肠紊乱', '/cat-owners/digestive-disorders-of-cats/disorders-of-the-stomach-and-intestines-in-cats'),
    ('C', '狗胃肠寄生虫', '/dog-owners/digestive-disorders-of-dogs/gastrointestinal-parasites-of-dogs'),
    ('C', '猫胃肠寄生虫', '/cat-owners/digestive-disorders-of-cats/gastrointestinal-parasites-of-cats'),
    ('C', '狗胰腺炎', '/dog-owners/digestive-disorders-of-dogs/pancreatitis-and-other-disorders-of-the-pancreas-in-dogs'),
    ('C', '狗食道紊乱', '/dog-owners/digestive-disorders-of-dogs/disorders-of-the-esophagus-in-dogs'),

    # ===== D 行为（12） =====
    ('D', '狗行为问题 meta', '/dog-owners/behavior-of-dogs/behavior-problems-in-dogs'),
    ('D', '狗行为修正方法', '/dog-owners/behavior-of-dogs/behavior-modification-in-dogs'),
    ('D', '狗诊断行为问题', '/dog-owners/behavior-of-dogs/diagnosing-behavior-problems-in-dogs'),
    ('D', '狗正常社会行为', '/dog-owners/behavior-of-dogs/normal-social-behavior-in-dogs'),
    ('D', '狗行为综述 intro', '/dog-owners/behavior-of-dogs/introduction-to-behavior-of-dogs'),
    ('D', '猫行为问题', '/cat-owners/behavior-of-cats/behavior-problems-in-cats'),
    ('D', '猫行为治疗', '/cat-owners/behavior-of-cats/treatment-of-behavior-problems-in-cats'),
    ('D', '猫诊断行为问题', '/cat-owners/behavior-of-cats/diagnosing-behavior-problems-in-cats'),
    ('D', '猫正常社会行为', '/cat-owners/behavior-of-cats/normal-social-behavior-in-cats'),
    ('D', '猫行为综述', '/cat-owners/behavior-of-cats/introduction-to-behavior-of-cats'),
    ('D', '狗晕车', '/dog-owners/brain-spinal-cord-and-nerve-disorders-of-dogs/motion-sickness-in-dogs'),
    ('D', '猫晕车', '/cat-owners/brain-spinal-cord-and-nerve-disorders-of-cats/motion-sickness-in-cats'),

    # ===== E 急诊 / 严重感染（12） =====
    ('E', '狗肉毒中毒', '/dog-owners/disorders-affecting-multiple-body-systems-of-dogs/botulism-in-dogs'),
    ('E', '狗破伤风', '/dog-owners/disorders-affecting-multiple-body-systems-of-dogs/tetanus-in-dogs'),
    ('E', '狗狂犬病', '/dog-owners/brain-spinal-cord-and-nerve-disorders-of-dogs/rabies-in-dogs'),
    ('E', '猫狂犬病', '/cat-owners/brain-spinal-cord-and-nerve-disorders-of-cats/rabies-in-cats'),
    ('E', '狗蜱虫瘫痪', '/dog-owners/brain-spinal-cord-and-nerve-disorders-of-dogs/tick-paralysis-in-dogs'),
    ('E', '狗 Lyme 病', '/dog-owners/disorders-affecting-multiple-body-systems-of-dogs/lyme-disease-lyme-borreliosis-in-dogs'),
    ('E', '狗钩端螺旋体', '/dog-owners/disorders-affecting-multiple-body-systems-of-dogs/leptospirosis-in-dogs'),
    ('E', '狗心丝虫', '/dog-owners/heart-and-blood-vessel-disorders-of-dogs/heartworm-disease-in-dogs'),
    ('E', '猫心丝虫', '/cat-owners/heart-and-blood-vessel-disorders-of-cats/heartworm-disease-in-cats'),
    ('E', '狗弓形虫', '/dog-owners/disorders-affecting-multiple-body-systems-of-dogs/toxoplasmosis-in-dogs'),
    ('E', '猫弓形虫', '/cat-owners/disorders-affecting-multiple-body-systems-of-cats/toxoplasmosis-in-cats'),
    ('E', '狗恶性高热 (中暑相关)', '/dog-owners/metabolic-disorders-of-dogs/malignant-hyperthermia-in-dogs'),
]


EXAMPLE_FORMAT = """## 症状-呕吐-频繁反复
---
species: [猫, 狗]
severity: medium
age_group: [成, 老]
emergency: false
tags: [呕吐, 慢性, 胃肠炎, 胰腺炎, IBD]
source: Cornell Feline Health Center
source_url: https://www.vet.cornell.edu/...
---

### 表现
24 小时内呕吐 3 次以上，或连续多日间断呕吐。可能病因：胰腺炎、炎症性肠病（IBD）、胃肠异物、肾病、寄生虫、食物过敏。

### 家庭处理
**禁止自行喂人用止吐药**。停食 4-6 小时后仍呕吐应就医，期间记录呕吐物颜色、性状、次数。

### 何时就医
**24 小时内反复呕吐即应就医**。猫连续 2-3 天每日呕吐需查胰腺炎/IBD。"""


SYSTEM_PROMPT_TEMPLATE = """你是宠物医学知识库编辑专家。把 MSD Veterinary Manual（Merck 默克兽医手册，全球兽医百科金标准）的 owner 版英文文章翻译并改写成中文知识库条目，每篇拆 **2-3 个独立检索单元**（不要堆成一篇长文）。

# 输出格式严格遵守

每个独立单元以 `## 标题` 开头，紧接 frontmatter（`---` 包夹的 YAML），然后是三栏正文。

例子：

{example}

# frontmatter 字段约定

- `species`: `[猫]` / `[狗]` / `[猫, 狗]`
- `severity`: `low` / `medium` / `high` / `critical`（按原文严重程度）
- `age_group`: `[幼, 成, 老]` 子集
- `emergency`: `true` / `false`（"立即就医""急诊""immediate veterinary attention" → true）
- `tags`: 3-6 个中文关键词（包括疾病名、英文缩写如 CKD/HCM、典型症状）
- `source`: `MSD Veterinary Manual`
- `source_url`: `{url}`

# 任务

1. **拆分**：从原文里识别 2-3 个独立的具体子主题，每个一个 `##` 条目。标题用「主题-X-Y」格式（如「老年-CKD-早期信号」「行为-异食癖-应对」「中毒-肉毒-神经症状」）。
2. **翻译**：术语用中文兽医标准译法：
   - chronic kidney disease → 慢性肾病 / CKD
   - hyperthyroidism → 甲亢
   - inflammatory bowel disease → 炎症性肠病 / IBD
   - tick paralysis → 蜱虫瘫痪
   - heartworm → 心丝虫
   - osteoarthritis → 骨关节炎
   - separation anxiety → 分离焦虑
   - botulism → 肉毒中毒
3. **正文三栏**：
   - `### 表现` — 3-5 行，含可观察特征 + 主人能见症状
   - `### 家庭处理` — 2-4 行，明确"禁止自行 X""停喂 Y"等警告
   - `### 何时就医` — **保留原文数字阈值**（24h / 3 次 / 体温 >X℃ / 24-48h 内 等）。**急诊红线不要软化**——原文说"emergency"或"immediate veterinary attention"必须翻成"立即就医""急诊就医"。

# 末尾输出术语对照

整个文件最后附一段：

```
## 术语对照（review 用，merge 时删除）
- chronic kidney disease (CKD) — 慢性肾病
- xxx — xxx
（10 条以内英中术语对，供人工 review）
```

# 严格规则

- 标题、frontmatter、正文用纯中文（除 CKD/IBD/HCM 等业内通用缩写）
- **不要发明原文没有的具体数字 / 剂量 / 时间窗口**
- 急诊场景（中毒、严重出血、呼吸困难、抽搐、休克等）→ `emergency: true` 且 `severity: high` 或 `critical`
- 同一篇文章里**不要重复主题**：如果"呕吐综述"原文里讲了"偶发"和"频繁"两种，可拆 2 条；不要写 3 条都讲呕吐
- 输出**只含 `## 条目` + 末尾术语对照**，不要前后说明话、不要 markdown 代码块包裹整个输出"""


def fetch_article(path: str) -> tuple[str, str]:
    """抓 MSD 文章正文。返回 (cleaned_text, full_url)。"""
    url = BASE_URL + path
    r = requests.get(url, headers={'User-Agent': UA}, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f'fetch {url} → status {r.status_code}')
    soup = BeautifulSoup(r.text, 'lxml')
    main = soup.find('main')
    if main is None:
        raise RuntimeError(f'no <main> tag in {url}')
    # 噪声剔除
    for sel in ('nav', 'aside', 'footer', 'script', 'style',
                '[class*=related]', '[class*=Related]',
                '[class*=breadcrumb]', '[class*=Breadcrumb]',
                '[class*=share]', '[class*=Share]'):
        for tag in main.select(sel):
            tag.decompose()
    text = main.get_text(separator='\n', strip=True)
    # gpt-4o 输入限 + 节省 token
    if len(text) > 14000:
        text = text[:14000] + '\n[...truncated for length...]'
    return text, url


def translate_one(client: OpenAI, topic_zh: str, path: str) -> str:
    body, url = fetch_article(path)
    system = (
        SYSTEM_PROMPT_TEMPLATE
        .replace('{example}', EXAMPLE_FORMAT)
        .replace('{url}', url)
    )
    user = (
        f'文章主题（中文参考）：{topic_zh}\n'
        f'文章 URL：{url}\n\n'
        f'--- MSD 原文（英文）---\n{body}'
    )
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ],
        temperature=0.3,
        max_tokens=3500,
    )
    return resp.choices[0].message.content or ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sample', type=int, help='只跑前 N 条（用于试运行）')
    ap.add_argument('--groups', type=str, help='只跑指定组，用逗号分隔，如 B,C')
    ap.add_argument('--force', action='store_true', help='覆盖已生成的文件')
    ap.add_argument('--sleep', type=float, default=2.0, help='请求间隔秒数')
    args = ap.parse_args()

    items = ARTICLES
    if args.groups:
        wanted = set(g.strip().upper() for g in args.groups.split(','))
        items = [a for a in items if a[0] in wanted]
    if args.sample:
        items = items[: args.sample]

    if not os.getenv('OPENROUTER_API_KEY'):
        print('ERROR: OPENROUTER_API_KEY not set in .env')
        sys.exit(1)

    client = OpenAI(
        api_key=os.getenv('OPENROUTER_API_KEY'),
        base_url=os.getenv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    )

    print(f'[translate_msd] {len(items)} articles to process (model={MODEL})')
    print(f'[translate_msd] output dir: {REVIEW_DIR.relative_to(ROOT)}/')
    print()

    n_done = 0
    n_skipped = 0
    n_failed = 0
    for i, (group, topic, path) in enumerate(items, 1):
        slug = path.rstrip('/').split('/')[-1]
        out_path = REVIEW_DIR / f'{group}_{i:02d}_{slug}.md'
        if out_path.exists() and not args.force:
            print(f'[{i:02d}/{len(items)}] {group} {topic} — skip (already exists)')
            n_skipped += 1
            continue
        print(f'[{i:02d}/{len(items)}] {group} {topic}')
        try:
            result = translate_one(client, topic, path)
            if not result.strip():
                raise RuntimeError('empty response')
            out_path.write_text(result, encoding='utf-8')
            print(f'         → {out_path.relative_to(ROOT)}  ({len(result)} chars)')
            n_done += 1
        except Exception as e:
            print(f'         ERROR: {e}')
            n_failed += 1
        if i < len(items):
            time.sleep(args.sleep)

    print()
    print(f'done. {n_done} written, {n_skipped} skipped, {n_failed} failed.')


if __name__ == '__main__':
    main()
