import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import AddReminderModal from './AddReminderModal'
import { V4Btn, V4Card, V4Pill, Illo } from './v4'

const TYPE_META = {
  vaccine: { icon: 'syringe', label: '疫苗' },
  deworm: { icon: 'drop', label: '驱虫' },
  bath: { icon: 'bath', label: '洗澡' },
  medication: { icon: 'sparkle', label: '服药' },
  checkup: { icon: 'heart', label: '体检' },
  other: { icon: 'leaf', label: '提醒' },
}

const CHANNEL_BADGE = {
  email: { label: '✉️ 已邮件', tone: 'second' },
  dry_run: { label: '✉️ 已模拟（dry-run）', tone: 'mute' },
  stale: { label: '⌛ 过期跳过', tone: 'accent' },
  error: { label: '⚠️ 发送失败', tone: 'warn' },
}

const REPEAT_MS = {
  monthly: 30 * 24 * 3600 * 1000,
  yearly: 365 * 24 * 3600 * 1000,
}

/** naive UTC ISO ("2026-05-17T01:00:00") → 本地时间字符串 */
function fmtLocal(naiveUtcIso) {
  if (!naiveUtcIso) return ''
  const iso = naiveUtcIso.endsWith('Z') ? naiveUtcIso : naiveUtcIso + 'Z'
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function nextScheduledLocal(prevNaiveUtcIso, repeatRule) {
  const iso = prevNaiveUtcIso.endsWith('Z') ? prevNaiveUtcIso : prevNaiveUtcIso + 'Z'
  const prev = new Date(iso)
  let next
  if (repeatRule === 'monthly') {
    next = new Date(prev)
    next.setMonth(next.getMonth() + 1)
  } else if (repeatRule === 'yearly') {
    next = new Date(prev)
    next.setFullYear(next.getFullYear() + 1)
  } else if (repeatRule && repeatRule.startsWith('every:')) {
    const m = repeatRule.match(/every:(\d+)d/)
    const days = m ? parseInt(m[1], 10) : 30
    next = new Date(prev.getTime() + days * 24 * 3600 * 1000)
  } else {
    next = new Date(prev.getTime() + REPEAT_MS.monthly)
  }
  const tzOff = next.getTimezoneOffset() * 60000
  return new Date(next.getTime() - tzOff).toISOString().slice(0, 16)
}

/** @param {{ petId: number }} props */
export default function PetReminders({ petId }) {
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modalDefaults, setModalDefaults] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [triggeringId, setTriggeringId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await api(`/api/reminders?pet_id=${petId}`)
      setReminders(rows)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [petId])

  useEffect(() => {
    load()
  }, [load])

  async function handleDelete(id) {
    if (!window.confirm('删除这条提醒？')) return
    try {
      await api(`/api/reminders/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      window.alert(`删除失败：${e.message || e}`)
    }
  }

  async function handleTriggerNow(id) {
    setTriggeringId(id)
    try {
      const r = await api(`/api/reminders/${id}/trigger_now`, { method: 'POST' })
      await load()
      window.alert(`已触发！channel=${r.channel}（dry_run 表示未配 SMTP，邮件内容在服务器控制台）`)
    } catch (e) {
      window.alert(`触发失败：${e.message || e}\n\n（dev 触发需要服务器端 PETPAL_DEV_MODE=1）`)
    } finally {
      setTriggeringId(null)
    }
  }

  function handleAddAnother(r) {
    setModalDefaults({
      type: r.reminder_type,
      message: r.message,
      repeatRule: r.repeat_rule || '',
      scheduledAt: nextScheduledLocal(r.scheduled_at, r.repeat_rule),
    })
    setModalOpen(true)
  }

  function handleAddNew() {
    setModalDefaults(null)
    setModalOpen(true)
  }

  const pending = reminders.filter((r) => !r.notified)
  const triggered = reminders.filter((r) => r.notified)

  return (
    <V4Card padding="p-6" className="shadow-sm rounded-2xl">
      <div className="flex items-center justify-between mb-4">
        <h3
          className="text-xs uppercase tracking-wider font-medium inline-flex items-center gap-2"
          style={{ color: 'var(--v4-faint)' }}
        >
          <Illo name="bell" size={12} color="var(--v4-accent)" />
          计划提醒
        </h3>
        <V4Btn variant="soft" size="sm" icon="sparkle" onClick={handleAddNew}>
          添加提醒
        </V4Btn>
      </div>

      {loading && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--v4-faint)' }}>
          加载中…
        </p>
      )}
      {!loading && error && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--v4-warn)' }}>
          {error}
        </p>
      )}
      {!loading && !error && reminders.length === 0 && (
        <p className="text-sm text-center py-6" style={{ color: 'var(--v4-faint)' }}>
          还没有提醒。点上方「+ 添加提醒」加一条疫苗/驱虫/洗澡提醒。
        </p>
      )}

      {pending.length > 0 && (
        <div className="mb-4">
          <div
            className="text-[11px] uppercase mb-2"
            style={{ color: 'var(--v4-faint)' }}
          >
            待触发（{pending.length}）
          </div>
          <ul className="space-y-2">
            {pending.map((r) => {
              const meta = TYPE_META[r.reminder_type] || TYPE_META.other
              return (
                <li
                  key={r.id}
                  className="rounded-lg border px-3 py-2.5 flex items-center gap-3 transition"
                  style={{ background: 'var(--v4-card)', borderColor: 'var(--v4-line)' }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = 'var(--v4-accent)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor = 'var(--v4-line)')
                  }
                >
                  <span
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0"
                    style={{ background: 'var(--v4-accent-soft)' }}
                  >
                    <Illo name={meta.icon} size={18} color="var(--v4-accent)" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--v4-ink)' }}>
                        {meta.label}
                      </span>
                      {r.repeat_rule && (
                        <V4Pill tone="mute">🔁 {r.repeat_rule}</V4Pill>
                      )}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--v4-mute)' }}>
                      {fmtLocal(r.scheduled_at)}
                      {r.message && (
                        <span style={{ color: 'var(--v4-faint)' }}> · {r.message}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTriggerNow(r.id)}
                      disabled={triggeringId === r.id}
                      title="dev：立即触发（需要服务端 PETPAL_DEV_MODE=1）"
                      className="text-[11px] px-2 py-1 rounded transition disabled:opacity-50"
                      style={{
                        background: 'var(--v4-tint)',
                        color: 'var(--v4-mute)',
                      }}
                      onMouseEnter={(e) => {
                        if (triggeringId !== r.id)
                          e.currentTarget.style.background = 'var(--v4-accent-soft)'
                      }}
                      onMouseLeave={(e) => {
                        if (triggeringId !== r.id)
                          e.currentTarget.style.background = 'var(--v4-tint)'
                      }}
                    >
                      {triggeringId === r.id ? '触发中…' : (
                        <>
                          <span className="hidden sm:inline">🔧 立即触发</span>
                          <span className="sm:hidden">🔧</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      className="text-[11px] px-1.5 py-1 transition"
                      style={{ color: 'var(--v4-warn)' }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {triggered.length > 0 && (
        <div>
          <div
            className="text-[11px] uppercase mb-2"
            style={{ color: 'var(--v4-faint)' }}
          >
            已触发（{triggered.length}）
          </div>
          <ul className="space-y-2">
            {triggered.map((r) => {
              const meta = TYPE_META[r.reminder_type] || TYPE_META.other
              const badge = CHANNEL_BADGE[r.notification_channel] || {
                label: r.notification_channel || '已触发',
                tone: 'mute',
              }
              return (
                <li
                  key={r.id}
                  className="rounded-lg border px-3 py-2.5"
                  style={{
                    background: 'var(--v4-tint)',
                    borderColor: 'var(--v4-line)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0 opacity-70"
                      style={{ background: 'var(--v4-card)' }}
                    >
                      <Illo name={meta.icon} size={18} color="var(--v4-mute)" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm" style={{ color: 'var(--v4-mute)' }}>
                          {meta.label}
                        </span>
                        <V4Pill tone={badge.tone}>{badge.label}</V4Pill>
                        {r.delayed_reason && (
                          <V4Pill tone="warn">
                            {r.delayed_reason === 'startup_recovery'
                              ? '补发'
                              : r.delayed_reason}
                          </V4Pill>
                        )}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--v4-mute)' }}>
                        {fmtLocal(r.scheduled_at)}
                        {r.message && (
                          <span style={{ color: 'var(--v4-faint)' }}> · {r.message}</span>
                        )}
                      </div>
                      {r.notification_payload?.body && (
                        <details className="mt-1.5">
                          <summary
                            className="text-[11px] cursor-pointer"
                            style={{ color: 'var(--v4-faint)' }}
                          >
                            查看邮件内容
                          </summary>
                          <pre
                            className="text-[11px] rounded p-2 mt-1 whitespace-pre-wrap overflow-x-auto border"
                            style={{
                              background: 'var(--v4-card)',
                              borderColor: 'var(--v4-line)',
                              color: 'var(--v4-mute)',
                            }}
                          >
                            {r.notification_payload.subject}
                            {'\n\n'}
                            {r.notification_payload.body}
                          </pre>
                        </details>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {r.repeat_rule && (
                        <button
                          type="button"
                          onClick={() => handleAddAnother(r)}
                          title="预填下个周期，再加一条"
                          className="text-[11px] px-2 py-1 rounded transition"
                          style={{
                            background: 'var(--v4-accent-soft)',
                            color: 'var(--v4-accent-deep)',
                          }}
                        >
                          <span className="hidden sm:inline">🔁 再加一条</span>
                          <span className="sm:hidden">🔁</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="text-[11px] px-1.5 py-1 transition"
                        style={{ color: 'var(--v4-warn)' }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {modalOpen && (
        <AddReminderModal
          petId={petId}
          defaults={modalDefaults}
          onClose={() => setModalOpen(false)}
          onSubmitted={async () => {
            setModalOpen(false)
            await load()
          }}
        />
      )}
    </V4Card>
  )
}
