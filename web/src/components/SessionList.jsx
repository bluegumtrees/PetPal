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
    e.stopPropagation()  // 不触发外层 button 切换
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

  // 点击外部关闭
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
      className="absolute top-full right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-40 w-80 max-h-96 overflow-y-auto"
    >
      <div className="sticky top-0 bg-white border-b border-slate-100 px-3 py-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">历史会话</span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 text-base leading-none"
          aria-label="close"
        >
          ✕
        </button>
      </div>

      {loading && <p className="text-sm text-slate-400 text-center py-6">加载中…</p>}
      {!loading && error && <p className="text-sm text-red-500 text-center py-4">{error}</p>}
      {!loading && !error && sessions.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-8">还没有历史对话</p>
      )}

      {!loading && sessions.length > 0 && (
        <ul>
          {sessions.map((s) => {
            const isCurrent = s.session_id === currentSessionId
            const isDeleting = deletingId === s.session_id
            return (
              <li
                key={s.session_id}
                className={`group relative border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition ${
                  isCurrent ? 'bg-amber-50' : ''
                }`}
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
                    <p className="text-sm text-slate-700 line-clamp-1 flex-1">
                      {s.last_user_text || <span className="text-slate-400 italic">空对话</span>}
                    </p>
                    <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">
                      {fmtRelative(s.last_at)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                    {s.message_count} 条 · {s.session_id.slice(0, 8)}
                    {isCurrent && <span className="ml-1 text-amber-600">· 当前</span>}
                  </p>
                </button>
                {/* 删除按钮：右下角 hover 才显示，避免误触 */}
                <button
                  type="button"
                  onClick={(e) => handleDelete(s.session_id, e)}
                  disabled={isDeleting}
                  className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition text-[11px] text-red-500 hover:text-red-700 hover:bg-red-50 rounded px-1.5 py-0.5 disabled:opacity-50"
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
