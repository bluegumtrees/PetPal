"""SMTP 邮件 + dry-run 模式。

env：
  SMTP_HOST   smtp.gmail.com / smtp.qq.com 等
  SMTP_PORT   465 (SSL) 或 587 (STARTTLS)
  SMTP_USER   登录用户名（通常 = 发件邮箱）
  SMTP_PASS   邮箱密码或应用专用密码（不要用主密码）
  SMTP_FROM   发件邮箱（可选，缺省 = SMTP_USER）
  ALERT_TO    收件邮箱

任一关键 env 缺失 → dry-run 模式（log + 返回 channel='dry_run'，不真发）。
"""
from __future__ import annotations

import os
import smtplib
import ssl
import sys
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Optional

# Windows 控制台默认 GBK，无法输出 emoji（💉 等）。reconfigure stdout 为 UTF-8。
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # type: ignore[attr-defined]
except Exception:
    pass


_REMINDER_TYPE_LABEL = {
    'vaccine': '💉 疫苗',
    'deworm': '🪱 驱虫',
    'bath': '🛁 洗澡',
    'medication': '💊 服药',
    'checkup': '🩺 体检',
    'other': '📝 提醒',
}


def is_smtp_configured() -> bool:
    """SMTP 服务凭证齐全即视为已配置。
    V2 起 recipient 从 user.email 取（per-user），ALERT_TO 仅 V1 兼容 fallback，不再是必需。
    """
    return all(os.getenv(k) for k in ('SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'))


def build_reminder_email(
    pet_name: str,
    reminder_type: str,
    message: str,
    scheduled_at_local: str,
    delayed: bool = False,
) -> tuple[str, str]:
    """根据 reminder 字段构造 (subject, body)。"""
    type_label = _REMINDER_TYPE_LABEL.get(reminder_type, '📝 提醒')
    delayed_tag = '【补发】' if delayed else ''
    subject = f'{delayed_tag}[PetPal] {pet_name} · {type_label}提醒'
    body_lines = [
        f'你好，',
        '',
        f'{pet_name} 该 {type_label} 啦。',
        '',
        f'计划时间：{scheduled_at_local}',
    ]
    if message:
        body_lines += ['', f'备注：{message}']
    if delayed:
        body_lines += ['', '⚠️ 此邮件为补发（服务在原定时间附近未运行），如已处理请忽略。']
    body_lines += ['', '—— PetPal 🐾', '']
    return subject, '\n'.join(body_lines)


def send_reminder_email(subject: str, body: str, to: Optional[str] = None) -> dict:
    """发送一封提醒邮件。

    返回 {channel, sent_at_utc, subject, body, to, error?}：
    - channel='email'   真发成功
    - channel='dry_run' env 未配置 → 仅 log
    - channel='error'   真发失败（不抛出，不阻塞调度）
    """
    recipient = to or os.getenv('ALERT_TO') or ''
    now_utc_iso = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

    base = {
        'sent_at_utc': now_utc_iso,
        'subject': subject,
        'body': body,
        'to': recipient,
    }

    if not is_smtp_configured() or not recipient:
        reason = 'SMTP not configured' if not is_smtp_configured() else 'no recipient (user has no email / demo / fallback ALERT_TO unset)'
        print('=' * 60)
        print(f'[email/dry-run] to={recipient or "<unset>"} reason={reason}')
        print(f'subject: {subject}')
        print('body:')
        print(body)
        print('=' * 60)
        return {**base, 'channel': 'dry_run', 'dry_run_reason': reason}

    host = os.getenv('SMTP_HOST') or ''
    port = int(os.getenv('SMTP_PORT') or 465)
    user = os.getenv('SMTP_USER') or ''
    password = os.getenv('SMTP_PASS') or ''
    sender = os.getenv('SMTP_FROM') or user

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = recipient
    msg.set_content(body)

    try:
        ctx = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as smtp:
                smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as smtp:
                smtp.starttls(context=ctx)
                smtp.login(user, password)
                smtp.send_message(msg)
        return {**base, 'channel': 'email'}
    except Exception as e:
        print(f'[email] send failed: {e}')
        return {**base, 'channel': 'error', 'error': str(e)}
