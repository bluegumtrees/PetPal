// V4 Theme Switcher — 5 themes + localStorage persistence
// Reference: claude design / v4-primitives.jsx
import { useEffect, useState, useCallback } from 'react'

/** @type {{key:string, name:string, swatch:string[]}[]} */
export const THEMES = [
  { key: 'biscuit', name: '饼干', swatch: ['#e4a04a', '#f4cb84', '#d97c4f'] },
  { key: 'coral',   name: '暖橘', swatch: ['#f0a896', '#e98469', '#f4cb84'] },
  { key: 'mint',    name: '薄荷', swatch: ['#7cbca5', '#a8d8c8', '#e8c97b'] },
  { key: 'berry',   name: '莓果', swatch: ['#b88aae', '#e3b8d4', '#a4c4d4'] },
  { key: 'mono',    name: '极简', swatch: ['#8a8077', '#c8c0b5', '#c79456'] },
  { key: 'dark',    name: '夜间', swatch: ['#1f1a17', '#e98469', '#f4cb84'] },
]

const STORAGE_KEY = 'petpal-theme'
const DEFAULT_THEME = 'biscuit'

function readStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && THEMES.some((t) => t.key === v)) return v
  } catch {
    // ignore
  }
  return DEFAULT_THEME
}

function applyTheme(theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

/** Hook：返回 [theme, setTheme]，自动持久化到 localStorage 并应用到 <html> */
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const t = readStoredTheme()
    applyTheme(t)
    return t
  })

  const setTheme = useCallback((next) => {
    if (!THEMES.some((t) => t.key === next)) return
    setThemeState(next)
    applyTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }, [])

  // 防御性：初次挂载时强制 sync DOM（防止 SSR 不一致或外部修改）
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return [theme, setTheme]
}

/** 仅切到指定主题（导航/初始化用） */
export function setThemeImperative(theme) {
  if (!THEMES.some((t) => t.key === theme)) return
  applyTheme(theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // ignore
  }
}
