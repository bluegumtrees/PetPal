import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PetSwitcher from './PetSwitcher'

function navClass({ isActive }) {
  return (
    'px-3 py-1.5 rounded-lg text-sm transition ' +
    (isActive
      ? 'bg-amber-100 text-amber-700 font-medium'
      : 'text-slate-600 hover:bg-slate-100')
  )
}

export default function Header() {
  const [health, setHealth] = useState(null)
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
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
    <header className="border-b border-slate-200 bg-white/85 backdrop-blur sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 mr-2">
          <span className="text-2xl">🐾</span>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 leading-tight">PetPal</h1>
            <p className="text-[10px] text-slate-400 leading-tight">多模态宠物管家</p>
          </div>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={navClass}>
            💬 对话
          </NavLink>
          <NavLink to="/dashboard" className={navClass}>
            仪表盘
          </NavLink>
          <NavLink to="/pets" className={navClass}>
            宠物
          </NavLink>
          <NavLink to="/dev/vet-search" className={navClass}>
            <span className="opacity-60">⚙</span> 检索调试
          </NavLink>
        </nav>

        <div className="flex-1" />

        <div className="text-[10px] text-slate-400 hidden sm:block">
          {health?.ok ? (
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />v{health.version}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />offline
            </span>
          )}
        </div>

        <PetSwitcher />

        {user && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-100 transition"
              title={user.email}
            >
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-rose-400 text-white text-xs font-medium flex items-center justify-center">
                {(user.name || user.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="text-xs text-slate-600 hidden sm:inline max-w-[80px] truncate">
                {user.name}
              </span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-sm font-medium text-slate-700 truncate">{user.name}</p>
                  <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  {user.is_demo && (
                    <p className="text-[10px] text-amber-600 mt-0.5">🎈 试用账号（数据共享）</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
