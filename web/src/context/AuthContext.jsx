import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken } from '../api'

const AuthContext = createContext({
  user: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  demoLogin: async () => {},
  logout: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

/** @param {{ children: any }} props */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // 启动时如果有 token → 拿 /me 校验有效性
  useEffect(() => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }
    api('/api/auth/me')
      .then((u) => setUser(u))
      .catch(() => {
        setToken(null)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    setToken(data.access_token)
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (email, password, name) => {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: { email, password, name },
    })
    setToken(data.access_token)
    setUser(data.user)
    return data.user
  }, [])

  const demoLogin = useCallback(async () => {
    const data = await api('/api/auth/demo-login', { method: 'POST' })
    setToken(data.access_token)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    // 跳到 login（用 window.location 而非 navigate 避免 context 依赖）
    window.location.assign('/login')
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, demoLogin, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
