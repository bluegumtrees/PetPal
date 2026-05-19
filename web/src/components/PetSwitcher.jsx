import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePets } from '../context/PetContext'
import Avatar from './Avatar'

export default function PetSwitcher() {
  const { pets, activePet, setActivePetId, loading } = usePets()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // 点外面关闭
  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (loading) {
    return <div className="text-xs text-slate-400">…</div>
  }

  if (pets.length === 0) {
    return (
      <Link
        to="/pets/new"
        className="text-sm bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition"
      >
        + 新建宠物
      </Link>
    )
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-100 transition"
      >
        <Avatar pet={activePet || pets[0]} size={28} />
        <span className="text-sm font-medium text-slate-700 max-w-[100px] truncate">
          {activePet?.name || '选择宠物'}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" className="text-slate-400">
          <path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-slate-200 w-56 py-1 z-20">
          <div className="px-3 py-1.5 text-xs text-slate-400">切换当前宠物</div>
          {pets.map((p) => {
            const active = p.id === activePet?.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActivePetId(p.id)
                  setOpen(false)
                }}
                className={
                  'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-50 transition ' +
                  (active ? 'bg-amber-50' : '')
                }
              >
                <Avatar pet={p} size={28} />
                <span className="flex-1 text-sm text-slate-700 truncate">{p.name}</span>
                {active && <span className="text-amber-500">✓</span>}
              </button>
            )
          })}
          <div className="border-t border-slate-100 mt-1 pt-1">
            <Link
              to="/pets/new"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-amber-600 hover:bg-amber-50 transition"
            >
              + 新建宠物
            </Link>
            <Link
              to="/pets"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition"
            >
              查看全部
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
