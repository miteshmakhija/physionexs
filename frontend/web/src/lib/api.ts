import type { components } from '@shared/api-types'

export type Schemas = components['schemas']
export type Me = Schemas['MeOut']
export type TokenOut = Schemas['TokenOut']

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : errorMessage(detail))
    this.status = status
    this.detail = detail
  }
}

// Access token lives in memory only; the refresh token is an httpOnly cookie set by the API.
let accessToken: string | null = null
let refreshing: Promise<TokenOut | null> | null = null
let onSessionChange: (me: Me | null) => void = () => {}

export function setSessionListener(fn: (me: Me | null) => void) {
  onSessionChange = fn
}

export function applyTokens(tokens: TokenOut | null) {
  accessToken = tokens?.access_token ?? null
  onSessionChange(tokens?.user ?? null)
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-Client', 'web')
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<TokenOut | null> {
  refreshing ??= raw('/auth/refresh', { method: 'POST' })
    .then(async (res) => (res.ok ? ((await res.json()) as TokenOut) : null))
    .catch(() => null)
    .then((tokens) => {
      applyTokens(tokens)
      return tokens
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const req: RequestInit = json === undefined ? rest : { ...rest, body: JSON.stringify(json) }

  let res = await raw(path, req)
  if (res.status === 401 && accessToken && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await raw(path, req)
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.detail ?? res.statusText)
  return body as T
}

function errorMessage(detail: unknown): string {
  // FastAPI validation errors: [{loc, msg, type}]
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '')
  return 'Something went wrong. Please try again.'
}
