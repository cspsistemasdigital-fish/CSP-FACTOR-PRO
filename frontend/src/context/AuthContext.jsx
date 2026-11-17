import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi } from '../api'
import { bootstrapSession, setAccessToken, setSessionHandlers } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    setSessionHandlers({
      onRefreshed: (data) => {
        if (data?.user) setUser(data.user)
      },
      onLost: () => {
        setAccessToken(null)
        setUser(null)
      },
    })
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const data = await bootstrapSession()
      if (!active) return
      if (data?.user) setUser(data.user)
      setBooting(false)
    })()
    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (email, password) => {
    const { data } = await authApi.login(email, password)
    setAccessToken(data.access_token)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setAccessToken(null)
      setUser(null)
    }
  }, [])

  const hasRole = useCallback(
    (...roles) => Boolean(user && roles.includes(user.role)),
    [user],
  )

  const value = useMemo(
    () => ({
      user,
      booting,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'ADMIN',
      canWrite: user?.role === 'ADMIN' || user?.role === 'OPERATOR',
      login,
      logout,
      hasRole,
      setUser,
    }),
    [user, booting, login, logout, hasRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return context
}
