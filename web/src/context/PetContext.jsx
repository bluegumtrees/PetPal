import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth } from './AuthContext'

/**
 * @typedef {Object} Pet
 * @property {number} id
 * @property {string} name
 * @property {'cat'|'dog'} species
 * @property {string=} breed
 * @property {string=} birthday
 * @property {string=} gender
 * @property {boolean=} neutered
 * @property {number=} weight_kg
 * @property {string=} photo_url
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string=} deleted_at
 */

/**
 * @typedef {Object} PetCtx
 * @property {Pet[]} pets
 * @property {Pet|null} activePet
 * @property {number|null} activePetId
 * @property {(id:number|null)=>void} setActivePetId
 * @property {()=>Promise<void>} reload
 * @property {boolean} loading
 * @property {string} error
 */

/** @type {React.Context<PetCtx|null>} */
const PetContext = createContext(null)

const STORAGE_KEY = 'petpal.activePetId'

export function PetProvider({ children }) {
  const { user, loading: authLoading } = useAuth()

  /** @type {[Pet[], Function]} */
  const [pets, setPets] = useState([])
  /** @type {[number|null, Function]} */
  const [activePetId, _setActivePetId] = useState(() => {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ? Number(v) : null
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 用 ref 存当前选中 id，避免 reload 的闭包拿到过期值（否则跨账号对账失效）
  const activePetIdRef = useRef(activePetId)

  const setActivePetId = useCallback((id) => {
    activePetIdRef.current = id
    _setActivePetId(id)
    try {
      if (id) localStorage.setItem(STORAGE_KEY, String(id))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* 隐私模式 localStorage 不可写，忽略 */
    }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/pets')
      setPets(data)
      // 对账：localStorage 里存的 activePetId 可能来自同一浏览器的另一个账号
      // （例如先登自己的号选了宠物，再用 /login?demo=1 进 demo）。
      // 只要它不在当前账号的宠物列表里，就落到列表第一只，避免对别人的 pet 发请求拿 404。
      const cur = activePetIdRef.current
      if (data.length === 0) {
        setActivePetId(null)
      } else if (!data.some((p) => p.id === cur)) {
        setActivePetId(data[0].id)
      }
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [setActivePetId])

  // V2: 仅在已登录时 fetch；切账号自动重新加载
  useEffect(() => {
    if (authLoading) return  // 等 AuthProvider 决断
    if (!user) {
      setPets([])
      setActivePetId(null)
      setLoading(false)
      return
    }
    reload()
  }, [user?.id, authLoading, reload])

  const activePet = pets.find((p) => p.id === activePetId) ?? null

  return (
    <PetContext.Provider
      value={{ pets, activePet, activePetId, setActivePetId, reload, loading, error }}
    >
      {children}
    </PetContext.Provider>
  )
}

/** @returns {PetCtx} */
export function usePets() {
  const ctx = useContext(PetContext)
  if (!ctx) throw new Error('usePets must be used inside <PetProvider>')
  return ctx
}
