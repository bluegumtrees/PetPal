import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePets } from '../context/PetContext'
import { useSidebar } from '../context/SidebarContext'
import Avatar from './Avatar'
import MobileDrawer from './MobileDrawer'
import PetSwitcher from './PetSwitcher'
import Sidebar from './Sidebar'
import ThemeSwitcher from './ThemeSwitcher'

function navClass({ isActive }) {
  return (
    'px-3 py-1.5 rounded-lg text-sm transition ' + (isActive ? 'font-medium' : '')
  )
}

function navStyle({ isActive }) {
  return isActive
    ? { background: 'var(--v4-accent-soft)', color: 'var(--v4-accent-deep)' }
    : { color: 'var(--v4-mute)' }
}

export default function Header() {
  const [health, setHealth] = useState(null)
  const { user, logout } = useAuth()
  const { activePet } = usePets()
  const [menuOpen, setMenuOpen] = useState(false)
  const {
    open: drawerOpen,
    openSidebar,
    closeSidebar,
    petPanelOpen,
    openPetPanel,
    closePetPanel,
    props: sidebarProps,
  } = useSidebar()
  const menuRef = useRef(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }))
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  return (
    <>
      <header
        className="sticky top-0 z-10 backdrop-blur border-b"
        style={{
          background: 'color-mix(in oklch, var(--v4-card) 85%, transparent)',
          borderColor: 'var(--v4-line)',
        }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center gap-2 sm:gap-4">
          {/* 移动端 hamburger（仅 < md） */}
          <button
            type="button"
            onClick={openSidebar}
            className="md:hidden p-1.5 rounded-lg transition"
            style={{ color: 'var(--v4-ink)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-tint)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            aria-label="打开菜单"
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path
                d="M3 6h16M3 11h16M3 16h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <Link to="/" className="flex items-center gap-2 mr-2">
            <span className="text-2xl">🐾</span>
            <div className="hidden sm:block">
              <h1 className="text-lg font-semibold leading-tight" style={{ color: 'var(--v4-ink)' }}>
                PetPal
              </h1>
              <p className="text-[10px] leading-tight" style={{ color: 'var(--v4-faint)' }}>
                多模态宠物管家
              </p>
            </div>
          </Link>

          {/* 桌面 nav（md+ 显示） */}
          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/" end className={navClass} style={navStyle}>
              💬 对话
            </NavLink>
            <NavLink to="/dashboard" className={navClass} style={navStyle}>
              仪表盘
            </NavLink>
            <NavLink to="/pets" className={navClass} style={navStyle}>
              宠物
            </NavLink>
            <NavLink to="/dev/vet-search" className={navClass} style={navStyle}>
              <span className="opacity-60">⚙</span> 检索调试
            </NavLink>
          </nav>

          <div className="flex-1" />

          <div className="text-[10px] hidden lg:block" style={{ color: 'var(--v4-faint)' }}>
            {health?.ok ? (
              <span className="inline-flex items-center gap-1">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--v4-second)' }}
                />
                v{health.version}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--v4-warn)' }} />
                offline
              </span>
            )}
          </div>

          <ThemeSwitcher />

          {/* 桌面端：PetSwitcher dropdown（切换宠物）*/}
          <div className="hidden md:block">
            <PetSwitcher />
          </div>

          {/* 桌面端 + 移动端：宠物状态面板 toggle 按钮（最右）*/}
          {activePet && (
            <button
              type="button"
              onClick={petPanelOpen ? closePetPanel : openPetPanel}
              className="flex items-center gap-2 px-2 py-1 rounded-lg transition"
              style={{
                background: petPanelOpen ? 'var(--v4-accent-soft)' : 'transparent',
                color: petPanelOpen ? 'var(--v4-accent-deep)' : 'var(--v4-ink)',
              }}
              onMouseEnter={(e) => {
                if (!petPanelOpen) e.currentTarget.style.background = 'var(--v4-tint)'
              }}
              onMouseLeave={(e) => {
                if (!petPanelOpen) e.currentTarget.style.background = 'transparent'
              }}
              title={petPanelOpen ? '收起宠物状态' : `查看 ${activePet.name} 的状态`}
            >
              {/* 移动端显示宠物头像；桌面端显示 panel icon */}
              <span className="md:hidden">
                <Avatar pet={activePet} size={28} />
              </span>
              <svg
                className="hidden md:block"
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden
              >
                {/* sidebar/panel toggle icon: rectangle with right-side highlight */}
                <rect
                  x="2.5"
                  y="3"
                  width="13"
                  height="12"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
                <rect x="11.5" y="3" width="4" height="12" rx="2" fill="currentColor" opacity="0.7" />
              </svg>
            </button>
          )}

          {/* 账号头像（仅桌面端；移动端在左抽屉底部已有）*/}
          {user && (
            <div ref={menuRef} className="hidden md:block relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg transition"
                style={{ color: 'var(--v4-ink)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-tint)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title={user.email}
              >
                <span
                  className="w-7 h-7 rounded-full text-white text-xs font-medium flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, var(--v4-accent), var(--v4-accent-deep))',
                  }}
                >
                  {(user.name || user.email).slice(0, 1).toUpperCase()}
                </span>
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-56 rounded-xl z-20 overflow-hidden border"
                  style={{
                    background: 'var(--v4-card)',
                    borderColor: 'var(--v4-line)',
                    boxShadow: 'var(--v4-shadow)',
                  }}
                >
                  <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--v4-line)' }}>
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--v4-ink)' }}>
                      {user.name}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--v4-faint)' }}>
                      {user.email}
                    </p>
                    {user.is_demo && (
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--v4-accent)' }}>
                        🎈 试用账号（数据共享）
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={logout}
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
        </div>
      </header>

      {/* 左抽屉：完整 sidebar（导航 + 宠物切换 + sessions）— 仅移动端用 */}
      <MobileDrawer open={drawerOpen} onClose={closeSidebar} side="left">
        <Sidebar
          showCloseBtn
          onClose={closeSidebar}
          onNavigate={closeSidebar}
          currentSessionId={sidebarProps.currentSessionId}
          onSelectSession={sidebarProps.onSelectSession}
          onCurrentSessionDeleted={sidebarProps.onCurrentSessionDeleted}
          onNewSession={sidebarProps.onNewSession}
        />
      </MobileDrawer>
    </>
  )
}
