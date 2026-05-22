import { useEffect, useState } from 'react'
import { api } from '../api'
import { V4Btn, Illo } from './v4'

const TYPES = [
  { key: 'vaccine', label: '疫苗', icon: 'syringe' },
  { key: 'deworm', label: '驱虫', icon: 'drop' },
  { key: 'bath', label: '洗澡', icon: 'bath' },
  { key: 'medication', label: '服药', icon: 'sparkle' },
  { key: 'checkup', label: '体检', icon: 'heart' },
  { key: 'other', label: '其他', icon: 'leaf' },
]

const REPEAT_OPTIONS = [
  { value: '', label: '不重复' },
  { value: 'monthly', label: '每月' },
  { value: 'every:90d', label: '每 90 天' },
  { value: 'yearly', label: '每年' },
]

function defaultScheduledLocal() {
  const d = new Date()
  d.setHours(d.getHours() + 1)
  d.setMinutes(0, 0, 0)
  const tzOff = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzOff).toISOString().slice(0, 16)
}

/** @param {{ petId: number, defaults?: object | null, onClose: () => void, onSubmitted: () => void }} props */
export default function AddReminderModal({ petId, defaults, onClose, onSubmitted }) {
  const [type, setType] = useState(defaults?.type || 'vaccine')
  const [scheduledAt, setScheduledAt] = useState(defaults?.scheduledAt || defaultScheduledLocal())
  const [message, setMessage] = useState(defaults?.message || '')
  const [repeatRule, setRepeatRule] = useState(defaults?.repeatRule || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  async function handleSubmit() {
    setError('')
    if (!scheduledAt) {
      setError('请选择提醒时间')
      return
    }
    const utcIso = new Date(scheduledAt).toISOString()
    setSubmitting(true)
    try {
      await api('/api/reminders', {
        method: 'POST',
        body: {
          pet_id: petId,
          reminder_type: type,
          scheduled_at: utcIso,
          message: message.trim(),
          repeat_rule: repeatRule || null,
        },
      })
      onSubmitted()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    background: 'var(--v4-card)',
    borderColor: 'var(--v4-line)',
    color: 'var(--v4-ink)',
  }

  return (
    <div
      className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-md w-full p-6 shadow-2xl border"
        style={{ background: 'var(--v4-card)', borderColor: 'var(--v4-line)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold" style={{ color: 'var(--v4-ink)' }}>
            添加提醒
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none transition"
            style={{ color: 'var(--v4-faint)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v4-ink)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v4-faint)')}
            aria-label="close"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {TYPES.map((t) => {
            const active = type === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setType(t.key)
                  setError('')
                }}
                className="px-2 py-3 rounded-lg text-xs transition border-2 inline-flex flex-col items-center justify-center gap-1"
                style={{
                  background: active ? 'var(--v4-accent-soft)' : 'var(--v4-tint)',
                  color: active ? 'var(--v4-accent-deep)' : 'var(--v4-mute)',
                  borderColor: active ? 'var(--v4-accent)' : 'transparent',
                  fontWeight: active ? 600 : 500,
                }}
              >
                <Illo
                  name={t.icon}
                  size={18}
                  color={active ? 'var(--v4-accent-deep)' : 'var(--v4-mute)'}
                />
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--v4-mute)' }}>
              提醒时间
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--v4-faint)' }}>
              ⓘ 本地时间（Asia/Shanghai）。到点会发邮件提醒。
            </p>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--v4-mute)' }}>
              备注
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="例如：猫三联第二针 / 拜耳驱虫片"
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
              style={inputStyle}
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--v4-mute)' }}>
              重复（仅显示标签，MVP 不真重复）
            </label>
            <select
              value={repeatRule}
              onChange={(e) => setRepeatRule(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            >
              {REPEAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] mt-1" style={{ color: 'var(--v4-faint)' }}>
              ⓘ 提醒发出后会显示"再加一条"按钮，一键预填下个周期。
            </p>
          </div>
        </div>

        {error && (
          <div
            className="mt-3 rounded-md px-3 py-2 text-xs border"
            style={{
              background: 'var(--v4-warn-soft)',
              borderColor: 'var(--v4-warn)',
              color: 'var(--v4-warn)',
            }}
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2 justify-end">
          <V4Btn variant="ghost" size="md" onClick={onClose} disabled={submitting}>
            取消
          </V4Btn>
          <V4Btn
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={submitting}
            icon="bell"
          >
            {submitting ? '保存中…' : '保存'}
          </V4Btn>
        </div>
      </div>
    </div>
  )
}
