"""端到端冒烟测试：清库 → CRUD 走一遍 → 软删 → 头像 → 事件。

用 FastAPI TestClient（内存中起 app，不用真跑 uvicorn）。
"""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

# 测试用独立 db 文件，避免和正在跑的 uvicorn 冲突
PROJECT_ROOT = Path(os.path.abspath(os.path.dirname(os.path.dirname(__file__))))
os.environ['PETPAL_DB_PATH'] = str(PROJECT_ROOT / 'data' / 'petpal_test.db')

# 清库（确保幂等）
from app.db.database import DB_PATH
if DB_PATH.exists():
    DB_PATH.unlink()
    print(f'[clean] dropped {DB_PATH}')

# 也清头像（避免上次残留）
import shutil
UPLOAD_PETS = DB_PATH.parent / 'uploads' / 'pets'
if UPLOAD_PETS.exists():
    shutil.rmtree(UPLOAD_PETS)
    print(f'[clean] dropped {UPLOAD_PETS}')

from PIL import Image
from fastapi.testclient import TestClient
from app.main import app
from app.db.database import init_db

# TestClient(app) 不会自动触发 lifespan，需手动建表
init_db()


def section(title: str):
    print(f'\n{"="*60}\n  {title}\n{"="*60}')


client = TestClient(app)


def assert_ok(resp, msg=''):
    if not (200 <= resp.status_code < 300):
        print(f'  ❌ {msg}: HTTP {resp.status_code}  body={resp.text[:200]}')
        sys.exit(1)


# ---------- 1. health ----------
section('1. health')
r = client.get('/api/health')
print(' ', r.json())
assert_ok(r, 'health')

# ---------- 2. create 2 pets ----------
section('2. create 2 pets')
r = client.post('/api/pets', json={
    'name': '小白',
    'species': 'cat',
    'breed': '英短',
    'birthday': '2023-03-15',
    'gender': 'female',
    'neutered': True,
    'weight_kg': 4.2,
})
assert_ok(r, 'create cat')
pet1 = r.json()
print(f"  pet1: id={pet1['id']}  {pet1['name']}  ({pet1['species']}/{pet1['breed']})")

r = client.post('/api/pets', json={
    'name': '大黄',
    'species': 'dog',
    'breed': '金毛',
    'birthday': '2020-08-01',
})
assert_ok(r, 'create dog')
pet2 = r.json()
print(f"  pet2: id={pet2['id']}  {pet2['name']}  ({pet2['species']}/{pet2['breed']})")

# ---------- 3. list ----------
section('3. list pets')
r = client.get('/api/pets')
assert_ok(r)
lst = r.json()
print(f'  count: {len(lst)} (expect 2)')
assert len(lst) == 2

# ---------- 4. patch ----------
section('4. patch pet1 weight 4.2 → 4.5')
r = client.patch(f"/api/pets/{pet1['id']}", json={'weight_kg': 4.5})
assert_ok(r, 'patch')
print(f"  new weight: {r.json()['weight_kg']}")

# ---------- 5. upload avatar ----------
section('5. upload avatar (auto-generate test JPG)')
img = Image.new('RGB', (800, 800), color='#FFA500')
buf = io.BytesIO()
img.save(buf, format='JPEG')
buf.seek(0)

r = client.post(
    f"/api/pets/{pet1['id']}/avatar",
    files={'file': ('test.jpg', buf, 'image/jpeg')},
)
assert_ok(r, 'avatar upload')
print(f"  photo_url: {r.json()['photo_url']}")
photo_url = r.json()['photo_url']

# 验证 StaticFiles 能访问
r = client.get(photo_url)
assert_ok(r, 'avatar fetch via /static')
print(f"  /static fetch: {r.status_code}, content-length={r.headers.get('content-length')}")

# ---------- 6. create events ----------
section('6. create 3 events for pet1')
for ev in [
    {'event_type': 'bcs', 'payload': {'bcs_score': 5, 'rationale': '腰部明显'}},
    {'event_type': 'vaccine', 'payload': {'vaccine': '猫三联', 'batch': 'V123'}},
    {'event_type': 'weight', 'payload': {'weight_kg': 4.5}, 'note': '月度体检'},
]:
    body = {'pet_id': pet1['id'], **ev}
    r = client.post('/api/events', json=body)
    assert_ok(r, f"create event {ev['event_type']}")
    print(f"  +{r.json()['event_type']}  payload={r.json()['payload']}")

# ---------- 7. list events ----------
section('7. list events for pet1')
r = client.get(f"/api/events?pet_id={pet1['id']}")
assert_ok(r)
events = r.json()
print(f'  count: {len(events)} (expect 3)')
assert len(events) == 3

# filter by type
r = client.get(f"/api/events?pet_id={pet1['id']}&event_type=vaccine")
assert_ok(r)
print(f"  filter event_type=vaccine: {len(r.json())} (expect 1)")
assert len(r.json()) == 1

# ---------- 8. soft delete pet2 ----------
section('8. soft delete pet2')
r = client.delete(f"/api/pets/{pet2['id']}")
assert_ok(r, 'soft delete')
print(f'  {r.json()}')

# pet2 should be gone in default list
r = client.get('/api/pets')
print(f"  list after delete: {len(r.json())} (expect 1)")
assert len(r.json()) == 1

# but visible with include_deleted
r = client.get('/api/pets?include_deleted=true')
print(f"  list include_deleted: {len(r.json())} (expect 2)")
assert len(r.json()) == 2

# detail of deleted should 404
r = client.get(f"/api/pets/{pet2['id']}")
print(f"  GET deleted pet detail: HTTP {r.status_code} (expect 404)")
assert r.status_code == 404

# ---------- 9. restore pet2 ----------
section('9. restore pet2')
r = client.post(f"/api/pets/{pet2['id']}/restore")
assert_ok(r, 'restore')
r = client.get('/api/pets')
print(f"  list after restore: {len(r.json())} (expect 2)")
assert len(r.json()) == 2

# ---------- 10. validation errors ----------
section('10. validation errors should be returned cleanly')
r = client.post('/api/pets', json={'name': 'x', 'species': 'hamster'})
print(f"  invalid species: HTTP {r.status_code}  {r.json()}")
assert r.status_code == 400

r = client.post('/api/events', json={'pet_id': 9999, 'event_type': 'bcs', 'payload': {}})
print(f"  event for non-existent pet: HTTP {r.status_code}")
assert r.status_code == 404

print('\n[OK] ALL TESTS PASSED')
