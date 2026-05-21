"""APScheduler 集成：reminders 表是 source of truth，scheduler 只用内存 jobstore。

设计要点（旧 Claude 警告了这两个坑）：
1. **不用** APScheduler 的 SQLAlchemyJobStore——会和 reminders 表造成双 source of truth
2. timezone 一律 UTC：scheduled_at 存 naive UTC；scheduler 配 timezone='UTC'；前端转本地时区显示

启动恢复策略：
- 未来 reminder → 正常排进 scheduler
- 过期 <1h 的 reminder → schedule 5 秒后立即触发，delayed_reason='startup_recovery'
- 过期 >1h 的 reminder → 标 stale，notification_channel='stale'，不发邮件
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from sqlmodel import Session, select

from app.db.database import _engine
from app.db.models import Pet, Reminder, User
from app.services.email import build_reminder_email, send_reminder_email

log = logging.getLogger(__name__)

STARTUP_RECOVERY_WINDOW_HOURS = 1
LOCAL_TZ = ZoneInfo('Asia/Shanghai')  # MVP 假定中国本地时区

_scheduler: Optional[AsyncIOScheduler] = None


# === 工具 ===

def _job_id(reminder_id: int) -> str:
    return f'reminder:{reminder_id}'


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _format_local(naive_utc: datetime) -> str:
    """naive UTC → '2026-05-20 09:00' 本地时间显示。"""
    aware_utc = naive_utc.replace(tzinfo=timezone.utc)
    local = aware_utc.astimezone(LOCAL_TZ)
    return local.strftime('%Y-%m-%d %H:%M')


# === 核心触发逻辑 ===

async def trigger_reminder(reminder_id: int, delayed_reason: Optional[str] = None) -> None:
    """触发一条 reminder：拉 db → 发邮件 → 更新 db。"""
    with Session(_engine) as session:
        r = session.get(Reminder, reminder_id)
        if not r:
            log.warning('[scheduler] reminder %s not found, skip', reminder_id)
            return
        if r.notified:
            log.info('[scheduler] reminder %s already notified, skip', reminder_id)
            return

        pet = session.get(Pet, r.pet_id)
        pet_name = pet.name if pet else '宠物'

        # V2: 收件人 = pet.user.email（per-user 通知）。
        # 跳过 demo 账号（demo@petpal.local 不是真邮箱）和无 email 的用户 → 走 dry_run
        recipient_email: Optional[str] = None
        if pet and pet.user_id:
            user = session.get(User, pet.user_id)
            if user and user.email and not user.is_demo:
                recipient_email = user.email

        scheduled_local_str = _format_local(r.scheduled_at)
        subject, body = build_reminder_email(
            pet_name=pet_name,
            reminder_type=r.reminder_type,
            message=r.message or '',
            scheduled_at_local=scheduled_local_str,
            delayed=bool(delayed_reason),
        )
        result = send_reminder_email(subject, body, to=recipient_email)

        r.notified = True
        r.notification_channel = result['channel']
        r.notification_payload_json = json.dumps(result, ensure_ascii=False)
        if delayed_reason:
            r.delayed_reason = delayed_reason
        session.add(r)
        session.commit()
        log.info('[scheduler] triggered reminder %s channel=%s', reminder_id, result['channel'])


# === 公共 API ===

def add_reminder_job(
    reminder_id: int,
    scheduled_at_utc_naive: datetime,
    delayed_reason: Optional[str] = None,
) -> None:
    """向 scheduler 添加一次性触发 job。replace_existing=True 幂等。"""
    if _scheduler is None:
        log.warning('[scheduler] not started, cannot add job for reminder %s', reminder_id)
        return
    aware_utc = scheduled_at_utc_naive.replace(tzinfo=timezone.utc)
    _scheduler.add_job(
        trigger_reminder,
        trigger=DateTrigger(run_date=aware_utc),
        args=[reminder_id, delayed_reason],
        id=_job_id(reminder_id),
        replace_existing=True,
    )


def remove_reminder_job(reminder_id: int) -> None:
    """取消已排程 job（用户删 reminder 时调）。job 已触发或不存在时静默忽略。"""
    if _scheduler is None:
        return
    try:
        _scheduler.remove_job(_job_id(reminder_id))
    except Exception:
        pass


async def trigger_now(reminder_id: int) -> dict:
    """dev：立即触发一条 reminder（绕过 scheduled_at），用于演示。"""
    remove_reminder_job(reminder_id)  # 避免后续自动重复触发
    await trigger_reminder(reminder_id, delayed_reason=None)
    with Session(_engine) as session:
        r = session.get(Reminder, reminder_id)
        return {
            'ok': r is not None,
            'reminder_id': reminder_id,
            'channel': r.notification_channel if r else None,
            'notified': bool(r.notified) if r else False,
        }


# === 启动恢复 ===

def _restore_pending_jobs() -> dict:
    """启动时扫描 notified=False 的 reminders，按时间分流。"""
    now = _utc_now_naive()
    recovery_cutoff = now - timedelta(hours=STARTUP_RECOVERY_WINDOW_HOURS)

    counts = {'restored': 0, 'recovered': 0, 'staled': 0}

    with Session(_engine) as session:
        stmt = select(Reminder).where(Reminder.notified == False)  # noqa: E712
        rows = list(session.exec(stmt).all())
        for r in rows:
            if r.scheduled_at < recovery_cutoff:
                # 过期 >1h → 标 stale
                r.notified = True
                r.notification_channel = 'stale'
                r.delayed_reason = 'expired_skipped'
                r.notification_payload_json = json.dumps({
                    'channel': 'stale',
                    'reason': f'expired >{STARTUP_RECOVERY_WINDOW_HOURS}h before service restart',
                    'sent_at_utc': now.isoformat(),
                }, ensure_ascii=False)
                session.add(r)
                counts['staled'] += 1
            elif r.scheduled_at < now:
                # 过期 <1h → schedule 5 秒后立即触发（走 trigger_reminder 标准路径）
                add_reminder_job(
                    r.id,
                    scheduled_at_utc_naive=now + timedelta(seconds=5),
                    delayed_reason='startup_recovery',
                )
                counts['recovered'] += 1
            else:
                # 未来 → 正常排程
                add_reminder_job(r.id, r.scheduled_at)
                counts['restored'] += 1
        session.commit()

    log.info('[scheduler] startup restore: %s', counts)
    return counts


# === lifespan 钩子 ===

async def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone='UTC')
    _scheduler.start()
    _restore_pending_jobs()
    n = len(_scheduler.get_jobs())
    log.info('[scheduler] started, active jobs: %d', n)
    print(f'[scheduler] started, active jobs: {n}')


async def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    log.info('[scheduler] shutdown')
