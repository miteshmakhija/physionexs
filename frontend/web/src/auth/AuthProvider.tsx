import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, applyTokens, refreshSession, setSessionListener, type Me, type Schemas, type TokenOut } from '@/lib/api'

type Status = 'loading' | 'signed-in' | 'signed-out'

interface AuthContextValue {
  status: Status
  me: Me | null
  requestOtp: (phone: string) => Promise<void>
  verifyOtp: (phone: string, code: string, fullName?: string) => Promise<Me>
  login: (identifier: string, password: string, totpCode?: string) => Promise<Me>
  registerPatient: (body: Schemas['PatientRegisterIn']) => Promise<Me>
  registerPhysio: (body: Schemas['PhysioRegisterIn']) => Promise<Me>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    setSessionListener((user) => {
      setMe(user)
      setStatus(user ? 'signed-in' : 'signed-out')
    })
    void refreshSession()
  }, [])

  const signIn = useCallback(async (path: string, json: unknown) => {
    const tokens = await api<TokenOut>(path, { method: 'POST', json })
    applyTokens(tokens)
    return tokens.user
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      requestOtp: async (phone) => {
        await api('/auth/otp/request', { method: 'POST', json: { phone } })
      },
      verifyOtp: (phone, code, fullName) => signIn('/auth/otp/verify', { phone, code, full_name: fullName || undefined }),
      login: (identifier, password, totpCode) =>
        signIn('/auth/login', { identifier, password, totp_code: totpCode || undefined }),
      registerPatient: (body) => signIn('/auth/register/patient', body),
      registerPhysio: (body) => signIn('/auth/register/physio', body),
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
        applyTokens(null)
      },
    }),
    [status, me, signIn],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** Where a signed-in user lands. */
export function homePathFor(me: Me): string {
  if (me.role === 'super_admin') return '/admin'
  if (me.role === 'physio' || me.role === 'staff') return '/clinic'
  return '/app'
}
