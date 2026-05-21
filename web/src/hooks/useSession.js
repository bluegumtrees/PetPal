import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'petpal.sessions'

/**
 * Per-pet long-running session 管理（localStorage 持久化）。
 * 切宠物自动切对应 session_id；newSession() 重置当前 pet 的 session。
 *
 * Storage schema:
 *   { [petId]: "uuid-string" }
 */

/**
 * @param {number|null} petId
 * @returns {{ sessionId: string|null, newSession: () => string, switchTo: (sid: string) => void }}
 */
export default function useSession(petId) {
  const [sessionId, setSessionId] = useState(null)

  // 读取或生成 sessionId
  useEffect(() => {
    if (!petId) {
      setSessionId(null)
      return
    }
    const map = readMap()
    if (map[petId]) {
      setSessionId(map[petId])
    } else {
      const fresh = uuid()
      map[petId] = fresh
      writeMap(map)
      setSessionId(fresh)
    }
  }, [petId])

  const newSession = useCallback(() => {
    if (!petId) return null
    const fresh = uuid()
    const map = readMap()
    map[petId] = fresh
    writeMap(map)
    setSessionId(fresh)
    return fresh
  }, [petId])

  /** 切到历史 session（不创建新的，从 SessionList 选了某条历史时用）。 */
  const switchTo = useCallback((newSessionId) => {
    if (!petId || !newSessionId) return
    const map = readMap()
    map[petId] = newSessionId
    writeMap(map)
    setSessionId(newSessionId)
  }, [petId])

  return { sessionId, newSession, switchTo }
}

function readMap() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ? JSON.parse(v) : {}
  } catch {
    return {}
  }
}

function writeMap(m) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m))
  } catch {
    /* quota or disabled */
  }
}

function uuid() {
  // crypto.randomUUID 现代浏览器都支持
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
