import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '../api'

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
  /** @type {[Pet[], Function]} */
  const [pets, setPets] = useState([])
  /** @type {[number|null, Function]} */
  const [activePetId, _setActivePetId] = useState(() => {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ? Number(v) : null
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const setActivePetId = useCallback((id) => {
    _setActivePetId(id)
    if (id) localStorage.setItem(STORAGE_KEY, String(id))
    else localStorage.removeItem(STORAGE_KEY)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/pets')
      setPets(data)
      // 如果 active 还在列表里，不动；否则选第一只；空就清空
      if (data.length === 0) {
        setActivePetId(null)
      } else {
        const stillExists = activePetId && data.some((p) => p.id === activePetId)
        if (!stillExists) setActivePetId(data[0].id)
      }
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
    // 故意只在 mount 时执行，后续靠手动调 reload；activePetId 通过 setter 维护
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

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
