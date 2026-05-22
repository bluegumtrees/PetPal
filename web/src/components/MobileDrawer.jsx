import { useEffect } from 'react'

/**
 * 通用左/右滑出抽屉。桌面端可用，移动端必用。
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   side?: 'left' | 'right',
 *   width?: string,  // tailwind class like 'w-80' or fluid 'w-[85vw] max-w-sm'
 *   children: any
 * }} props
 */
export default function MobileDrawer({
  open,
  onClose,
  side = 'left',
  width = 'w-[85vw] max-w-sm',
  children,
}) {
  // 锁 body 滚动 + ESC 关闭
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <>
      {/* 半透明遮罩 */}
      <div
        className={
          'fixed inset-0 z-40 transition-opacity ' +
          (open ? 'opacity-100' : 'opacity-0 pointer-events-none')
        }
        style={{ background: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
        aria-hidden
      />
      {/* 抽屉面板 */}
      <aside
        className={
          'fixed top-0 bottom-0 z-50 flex flex-col transition-transform duration-200 ease-out ' +
          width +
          ' ' +
          (side === 'left' ? 'left-0 border-r' : 'right-0 border-l') +
          ' ' +
          (open
            ? 'translate-x-0'
            : side === 'left'
            ? '-translate-x-full'
            : 'translate-x-full')
        }
        style={{
          background: 'var(--v4-card)',
          borderColor: 'var(--v4-line)',
          boxShadow: 'var(--v4-shadow)',
        }}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </aside>
    </>
  )
}
