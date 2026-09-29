import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, applyTokens, logoutRequest, refreshSession, setSessionListener, type Me, type TokenOut } from '@/lib/api'
import { unregisterPush } from '@/lib/push'

type Status = 'loading' | 'signed-in' | 'signed-out'
/** Which sign-in screen is asking: the server refuses accounts that belong on the other one. */
export type Portal = 'patient' | 'clinic'

interface Session {
  status: Status
  me: Me | null
  login: (email: string, password: string, portal: Portal, totpCode?: string) => Promise<Me>
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
      login: (email, password, portal, totpCode) =>
        signIn('/auth/login', { identifier: email, password, intent: portal, totp_code: totpCode || undefined }),
      registerPatient: (body) => signIn('/auth/register/patient', body),
      logout: async () => {
        await unregisterPush()
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
