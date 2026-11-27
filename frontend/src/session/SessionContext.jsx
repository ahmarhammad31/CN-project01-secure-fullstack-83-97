import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, setUnauthorizedHandler } from '../api/client.js'

// Who is logged in is server state, not client state. The token sits in an
// HttpOnly cookie that this code cannot read, so after every page load (and
// after every reload or a direct URL hit) the app asks GET /auth/me.
const SessionContext = createContext(null)

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading') // 'loading' until /auth/me answers
  const [sessionEnded, setSessionEnded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      // A 401 here just means "nobody is logged in" - it is not a session that
      // ended, so it must not raise the "please log in again" notice.
      setUser(await api('/auth/me', { expectUnauthorized: true }))
    } catch {
      setUser(null)
    } finally {
      setStatus('ready')
    }
  }, [])

  useEffect(() => {
    // One handler for the whole app: any 401 from a protected call (expired
    // token, tampered cookie, token revoked) drops the local session, and the
    // route guard then sends the user to /login.
    setUnauthorizedHandler(() => {
      setUser(null)
      setStatus('ready')
      setSessionEnded(true)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const signIn = useCallback(async (email, password) => {
    const loggedIn = await api('/auth/login', { method: 'POST', body: { email, password } })
    setUser(loggedIn)
    setSessionEnded(false)
    setStatus('ready')
    return loggedIn
  }, [])

  const signOut = useCallback(async () => {
    try {
      // Server-side logout: only the server can clear an HttpOnly cookie.
      await api('/auth/logout', { method: 'POST', expectUnauthorized: true })
    } finally {
      setUser(null)
      setSessionEnded(false)
      setStatus('ready')
    }
  }, [])

  const value = {
    user,
    status,
    isAdmin: user?.role === 'admin',
    sessionEnded,
    clearSessionEnded: () => setSessionEnded(false),
    refresh,
    signIn,
    signOut,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
