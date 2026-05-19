import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
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

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }))
  }, [])

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
      </div>
    </header>
  )
}
