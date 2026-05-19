import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * 轻量 Toast 系统。
 * 用法：
 *   const toast = useToast()
 *   toast('已开始新对话')                 // 普通
 *   toast('错误', { kind: 'error' })       // 红色
 */

const ToastCtx = createContext(null)

let _nextId = 0

export function ToastProvider({ children }) {
  /** @type {[{id:number, message:string, kind:string}[], Function]} */
  const [items, setItems] = useState([])

  const dismiss = useCallback((id) => {
    setItems((arr) => arr.filter((x) => x.id !== id))
  }, [])

  const show = useCallback(
    (message, { kind = 'info', durationMs = 3000 } = {}) => {
      const id = ++_nextId
      setItems((arr) => [...arr, { id, message, kind }])
      if (durationMs > 0) {
        setTimeout(() => dismiss(id), durationMs)
      }
      return id
    },
    [dismiss]
  )

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              'pointer-events-auto px-4 py-2.5 rounded-xl shadow-lg text-sm text-white animate-[fade-in_120ms_ease-out] ' +
              (t.kind === 'error'
                ? 'bg-red-600'
                : t.kind === 'success'
                ? 'bg-emerald-600'
                : 'bg-slate-800')
            }
            onClick={() => dismiss(t.id)}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/** @returns {(message: string, opts?: {kind?: 'info'|'error'|'success', durationMs?: number}) => number} */
export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
