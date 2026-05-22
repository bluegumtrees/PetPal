import { useEffect, useState } from 'react'
import { api } from '../api'

function fmtRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

/**
 * 历史会话列表（下拉弹层）。
 * @param {{ petId: number, currentSessionId: string|null, onSelect: (sid: string) => void, onClose: () => void, onCurrentDeleted?: () => void }} props
 */
export default function SessionList({ petId, currentSessionId, onSelect, onClose, onCurrentDeleted }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  async function handleDelete(sid, e) {
    e.stopPropagation()
    if (!window.confirm('删除这条对话？无法撤销。')) return
    setDeletingId(sid)
    try {
      await api(`/api/sessions/${sid}`, { method: 'DELETE' })
      setSessions((arr) => arr.filter((s) => s.session_id !== sid))
      if (sid === currentSessionId && onCurrentDeleted) {
        onCurrentDeleted()
      }
    } catch (err) {
      window.alert(`删除失败：${err.message || err}`)
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    if (!petId) return
    setLoading(true)
    api(`/api/sessions?pet_id=${petId}&limit=30`)
      .then((rows) => setSessions(rows || []))
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false))
  }, [petId])

  useEffect(() => {
    function onClick(e) {
      if (e.target.closest('[data-session-list]')) return
      if (e.target.closest('[data-session-list-trigger]')) return
      onClose()
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  return (
    <div
      data-session-list
      className="absolute top-full right-0 mt-2 rounded-xl shadow-xl z-40 w-80 max-h-96 overflow-y-auto border"
      style={{ background: 'var(--v4-card)', borderColor: 'var(--v4-line)' }}
    >
      <div
        className="sticky top-0 px-3 py-2 flex items-center justify-between border-b"
        style={{ background: 'var(--v4-card)', borderColor: 'var(--v4-line)' }}
      >
        <span
          className="text-xs uppercase tracking-wider font-medium"
          style={{ color: 'var(--v4-faint)' }}
        >
          历史会话
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-base leading-none transition"
          style={{ color: 'var(--v4-faint)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v4-ink)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v4-faint)')}
          aria-label="close"
        >
          ✕
        </button>
      </div>

      {loading && (
        <p className="text-sm text-center py-6" style={{ color: 'var(--v4-faint)' }}>
          加载中…
        </p>
      )}
      {!loading && error && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--v4-warn)' }}>
          {error}
        </p>
      )}
      {!loading && !error && sessions.length === 0 && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--v4-faint)' }}>
          还没有历史对话
        </p>
      )}

      {!loading && sessions.length > 0 && (
        <ul>
          {sessions.map((s) => {
            const isCurrent = s.session_id === currentSessionId
            const isDeleting = deletingId === s.session_id
            return (
              <li
                key={s.session_id}
                className="group relative border-b last:border-b-0 transition"
                style={{
                  borderColor: 'var(--v4-line)',
                  background: isCurrent ? 'var(--v4-accent-soft)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) e.currentTarget.style.background = 'var(--v4-tint)'
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) e.currentTarget.style.background = 'transparent'
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelect(s.session_id)
                    onClose()
                  }}
                  disabled={isDeleting}
                  className="w-full text-left px-3 py-2.5 pr-9 disabled:opacity-40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className="text-sm line-clamp-1 flex-1"
                      style={{ color: 'var(--v4-ink)' }}
                    >
                      {s.last_user_text || (
                        <span className="italic" style={{ color: 'var(--v4-faint)' }}>
                          空对话
                        </span>
                      )}
                    </p>
                    <span
                      className="text-[10px] shrink-0 whitespace-nowrap"
                      style={{ color: 'var(--v4-faint)' }}
                    >
                      {fmtRelative(s.last_at)}
                    </span>
                  </div>
                  <p
                    className="text-[11px] mt-0.5 font-mono"
                    style={{ color: 'var(--v4-faint)' }}
                  >
                    {s.message_count} 条 · {s.session_id.slice(0, 8)}
                    {isCurrent && (
                      <span className="ml-1" style={{ color: 'var(--v4-accent-deep)' }}>
                        · 当前
                      </span>
                    )}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDelete(s.session_id, e)}
                  disabled={isDeleting}
                  className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition text-[11px] rounded px-1.5 py-0.5 disabled:opacity-50"
                  style={{ color: 'var(--v4-warn)' }}
                  title="删除这条对话"
                >
                  {isDeleting ? '…' : '🗑'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
