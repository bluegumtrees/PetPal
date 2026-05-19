import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import AddReminderModal from './AddReminderModal'

const TYPE_META = {
  vaccine: { icon: '💉', label: '疫苗' },
  deworm: { icon: '🪱', label: '驱虫' },
  bath: { icon: '🛁', label: '洗澡' },
  medication: { icon: '💊', label: '服药' },
  checkup: { icon: '🩺', label: '体检' },
  other: { icon: '📝', label: '提醒' },
}

const CHANNEL_BADGE = {
  email: { label: '✉️ 已邮件', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  dry_run: { label: '✉️ 已模拟（dry-run）', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  stale: { label: '⌛ 过期跳过', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  error: { label: '⚠️ 发送失败', cls: 'bg-red-50 text-red-700 border-red-200' },
}

const REPEAT_MS = {
  monthly: 30 * 24 * 3600 * 1000,
  yearly: 365 * 24 * 3600 * 1000,
}

/** naive UTC ISO ("2026-05-17T01:00:00") → 本地时间字符串 */
function fmtLocal(naiveUtcIso) {
  if (!naiveUtcIso) return ''
  // 后端返回的是 naive UTC（无 Z 后缀），JS 默认按本地解析就错了，强制加 Z
  const iso = naiveUtcIso.endsWith('Z') ? naiveUtcIso : naiveUtcIso + 'Z'
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/** 计算"再加一条"的下一次时间（本地 datetime-local 格式） */
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
    next = new Date(prev.getTime() + (REPEAT_MS.monthly))
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
    <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs uppercase tracking-wider text-slate-400 font-medium">计划提醒</h3>
        <button
          type="button"
          onClick={handleAddNew}
          className="text-xs px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition"
        >
          + 添加提醒
        </button>
      </div>

      {loading && <p className="text-sm text-slate-400 text-center py-4">加载中…</p>}
      {!loading && error && <p className="text-sm text-red-500 text-center py-4">{error}</p>}
      {!loading && !error && reminders.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-6">
          还没有提醒。点上方「+ 添加提醒」加一条疫苗/驱虫/洗澡提醒。
        </p>
      )}

      {pending.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] uppercase text-slate-400 mb-2">待触发（{pending.length}）</div>
          <ul className="space-y-2">
            {pending.map((r) => {
              const meta = TYPE_META[r.reminder_type] || TYPE_META.other
              return (
                <li
                  key={r.id}
                  className="rounded-lg border border-slate-200 px-3 py-2.5 flex items-center gap-3 hover:border-amber-200 transition"
                >
                  <span className="text-xl">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-slate-800">{meta.label}</span>
                      {r.repeat_rule && (
                        <span className="text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">
                          🔁 {r.repeat_rule}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {fmtLocal(r.scheduled_at)}
                      {r.message && <span className="text-slate-400"> · {r.message}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTriggerNow(r.id)}
                      disabled={triggeringId === r.id}
                      title="dev：立即触发（需要服务端 PETPAL_DEV_MODE=1）"
                      className="text-[11px] px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition disabled:opacity-50"
                    >
                      {triggeringId === r.id ? '触发中…' : '🔧 立即触发'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      className="text-[11px] text-red-500 hover:text-red-700 px-1.5 py-1"
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
          <div className="text-[11px] uppercase text-slate-400 mb-2">已触发（{triggered.length}）</div>
          <ul className="space-y-2">
            {triggered.map((r) => {
              const meta = TYPE_META[r.reminder_type] || TYPE_META.other
              const badge = CHANNEL_BADGE[r.notification_channel] || {
                label: r.notification_channel || '已触发',
                cls: 'bg-slate-100 text-slate-600 border-slate-200',
              }
              return (
                <li
                  key={r.id}
                  className="rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl opacity-60">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm text-slate-700">{meta.label}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        {r.delayed_reason && (
                          <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            {r.delayed_reason === 'startup_recovery' ? '补发' : r.delayed_reason}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {fmtLocal(r.scheduled_at)}
                        {r.message && <span className="text-slate-400"> · {r.message}</span>}
                      </div>
                      {r.notification_payload?.body && (
                        <details className="mt-1.5">
                          <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">
                            查看邮件内容
                          </summary>
                          <pre className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded p-2 mt-1 whitespace-pre-wrap overflow-x-auto">
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
                          className="text-[11px] px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition"
                        >
                          🔁 再加一条
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="text-[11px] text-red-500 hover:text-red-700 px-1.5 py-1"
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
    </section>
  )
}
