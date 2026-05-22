import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePets } from '../context/PetContext'
import Avatar from './Avatar'
import { V4Btn } from './v4'

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
    return (
      <div className="text-xs" style={{ color: 'var(--v4-faint)' }}>
        …
      </div>
    )
  }

  if (pets.length === 0) {
    return (
      <Link to="/pets/new">
        <V4Btn variant="primary" size="sm" icon="sparkle">
          新建宠物
        </V4Btn>
      </Link>
    )
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg transition"
        style={{ color: 'var(--v4-ink)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-tint)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <Avatar pet={activePet || pets[0]} size={28} />
        <span
          className="text-sm font-medium max-w-[100px] truncate"
          style={{ color: 'var(--v4-ink)' }}
        >
          {activePet?.name || '选择宠物'}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          style={{ color: 'var(--v4-faint)' }}
        >
          <path
            d="M3 5l3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-lg shadow-xl w-56 py-1 z-20 border"
          style={{ background: 'var(--v4-card)', borderColor: 'var(--v4-line)' }}
        >
          <div className="px-3 py-1.5 text-xs" style={{ color: 'var(--v4-faint)' }}>
            切换当前宠物
          </div>
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
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition"
                style={{
                  background: active ? 'var(--v4-accent-soft)' : 'transparent',
                  color: active ? 'var(--v4-accent-deep)' : 'var(--v4-ink)',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--v4-tint)'
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent'
                }}
              >
                <Avatar pet={p} size={28} />
                <span className="flex-1 text-sm truncate">{p.name}</span>
                {active && <span style={{ color: 'var(--v4-accent)' }}>✓</span>}
              </button>
            )
          })}
          <div className="border-t mt-1 pt-1" style={{ borderColor: 'var(--v4-line)' }}>
            <Link
              to="/pets/new"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm transition"
              style={{ color: 'var(--v4-accent-deep)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-accent-soft)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              + 新建宠物
            </Link>
            <Link
              to="/pets"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm transition"
              style={{ color: 'var(--v4-mute)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-tint)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              查看全部
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
