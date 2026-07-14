# -*- coding: utf-8 -*-
"""黄金演示账号一键重置。

把 demo 账号（demo@petpal.local）恢复到出厂黄金状态：
  2 只宠物 + 56 条事件 + 8 条提醒 + 12 条录制会话，
  全部时间戳以「运行时刻」为锚点相对铺开（最近活动 = 昨天），
  所以每次面试 / 给 HR 发简历前跑一遍，账号永远是「一直在用」的新鲜状态。

用法（服务器，仓库根目录）：
    docker compose exec backend python scripts/seed_demo.py
    docker compose restart backend        # 让 APScheduler 重新注册未来提醒

本地开发：
    python scripts/seed_demo.py           # 用 data/petpal.db
    PETPAL_DB_PATH=... python scripts/seed_demo.py

数据来源：scripts/demo_data/bundle.json（单一事实来源）+ assets/ 照片。
幂等：先清空 demo 用户全部数据（含历史测试遗留），再整体重建。
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlmodel import Session, select, delete  # noqa: E402

from app.db.database import _engine, init_db  # noqa: E402
from app.db.models import ChatSession, Pet, PetEvent, Reminder, User  # noqa: E402
from app.auth.security import hash_password  # noqa: E402
from app.services.email import build_reminder_email  # noqa: E402
from app.api.reminders import _build_preview_subject  # noqa: E402

DD = ROOT / 'scripts' / 'demo_data'
ASSETS = DD / 'assets'
UPLOADS = ROOT / 'data' / 'uploads'

DEMO_EMAIL = 'demo@petpal.local'
DEMO_PASSWORD = 'demo123'
BJ = timezone(timedelta(hours=8))


def anchor_dt(day: int, hhmm: str) -> datetime:
    """相对天数 + 墙钟时间 → naive 本地 datetime（事件 / 会话用）。"""
    h, m = map(int, hhmm.split(':'))
    d = datetime.now() + timedelta(days=day)
    return d.replace(hour=h, minute=m, second=0, microsecond=0)


def to_naive_utc(local_naive: datetime) -> datetime:
    """本地（北京）墙钟 → naive UTC（reminders 表约定）。"""
    return (local_naive.replace(tzinfo=BJ).astimezone(timezone.utc)).replace(tzinfo=None)


def main() -> None:
    bundle = json.loads((DD / 'bundle.json').read_text(encoding='utf-8'))
    init_db()

    with Session(_engine) as s:
        # ---- demo 用户 ----
        demo = s.exec(select(User).where(User.email == DEMO_EMAIL)).first()
        if not demo:
            demo = User(email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD),
                        name='Demo 试用账号', is_demo=True)
            s.add(demo)
            s.commit()
            s.refresh(demo)
            print(f'[user] created demo user id={demo.id}')
        else:
            print(f'[user] demo user id={demo.id}')

        # ---- 全量清空 demo 数据（含软删宠物与历史测试遗留） ----
        old_pets = s.exec(select(Pet).where(Pet.user_id == demo.id)).all()
        old_ids = [p.id for p in old_pets]
        n_ev = n_rm = 0
        if old_ids:
            n_ev = s.exec(select(PetEvent).where(PetEvent.pet_id.in_(old_ids))).all()
            n_rm = s.exec(select(Reminder).where(Reminder.pet_id.in_(old_ids))).all()
            s.exec(delete(PetEvent).where(PetEvent.pet_id.in_(old_ids)))
            s.exec(delete(Reminder).where(Reminder.pet_id.in_(old_ids)))
            n_ev, n_rm = len(n_ev), len(n_rm)
        msgs = s.exec(select(ChatSession).where(ChatSession.user_id == demo.id)).all()
        for m in msgs:
            s.delete(m)
        for p in old_pets:
            s.delete(p)
        s.commit()
        print(f'[wipe] pets={len(old_ids)} events={n_ev} reminders={n_rm} messages={len(msgs)}')

        # ---- 宠物（固定 id，方便 tool_calls 审计里的 pet_id 一致） ----
        for p in bundle['pets']:
            taken = s.get(Pet, p['id'])
            if taken is not None:
                raise SystemExit(
                    f"pet id {p['id']} 已被占用（user_id={taken.user_id}），"
                    '不是 demo 用户的宠物，中止以免误伤。')
            birthday = (datetime.now() - timedelta(days=p['birthday_days_ago'])).date()
            avatar_dir = UPLOADS / 'pets' / str(p['id'])
            avatar_dir.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ASSETS / p['avatar_asset'], avatar_dir / 'avatar_seed.jpg')
            pet = Pet(id=p['id'], user_id=demo.id, name=p['name'], species=p['species'],
                      breed=p['breed'], gender=p['gender'], neutered=p['neutered'],
                      birthday=birthday, weight_kg=p['weight_kg'],
                      photo_url=f"/static/pets/{p['id']}/avatar_seed.jpg")
            s.add(pet)
            print(f"[pet] {p['name']} id={p['id']}")
        s.commit()

        # ---- 事件（weight 自动补 previous/delta；图片落到 /static/demo/） ----
        (UPLOADS / 'demo').mkdir(parents=True, exist_ok=True)
        prev_w: dict[int, float] = {}
        for ev in sorted(bundle['events'], key=lambda e: (e['pet_id'], e['day'], e['time'])):
            payload = dict(ev['payload'] or {})
            if ev['type'] == 'weight' and 'weight_kg' in payload:
                w = payload['weight_kg']
                if 'previous' not in payload and ev['pet_id'] in prev_w:
                    payload['previous'] = prev_w[ev['pet_id']]
                    payload['delta'] = round(w - prev_w[ev['pet_id']], 2)
                payload.setdefault('source', 'manual')
                prev_w[ev['pet_id']] = w
            image_url = None
            if ev.get('image_asset'):
                shutil.copyfile(ASSETS / ev['image_asset'], UPLOADS / 'demo' / ev['image_asset'])
                image_url = f"/static/demo/{ev['image_asset']}"
            when = anchor_dt(ev['day'], ev['time'])
            s.add(PetEvent(pet_id=ev['pet_id'], event_type=ev['type'],
                           payload_json=json.dumps(payload, ensure_ascii=False),
                           note=ev.get('note'), image_url=image_url,
                           happened_at=when, created_at=when))
        s.commit()
        print(f"[events] {len(bundle['events'])} 条")

        # ---- 提醒（已触发的补 dry-run 邮件预览） ----
        for rm in bundle['reminders']:
            local = anchor_dt(rm['day'], rm['time'])
            sched_utc = to_naive_utc(local)
            pet = s.get(Pet, rm['pet_id'])
            row = Reminder(pet_id=rm['pet_id'], reminder_type=rm['type'],
                           scheduled_at=sched_utc, message=rm['message'],
                           repeat_rule=rm.get('repeat_rule'),
                           notified=rm['notified'],
                           preview_subject=_build_preview_subject(pet.name, rm['type']))
            if rm['notified']:
                subject, body = build_reminder_email(
                    pet_name=pet.name, reminder_type=rm['type'], message=rm['message'],
                    scheduled_at_local=local.strftime('%Y-%m-%d %H:%M'))
                row.notification_channel = 'dry_run'
                row.notification_payload_json = json.dumps({
                    'channel': 'dry_run',
                    'sent_at_utc': sched_utc.isoformat(),
                    'subject': subject, 'body': body, 'to': '',
                    'reason': 'demo account dry-run',
                }, ensure_ascii=False)
            s.add(row)
        s.commit()
        print(f"[reminders] {len(bundle['reminders'])} 条")

        # ---- 会话（保持消息间距，整体平移到剧本日期；图片落到 /static/chat/） ----
        (UPLOADS / 'chat').mkdir(parents=True, exist_ok=True)
        n_msgs = 0
        for conv in bundle['conversations']:
            for url, asset in conv['image_map'].items():
                shutil.copyfile(ASSETS / asset, UPLOADS / 'chat' / Path(url).name)
            base = anchor_dt(conv['day'], conv['time'])
            first_ts = datetime.fromisoformat(conv['messages'][0]['created_at'])
            for m in conv['messages']:
                offset = datetime.fromisoformat(m['created_at']) - first_ts
                s.add(ChatSession(
                    session_id=conv['session_id'], pet_id=conv['pet_id'], user_id=demo.id,
                    role=m['role'], content=m['content'] or '',
                    tool_calls_json=json.dumps(m['tool_calls'], ensure_ascii=False) if m.get('tool_calls') else None,
                    image_url=m.get('image_url'), task=m.get('task'),
                    is_intermediate=bool(m.get('is_intermediate')),
                    vlm_output_json=json.dumps(m['vlm_output'], ensure_ascii=False) if m.get('vlm_output') else None,
                    created_at=base + offset))
                n_msgs += 1
        s.commit()
        print(f"[sessions] {len(bundle['conversations'])} 会话 / {n_msgs} 消息")

    print('\n✅ 黄金演示账号重置完成（最近活动 = 昨天，未来提醒已排期）')
    print('   提示：docker compose restart backend 让调度器重新注册未来提醒')


if __name__ == '__main__':
    main()
