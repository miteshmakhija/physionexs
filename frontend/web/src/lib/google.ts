import { api, type Schemas } from '@/lib/api'

export type Intent = 'patient' | 'physio'
const KEY = 'pnx_google_state'

export function googleRedirectUri() {
  return `${window.location.origin}/auth/google/callback`
}

let config: Promise<Schemas['AuthConfigOut']> | null = null
export function authConfig() {
  config ??= api<Schemas['AuthConfigOut']>('/platform/auth-config').catch(() => ({ google_client_id: null }))
  return config
}

/** Send the browser to Google's consent screen. `state` guards the callback against CSRF. */
export async function startGoogle(intent: Intent, next?: string | null) {
  const { google_client_id } = await authConfig()
  if (!google_client_id) throw new Error('Google sign-in is not available right now')
  const state = crypto.randomUUID()
  sessionStorage.setItem(KEY, JSON.stringify({ state, intent, next: next ?? null }))
  const params = new URLSearchParams({
    client_id: google_client_id,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  })
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}

/** Read and clear the pending sign-in; null if the state doesn't match (forged or stale callback). */
export function takeGoogleState(state: string | null): { intent: Intent; next: string | null } | null {
  const raw = sessionStorage.getItem(KEY)
  sessionStorage.removeItem(KEY)
  if (!raw || !state) return null
  try {
    const saved = JSON.parse(raw) as { state: string; intent: Intent; next: string | null }
    return saved.state === state ? { intent: saved.intent, next: saved.next } : null
  } catch {
    return null
  }
}
