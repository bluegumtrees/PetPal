"""Agent 端到端 CLI 测试。

跑 5 个 case：
  1. chat - 纯闲聊（无图）
  2. chat - 图片闲聊（无文字 + 图）
  3. symptom - 文字 + 图（猫呕吐物）
  4. emotion - 文字 + 图（黑猫紧张）
  5. bcs + 急诊路线 - 文字 + 图（胖猫 + 假装症状）

每个 case 打印：task / tool_calls 序列 / 最终答案 / 耗时。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

# 使用 production db（用户在 P3 创建的"亚历山大"）
# 如果你想隔离测试，可在跑测试前先 `set PETPAL_DB_PATH=...`

from sqlmodel import select
from app.agent.planner import run_agent
from app.db.database import init_db, session_scope
from app.db.models import Pet

CAT_DIR = Path(r'C:\Users\90968\Desktop\cat')


def get_or_create_test_pet() -> int:
    """如果数据库里没宠物，创建一个测试用的。"""
    init_db()
    with session_scope() as s:
        pet = s.exec(select(Pet).where(Pet.deleted_at.is_(None))).first()
        if pet:
            print(f'[setup] using existing pet: id={pet.id} name={pet.name}')
            return pet.id
        # 创建测试宠物
        pet = Pet(name='测试猫', species='cat', breed='奶牛猫')
        s.add(pet)
        s.commit()
        s.refresh(pet)
        print(f'[setup] created test pet: id={pet.id} name={pet.name}')
        return pet.id


def divider(title: str):
    print(f'\n\n{"="*70}\n  {title}\n{"="*70}')


def print_result(r: dict):
    print(f'\n  task        : {r["task"]}')
    print(f'  iterations  : {r["iterations"]}')
    print(f'  elapsed     : {r["elapsed_s"]}s')
    print(f'  tool_calls  : {len(r["tool_calls"])}')
    for i, tc in enumerate(r['tool_calls'], 1):
        args_str = json.dumps(tc['args'], ensure_ascii=False)[:100]
        print(f'    #{i} iter={tc["iter"]} {tc["tool"]}({args_str})')
        print(f'         → {tc["result_summary"]}')
    print(f'\n  FINAL ANSWER:\n{"─"*60}')
    print(r['final_answer'])
    print('─' * 60)


def main():
    pet_id = get_or_create_test_pet()

    cases = [
        ('chat / no image',
         '你好，我刚领养了一只猫！',
         None),

        ('chat / image only',
         '',
         CAT_DIR / '黑猫放松.jpg'),

        ('symptom / text + image',
         '它今早吐出来这个，没精神，怎么办？',
         CAT_DIR / '猫呕吐物_猫粮冻干猫毛.jpg'),

        ('emotion / text + image',
         '它最近躲着我，是不是不开心？',
         CAT_DIR / '白猫紧张.jpg'),

        ('emergency-ish / text only',
         '我家猫吐了 5 次还带血，附近北京海淀有什么急诊医院？',
         None),
    ]

    for i, (title, text, image) in enumerate(cases, 1):
        divider(f'CASE {i}/{len(cases)}: {title}')
        print(f'  text   : {text!r}')
        print(f'  image  : {image}')
        if image and not image.exists():
            print(f'  ! image not found, skipping')
            continue
        try:
            r = run_agent(
                user_text=text,
                pet_id=pet_id,
                image_path=image,
                verbose=False,
            )
            print_result(r)
        except Exception as e:
            print(f'  ! {type(e).__name__}: {e}')

    print('\n\n[OK] all cases done')


if __name__ == '__main__':
    main()
