"""测试 SSE 流式接口 + sessions 加载。

直接调 run_agent_stream + TestClient（不真启动 uvicorn）。
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from sqlmodel import select
from fastapi.testclient import TestClient

from app.agent.planner import run_agent_stream
from app.db.database import init_db, session_scope
from app.db.models import ChatSession, Pet
from app.main import app

init_db()

CAT_DIR = Path(r'C:\Users\90968\Desktop\cat')


def get_test_pet_id() -> int:
    with session_scope() as s:
        pet = s.exec(select(Pet).where(Pet.deleted_at.is_(None))).first()
        if pet:
            print(f'[setup] using existing pet: id={pet.id} name={pet.name}')
            return pet.id
        pet = Pet(name='测试猫', species='cat', breed='奶牛猫')
        s.add(pet)
        s.commit()
        s.refresh(pet)
        return pet.id


# ============ 1. Async generator direct test ============

async def test_stream_direct(pet_id: int, session_id: str):
    print(f'\n{"="*70}\n  TEST 1: run_agent_stream(...) 直接 yield 事件\n{"="*70}')
    print(f'  pet_id={pet_id}  session_id={session_id}')

    events = []
    async for ev in run_agent_stream(
        user_text='它今早吐了一次，没什么精神',
        pet_id=pet_id,
        session_id=session_id,
        image_path=None,
    ):
        events.append(ev)
        t = ev.get('type')
        if t == 'start':
            print(f'\n  [{t}]')
        elif t == 'task_classified':
            print(f'  [{t}] task={ev["task"]}')
        elif t == 'iter_start':
            print(f'  [{t}] iter={ev["iter"]}')
        elif t == 'tool_call':
            args = json.dumps(ev["args"], ensure_ascii=False)[:120]
            print(f'  [{t}] {ev["tool"]}({args})')
        elif t == 'tool_result':
            print(f'  [{t}] {ev["tool"]} → {ev["summary"]}')
        elif t == 'assistant_thinking':
            print(f'  [{t}] {ev["content"][:80]}')
        elif t == 'final_answer':
            print(f'\n  [final_answer]')
            print('  ' + '─'*60)
            print('  ' + ev['content'].replace('\n', '\n  '))
            print('  ' + '─'*60)
        elif t == 'done':
            print(f'  [{t}] iters={ev["iterations"]} elapsed={ev["elapsed_s"]}s tools={ev["tool_calls_count"]}')
        elif t == 'error':
            print(f'  [ERROR] {ev["detail"]}')
        else:
            print(f'  [{t}] {ev}')

    return events


# ============ 2. HTTP SSE via TestClient ============

def test_stream_http(pet_id: int, session_id: str):
    print(f'\n\n{"="*70}\n  TEST 2: POST /api/agent/chat/stream (SSE)\n{"="*70}')
    client = TestClient(app)

    types_seen = []
    final_answer = None
    with client.stream(
        'POST',
        '/api/agent/chat/stream',
        data={
            'pet_id': str(pet_id),
            'session_id': session_id,
            'text': '附近上海徐汇有什么宠物医院？',
        },
    ) as resp:
        if resp.status_code != 200:
            print(f'  ! HTTP {resp.status_code}: {resp.read().decode()[:300]}')
            return
        print(f'  HTTP {resp.status_code}, content-type: {resp.headers.get("content-type")}')
        for line in resp.iter_lines():
            if not line:
                continue
            if line.startswith('data: '):
                ev = json.loads(line[6:])
                types_seen.append(ev.get('type'))
                t = ev.get('type')
                if t == 'tool_call':
                    print(f'    [tool_call] {ev["tool"]}')
                elif t == 'tool_result':
                    print(f'    [tool_result] {ev["tool"]} → {ev["summary"]}')
                elif t == 'final_answer':
                    final_answer = ev['content']
                elif t == 'done':
                    print(f'    [done] {ev}')

    print(f'\n  events seen: {types_seen[:15]}...')
    if final_answer:
        print(f'  final: {final_answer[:200]}')


# ============ 3. Sessions API ============

def test_sessions_api(pet_id: int, session_id: str):
    print(f'\n\n{"="*70}\n  TEST 3: GET /api/sessions/* (history)\n{"="*70}')
    client = TestClient(app)

    # list
    r = client.get(f'/api/sessions?pet_id={pet_id}')
    print(f'  GET /api/sessions?pet_id={pet_id}')
    print(f'    -> {r.status_code}, count={len(r.json())}')
    for s in r.json()[:3]:
        print(f'    session_id={s["session_id"][:8]}... msgs={s["message_count"]} last_at={s["last_at"][:19]}')

    # detail
    r = client.get(f'/api/sessions/{session_id}/messages')
    print(f'\n  GET /api/sessions/{session_id[:8]}.../messages')
    print(f'    -> {r.status_code}, message count={len(r.json())}')
    for m in r.json():
        head = m['content'][:60].replace('\n', ' ')
        tc_summary = f' [+{len(m["tool_calls"])} tools]' if m.get('tool_calls') else ''
        print(f'    [{m["role"]:9s}] {head}{tc_summary}')


async def main():
    pet_id = get_test_pet_id()
    session_id = str(uuid.uuid4())

    await test_stream_direct(pet_id, session_id)
    test_stream_http(pet_id, session_id)  # 注意：复用同一个 session_id 加历史
    test_sessions_api(pet_id, session_id)

    print('\n\n[OK] all stream tests done')


if __name__ == '__main__':
    asyncio.run(main())
