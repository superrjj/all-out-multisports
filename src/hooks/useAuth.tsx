import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { jwtDecode } from 'jwt-decode'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../types'

interface TokenPayload {
  role?: string
  user_role?: string
}

interface AuthContextValue {
  session: Session | null
  role: UserRole
  loading: boolean
  roleLoading: boolean
  login: (email: string, password: string) => Promise<void>
  /** Returns `session` when email is already confirmed / no OTP step; otherwise `null` and user must `verifySignupOtp`. */
  register: (email: string, password: string, fullName: string) => Promise<{ session: Session | null }>
  verifySignupOtp: (email: string, token: string) => Promise<void>
  resendConfirmation: (email: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [dbRole, setDbRole] = useState<UserRole | null>(null)
  const [roleLoading, setRoleLoading] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) {
      setDbRole(null)
      setRoleLoading(false)
      return
    }

    let active = true
    setRoleLoading(true)
    void (async () => {
      try {
        const { data, error } = await supabase.from('users').select('role').eq('id', userId).maybeSingle()
        if (!active) return
        if (error) {
          setDbRole(null)
          setRoleLoading(false)
          return
        }
        setDbRole(data?.role === 'admin' ? 'admin' : 'cyclist')
        setRoleLoading(false)
      } catch {
        if (!active) return
        setDbRole(null)
        setRoleLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [session?.user?.id])

  const role = useMemo<UserRole>(() => {
    if (dbRole) return dbRole
    const token = session?.access_token
    if (!token) return 'cyclist'
    try {
      const payload = jwtDecode<TokenPayload>(token)
      return payload.user_role === 'admin' || payload.role === 'admin' ? 'admin' : 'cyclist'
    } catch {
      return 'cyclist'
    }
  }, [dbRole, session?.access_token])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      role,
      loading,
      roleLoading,
      login: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      register: async (email, password, fullName) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, role: 'cyclist' },
          },
        })
        if (error) throw error
        return { session: data.session ?? null }
      },
      verifySignupOtp: async (email, token) => {
        const clean = String(token ?? '').replace(/\D/g, '')
        if (clean.length < 6) {
          throw new Error('Enter the full verification code from your email.')
        }
        if (clean.length > 12) {
          throw new Error('That code looks too long. Paste only the numbers from the email (up to 12 digits).')
        }
        const { error } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: clean,
          type: 'signup',
        })
        if (error) throw error
      },
      resendConfirmation: async (email) => {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
        })
        if (error) throw error
      },
      logout: async () => {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      },
    }),
    [loading, role, roleLoading, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
