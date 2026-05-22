import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { usePets } from '../context/PetContext'
import Avatar from './Avatar'
import { Illo } from './v4'

const NAV_ITEMS = [
  { to: '/', label: '对话', icon: 'cloud', end: true },
  { to: '/dashboard', label: '仪表盘', icon: 'star' },
  { to: '/pets', label: '宠物', icon: 'paw' },
  { to: '/dev/vet-search', label: '检索调试', icon: 'sparkle' },
]

function fmtRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}:${String(d.getMinutes()).padStart(2, '0')}`
  const days = Math.floor(hours / 24)
  if (days < 7) {
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    return `周${weekday}`
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

/** 把 sessions 按时间分组：今天 / 本周 / 更早 */
function groupSessions(sessions) {
  const today = []
  const week = []
  const older = []
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  for (const s of sessions) {
    if (!s.last_at) {
      older.push(s)
      continue
    }
    const ageDays = (now - new Date(s.last_at).getTime()) / dayMs
    if (ageDays < 1) today.push(s)
    else if (ageDays < 7) week.push(s)
    else older.push(s)
  }
  return { today, week, older }
}

/**
 * 完整侧边栏：宠物切换 + 主导航 + 当前宠物历史会话 + 底部用户卡。
 * 同时用于桌面（可选）和移动端抽屉。
 *
 * @param {{
 *   currentSessionId?: string|null,
 *   onSelectSession?: (sid: string) => void,
 *   onCurrentSessionDeleted?: () => void,
 *   onNavigate?: () => void,  // 点击任意链接后回调（用于抽屉自动关闭）
 *   onNewSession?: () => void,
 *   onClose?: () => void,     // 顶部关闭按钮（仅抽屉模式显示）
 *   showCloseBtn?: boolean,
 * }} props
 */
export default function Sidebar({
  currentSessionId = null,
  onSelectSession,
  onCurrentSessionDeleted,
  onNavigate,
  onNewSession,
  onClose,
  showCloseBtn = false,
}) {
  const { activePet, pets, setActivePetId } = usePets()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [sessions, setSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [petPickerOpen, setPetPickerOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  // 加载当前宠物的 sessions
  useEffect(() => {
    if (!activePet) {
      setSessions([])
      return
    }
    setLoadingSessions(true)
    api(`/api/sessions?pet_id=${activePet.id}&limit=50`)
      .then((rows) => setSessions(rows || []))
      .catch(() => setSessions([]))
      .finally(() => setLoadingSessions(false))
  }, [activePet?.id, currentSessionId])

  async function handleDeleteSession(sid, e) {
    e.stopPropagation()
    if (!window.confirm('删除这条对话？无法撤销。')) return
    setDeletingId(sid)
    try {
      await api(`/api/sessions/${sid}`, { method: 'DELETE' })
      setSessions((arr) => arr.filter((s) => s.session_id !== sid))
      if (sid === currentSessionId && onCurrentSessionDeleted) {
        onCurrentSessionDeleted()
      }
    } catch (err) {
      window.alert(`删除失败：${err.message || err}`)
    } finally {
      setDeletingId(null)
    }
  }

  function handleNewSession() {
    onNewSession?.()
    onNavigate?.()
  }

  function handleSwitchPet(pid) {
    setActivePetId(pid)
    setPetPickerOpen(false)
    // 不自动关 sidebar，让用户看到新宠物的 sessions
  }

  const { today, week, older } = groupSessions(sessions)

  return (
    <>
      {/* === 顶部 logo + 关闭按钮 === */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--v4-line)' }}
      >
        <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--v4-accent)' }}
          >
            <Illo name="cat-face" size={26} color="white" secondary="white" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight" style={{ color: 'var(--v4-ink)' }}>
              PetPal
            </h1>
            <p className="text-[10px] leading-tight" style={{ color: 'var(--v4-faint)' }}>
              你的宠物小助手
            </p>
          </div>
        </Link>
        {showCloseBtn && (
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none p-1"
            style={{ color: 'var(--v4-faint)' }}
            aria-label="关闭"
          >
            ✕
          </button>
        )}
      </div>

      {/* 可滚动主区域 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* === 当前宠物大卡 + 切换 === */}
        {activePet && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPetPickerOpen((v) => !v)}
              className="w-full flex items-center gap-3 rounded-xl border p-3 transition"
              style={{
                background: 'var(--v4-tint)',
                borderColor: 'var(--v4-line)',
              }}
            >
              <Avatar pet={activePet} size={44} />
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-semibold truncate" style={{ color: 'var(--v4-ink)' }}>
                  {activePet.name}
                </div>
                <div className="text-[11px] truncate" style={{ color: 'var(--v4-mute)' }}>
                  {activePet.species === 'cat' ? '猫' : '狗'}
                  {activePet.breed && <> · {activePet.breed}</>}
                </div>
              </div>
              <span
                className="text-xs font-medium px-2 py-1 rounded-md shrink-0"
                style={{ background: 'var(--v4-accent-soft)', color: 'var(--v4-accent-deep)' }}
              >
                切换
              </span>
            </button>

            {petPickerOpen && (
              <div
                className="absolute left-0 right-0 top-full mt-1 rounded-xl border z-10 max-h-72 overflow-y-auto"
                style={{
                  background: 'var(--v4-card)',
                  borderColor: 'var(--v4-line)',
                  boxShadow: 'var(--v4-shadow)',
                }}
              >
                {pets.map((p) => {
                  const active = p.id === activePet.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSwitchPet(p.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition"
                      style={{
                        background: active ? 'var(--v4-accent-soft)' : 'transparent',
                        color: active ? 'var(--v4-accent-deep)' : 'var(--v4-ink)',
                      }}
                    >
                      <Avatar pet={p} size={24} />
                      <span className="flex-1 truncate">{p.name}</span>
                      {active && <span className="text-xs">✓</span>}
                    </button>
                  )
                })}
                <Link
                  to="/pets/new"
                  onClick={() => {
                    setPetPickerOpen(false)
                    onNavigate?.()
                  }}
                  className="block px-3 py-2 text-sm border-t transition"
                  style={{
                    color: 'var(--v4-accent-deep)',
                    borderColor: 'var(--v4-line)',
                  }}
                >
                  + 新建宠物
                </Link>
              </div>
            )}
          </div>
        )}

        {/* === 主导航 === */}
        <nav className="space-y-0.5">
          {NAV_ITEMS.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              onClick={onNavigate}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition"
              style={({ isActive }) => ({
                background: isActive ? 'var(--v4-accent-soft)' : 'transparent',
                color: isActive ? 'var(--v4-accent-deep)' : 'var(--v4-ink)',
                fontWeight: isActive ? 600 : 500,
              })}
            >
              {({ isActive }) => (
                <>
                  <Illo
                    name={it.icon}
                    size={14}
                    color={isActive ? 'var(--v4-accent-deep)' : 'var(--v4-mute)'}
                  />
                  <span>{it.label}</span>
                  {it.to === '/pets' && pets.length > 0 && (
                    <span
                      className="ml-auto text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        background: 'var(--v4-tint)',
                        color: 'var(--v4-mute)',
                      }}
                    >
                      {pets.length}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* === 新对话按钮（仅当前页是 chat 时显示更醒目） === */}
        {onNewSession && (
          <button
            type="button"
            onClick={handleNewSession}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition"
            style={{
              background: 'var(--v4-accent)',
              color: 'white',
              boxShadow: 'var(--v4-shadow-sm)',
            }}
          >
            <Illo name="sparkle" size={14} color="white" />
            新对话
          </button>
        )}

        {/* === 当前宠物历史会话 === */}
        {activePet && (
          <div className="pt-2">
            {loadingSessions && (
              <p className="text-xs text-center py-3" style={{ color: 'var(--v4-faint)' }}>
                加载中…
              </p>
            )}
            {!loadingSessions && sessions.length === 0 && (
              <p className="text-xs text-center py-3" style={{ color: 'var(--v4-faint)' }}>
                {activePet.name} 还没有历史对话
              </p>
            )}

            {today.length > 0 && (
              <SessionGroup
                label={`今天 · ${today.length} 条`}
                sessions={today}
                currentSessionId={currentSessionId}
                deletingId={deletingId}
                onSelect={(sid) => {
                  onSelectSession?.(sid)
                  onNavigate?.()
                }}
                onDelete={handleDeleteSession}
              />
            )}
            {week.length > 0 && (
              <SessionGroup
                label="本周"
                sessions={week}
                currentSessionId={currentSessionId}
                deletingId={deletingId}
                onSelect={(sid) => {
                  onSelectSession?.(sid)
                  onNavigate?.()
                }}
                onDelete={handleDeleteSession}
              />
            )}
            {older.length > 0 && (
              <SessionGroup
                label="更早"
                sessions={older}
                currentSessionId={currentSessionId}
                deletingId={deletingId}
                onSelect={(sid) => {
                  onSelectSession?.(sid)
                  onNavigate?.()
                }}
                onDelete={handleDeleteSession}
              />
            )}
          </div>
        )}
      </div>

      {/* === 底部用户卡 === */}
      {user && (
        <div
          className="border-t p-3 shrink-0 relative"
          style={{ borderColor: 'var(--v4-line)' }}
        >
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-tint)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span
              className="w-8 h-8 rounded-full text-white text-xs font-medium flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--v4-accent), var(--v4-accent-deep))',
              }}
            >
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </span>
            <div className="flex-1 text-left min-w-0">
              <div
                className="text-sm font-medium truncate"
                style={{ color: 'var(--v4-ink)' }}
              >
                {user.name}
                {user.is_demo && (
                  <span className="ml-1 text-[10px]" style={{ color: 'var(--v4-accent)' }}>
                    🎈
                  </span>
                )}
              </div>
              <div className="text-[10px] truncate" style={{ color: 'var(--v4-faint)' }}>
                {user.email}
              </div>
            </div>
            <span className="text-base shrink-0" style={{ color: 'var(--v4-faint)' }}>
              ⋯
            </span>
          </button>

          {userMenuOpen && (
            <div
              className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border overflow-hidden"
              style={{
                background: 'var(--v4-card)',
                borderColor: 'var(--v4-line)',
                boxShadow: 'var(--v4-shadow)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false)
                  logout()
                  navigate('/login')
                }}
                className="w-full text-left px-3 py-2 text-sm transition"
                style={{ color: 'var(--v4-ink)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-tint)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function SessionGroup({ label, sessions, currentSessionId, deletingId, onSelect, onDelete }) {
  // 长按删除（移动端）：800ms 触发；触发后下个 click 跳过避免误选
  const longPressTimer = useRef(null)
  const longPressFiredSid = useRef(null)

  function startLongPress(sid) {
    longPressFiredSid.current = null
    longPressTimer.current = setTimeout(() => {
      longPressFiredSid.current = sid
      onDelete(sid, { stopPropagation: () => {} })
    }, 800)
  }
  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }
  function handleClick(sid) {
    if (longPressFiredSid.current === sid) {
      longPressFiredSid.current = null
      return  // 长按刚触发了删除，跳过这次 click
    }
    onSelect(sid)
  }

  return (
    <div className="mb-3">
      <div
        className="text-[10px] uppercase tracking-wider font-semibold px-1 mb-1"
        style={{ color: 'var(--v4-faint)' }}
      >
        {label}
      </div>
      <ul className="space-y-0.5">
        {sessions.map((s) => {
          const isCurrent = s.session_id === currentSessionId
          const isDeleting = deletingId === s.session_id
          return (
            <li
              key={s.session_id}
              className="group relative rounded-lg transition"
              style={{
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
                onClick={() => handleClick(s.session_id)}
                onTouchStart={() => startLongPress(s.session_id)}
                onTouchEnd={cancelLongPress}
                onTouchMove={cancelLongPress}
                onTouchCancel={cancelLongPress}
                disabled={isDeleting}
                className="w-full text-left px-2.5 py-1.5 disabled:opacity-40 select-none"
                style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p
                    className="text-[13px] line-clamp-1 flex-1"
                    style={{
                      color: isCurrent ? 'var(--v4-accent-deep)' : 'var(--v4-ink)',
                      fontWeight: isCurrent ? 600 : 500,
                    }}
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
              </button>
              {/* 桌面：hover 显示删除按钮；移动：长按整行删除（按钮 md 以上才显示）*/}
              <button
                type="button"
                onClick={(e) => onDelete(s.session_id, e)}
                disabled={isDeleting}
                className="hidden md:block absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition text-[11px] rounded p-1 disabled:opacity-50"
                style={{ color: 'var(--v4-warn)' }}
                title="删除这条对话"
              >
                {isDeleting ? '…' : '🗑'}
              </button>
            </li>
          )
        })}
      </ul>
      {/* 移动端长按提示（首条 group 显示一次也行，这里简化只显示在第一组）*/}
    </div>
  )
}
