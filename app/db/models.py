"""5 表 SQLModel：users / pets / pet_events / reminders / chat_sessions。"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now()


class User(SQLModel, table=True):
    """V2 用户表（邮箱 + bcrypt 密码 hash）。"""
    __tablename__ = 'users'

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(..., max_length=120, index=True, unique=True)
    password_hash: str = Field(..., max_length=200)  # bcrypt
    name: str = Field(..., max_length=50)  # 显示名
    is_demo: bool = Field(default=False, index=True)  # demo 账号特殊标记
    created_at: datetime = Field(default_factory=_now)


class Pet(SQLModel, table=True):
    """宠物档案（软删：deleted_at != null 视为已删除）。"""
    __tablename__ = 'pets'

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key='users.id', index=True)
    # V2 加；Optional 是为了允许迁移期间历史数据先 NULL，后由迁移脚本回填

    # 必填
    name: str = Field(..., max_length=50, index=True)
    species: str = Field(..., max_length=10)  # 'cat' | 'dog'

    # 可选
    breed: Optional[str] = Field(default=None, max_length=50)
    birthday: Optional[date] = Field(default=None)
    gender: Optional[str] = Field(default=None, max_length=10)  # 'male' / 'female' / 'unknown'
    neutered: Optional[bool] = Field(default=None)
    weight_kg: Optional[float] = Field(default=None)
    photo_url: Optional[str] = Field(default=None, max_length=255)

    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    deleted_at: Optional[datetime] = Field(default=None, index=True)


class PetEvent(SQLModel, table=True):
    """时间序列：已发生的事件（BCS 评分 / 症状 / 拍照记录...）。"""
    __tablename__ = 'pet_events'

    id: Optional[int] = Field(default=None, primary_key=True)
    pet_id: int = Field(..., foreign_key='pets.id', index=True)

    event_type: str = Field(..., max_length=30, index=True)
    # 'bcs' / 'symptom' / 'vaccine' / 'grooming' / 'photo' / 'feeding' / 'weight' / 'emotion' / 'pain_fgs' ...

    payload_json: str = Field(default='{}')  # 结构化数据
    image_url: Optional[str] = Field(default=None, max_length=255)
    note: Optional[str] = Field(default=None, max_length=500)

    happened_at: datetime = Field(default_factory=_now, index=True)
    created_at: datetime = Field(default_factory=_now)


class Reminder(SQLModel, table=True):
    """计划提醒：未发生的事件（疫苗 / 驱虫 / 洗澡 / 服药 / 体检 / 其他）。

    时区约定：scheduled_at 存 naive UTC（SQLite 无 native TZ 支持，应用层规约）。
    前端 datetime-local input 提交时本地 → UTC ISO，显示时 UTC → toLocaleString 转本地。
    """
    __tablename__ = 'reminders'

    id: Optional[int] = Field(default=None, primary_key=True)
    pet_id: int = Field(..., foreign_key='pets.id', index=True)

    reminder_type: str = Field(..., max_length=30)
    # 'vaccine' / 'deworm' / 'bath' / 'medication' / 'checkup' / 'other'
    scheduled_at: datetime = Field(..., index=True)  # naive UTC
    repeat_rule: Optional[str] = Field(default=None, max_length=50)  # 'monthly' / 'yearly' / 'every:90d' (MVP 只显示)
    message: str = Field(..., max_length=500)
    notified: bool = Field(default=False, index=True)
    notification_channel: Optional[str] = Field(default=None, max_length=20)
    # 'email' / 'dry_run' / 'stale' (过期 >1h 启动恢复时不补发)

    # P6.2 新加
    delayed_reason: Optional[str] = Field(default=None, max_length=50)  # 'startup_recovery' 等
    notification_payload_json: Optional[str] = Field(default=None)       # 触发时完整 {subject, body, channel}
    preview_subject: Optional[str] = Field(default=None, max_length=200) # 创建时预览的 subject

    created_at: datetime = Field(default_factory=_now)


class PetHealthSummary(SQLModel, table=True):
    """记忆 V2：滚动健康画像（docs/memory_v2_design.md）。

    summary_text 由 LLM 增量归纳；facts_json 由确定性代码计算（可随时重算）。
    events_covered 是水位线：生成时覆盖到的最大 event_id。
    """
    __tablename__ = 'pet_health_summaries'

    id: Optional[int] = Field(default=None, primary_key=True)
    pet_id: int = Field(..., foreign_key='pets.id', index=True, unique=True)
    summary_text: Optional[str] = Field(default=None)
    facts_json: str = Field(default='{}')
    events_covered: int = Field(default=0)
    generated_at: datetime = Field(default_factory=_now)
    model: Optional[str] = Field(default=None, max_length=100)


class ChatSession(SQLModel, table=True):
    """对话历史 + tool_calls 审计。
    表名是历史包袱（早期叫 session），每行实际是一条 message。
    session_id 用于把多条 message 分组成一次"对话"。
    """
    __tablename__ = 'chat_sessions'

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str = Field(..., max_length=36, index=True)  # 客户端生成的 UUID
    pet_id: Optional[int] = Field(default=None, foreign_key='pets.id', index=True)
    user_id: Optional[int] = Field(default=None, foreign_key='users.id', index=True)
    # V2 冗余字段（pet.user_id 也能 join 到）加速 query + 支持迁移期 null

    role: str = Field(..., max_length=20)  # 'user' / 'assistant' / 'tool'
    content: str
    tool_calls_json: Optional[str] = Field(default=None)  # 完整 tool 调用审计：[{tool, args, result_summary, result}]

    # 可选元信息（user msg 可能附图，assistant 可能附 vlm output 等）
    image_url: Optional[str] = Field(default=None, max_length=255)
    task: Optional[str] = Field(default=None, max_length=20)  # 路由后的 task

    # P5 v5：精确还原刷新后体验
    is_intermediate: bool = Field(default=False)  # True 表示中间 thinking, False 表示 user / final assistant
    vlm_output_json: Optional[str] = Field(default=None)  # user msg 附带的 VLM 输出（JSON 字符串），便于历史还原徽章

    created_at: datetime = Field(default_factory=_now, index=True)
