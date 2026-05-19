"""扔几张图测试 4 个 VLM 任务，看 JSON 输出合不合理。"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from app.agent.vlm import analyze

CAT_DIR = Path(r'C:\Users\90968\Desktop\cat')

# (filename, task, species, extra_user_description)
CASES = [
    # symptom
    ('猫呕吐物_猫粮冻干猫毛.jpg', 'symptom', '猫', '今天早上吐了一次，状态正常'),
    # emotion - 多张对比
    ('黑猫放松.jpg',              'emotion', '猫', None),
    ('白猫紧张.jpg',              'emotion', '猫', None),
    ('黑猫有点紧张.jpg',          'emotion', '猫', None),
    # bcs
    ('猫体态侧身照.jpg',          'bcs',     '猫', None),
    # pain_fgs
    ('黑猫放松.jpg',              'pain_fgs', '猫', None),
    ('白猫紧张.jpg',              'pain_fgs', '猫', None),
]


def main():
    for fname, task, species, extra in CASES:
        path = CAT_DIR / fname
        print(f'\n{"="*70}')
        print(f'  [{task}]  {fname}')
        if extra:
            print(f'  extra: {extra}')
        print('=' * 70)

        if not path.exists():
            print(f'  ! NOT FOUND: {path}')
            continue

        t0 = time.perf_counter()
        try:
            result = analyze(path, task=task, species=species, extra=extra)
        except Exception as e:
            print(f'  ! {type(e).__name__}: {e}')
            continue
        dt = time.perf_counter() - t0

        print(f'  ({dt:.1f}s)')
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
