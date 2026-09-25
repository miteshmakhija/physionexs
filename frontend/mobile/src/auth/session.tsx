import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, applyTokens, logoutRequest, refreshSession, setSessionListener, type Me, type TokenOut } from '@/lib/api'

type Status = 'loading' | 'signed-in' | 'signed-out'

interface Session {
  status: Status
  me: Me | null
  requestOtp: (phone: string) => Promise<void>
  verifyOtp: (phone: string, code: string, fullName?: string) => Promise<Me>
  login: (identifier: string, password: string, totpCode?: string) => Promise<Me>
  registerPatient: (body: { full_name: string; email: string; phone?: string | null; password: string }) => Promise<Me>
  logout: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

async function signIn(path: string, json: unknown) {
  const tokens = await api<TokenOut>(path, { method: 'POST', json })
  await applyTokens(tokens)
  return tokens.user
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    setSessionListener((user) => {
      setMe(user)
      setStatus(user ? 'signed-in' : 'signed-out')
    })
    void refreshSession()
  }, [])

  const value = useMemo<Session>(
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
      logout: async () => {
        await logoutRequest()
        await applyTokens(null)
      },
    }),
    [status, me],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
