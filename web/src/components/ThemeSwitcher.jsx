import { useEffect, useRef, useState } from 'react'
import { THEMES, useTheme } from '../hooks/useTheme'

/**
 * V4 主题切换器 — Header 右上角小色环图标，点开下拉列出 5 个 swatch。
 * 主题切换通过 [data-theme="..."] on <html>，CSS vars 全局生效。
 */
export default function ThemeSwitcher() {
  const [theme, setTheme] = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const current = THEMES.find((t) => t.key === theme) || THEMES[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`主题：${current.name}`}
        className="w-8 h-8 rounded-full flex items-center justify-center transition hover:scale-105"
        style={{ background: 'var(--v4-tint)' }}
      >
        {/* 当前主题的三个 swatch 拼成小色环 */}
        <span className="relative w-4 h-4">
          {current.swatch.map((c, i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                width: 9,
                height: 9,
                background: c,
                top: i === 0 ? 0 : 'auto',
                bottom: i === 1 ? 0 : 'auto',
                left: i === 2 ? 0 : 'auto',
                right: i !== 2 ? 0 : 'auto',
              }}
            />
          ))}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-44 rounded-xl shadow-xl z-20 overflow-hidden border"
          style={{ background: 'var(--v4-card)', borderColor: 'var(--v4-line)' }}
        >
          <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--v4-faint)' }}>
            选择主题
          </div>
          {THEMES.map((t) => {
            const active = t.key === theme
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTheme(t.key)
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition"
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
                <span className="relative w-5 h-5 shrink-0">
                  {t.swatch.map((c, i) => (
                    <span
                      key={i}
                      className="absolute rounded-full"
                      style={{
                        width: 11,
                        height: 11,
                        background: c,
                        top: i === 0 ? 0 : 'auto',
                        bottom: i === 1 ? 0 : 'auto',
                        left: i === 2 ? 0 : 'auto',
                        right: i !== 2 ? 0 : 'auto',
                      }}
                    />
                  ))}
                </span>
                <span className="flex-1 text-left">{t.name}</span>
                {active && <span className="text-xs">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
