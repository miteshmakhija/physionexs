import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import type { components } from '@shared/api-types'

export type Schemas = components['schemas']
export type Me = Schemas['MeOut']
export type TokenOut = Schemas['TokenOut']

const BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'https://api.physionexs.com').replace(/\/$/, '')
const REFRESH_KEY = 'pnx_refresh'

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : errorMessage(detail))
    this.status = status
    this.detail = detail
  }
}

// SecureStore is native-only; the web build (dev preview) falls back to localStorage.
const store = {
  get: (k: string) => (Platform.OS === 'web' ? Promise.resolve(localStorage.getItem(k)) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.setItem(k, v)) : SecureStore.setItemAsync(k, v),
  del: (k: string) => (Platform.OS === 'web' ? Promise.resolve(localStorage.removeItem(k)) : SecureStore.deleteItemAsync(k)),
}

let accessToken: string | null = null
let refreshing: Promise<TokenOut | null> | null = null
let onSessionChange: (me: Me | null) => void = () => {}

export function setSessionListener(fn: (me: Me | null) => void) {
  onSessionChange = fn
}

export async function applyTokens(tokens: TokenOut | null) {
  accessToken = tokens?.access_token ?? null
  if (tokens?.refresh_token) await store.set(REFRESH_KEY, tokens.refresh_token)
  if (!tokens) await store.del(REFRESH_KEY)
  onSessionChange(tokens?.user ?? null)
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-Client', 'mobile')
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`${BASE}${path}`, { ...init, headers })
}

/** Restore or renew the session from the stored refresh token. Concurrent callers share one request. */
export function refreshSession(): Promise<TokenOut | null> {
  refreshing ??= (async (): Promise<TokenOut | null> => {
    const refreshToken = await store.get(REFRESH_KEY)
    if (!refreshToken) {
      onSessionChange(null)
      return null
    }
    let res: Response
    try {
      res = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) })
    } catch {
      // Offline: keep the stored token so the next launch can retry.
      onSessionChange(null)
      return null
    }
    const tokens = res.ok ? ((await res.json()) as TokenOut) : null
    if (tokens || res.status === 401) await applyTokens(tokens) // 401 = expired or revoked → forget it
    else onSessionChange(null)
    return tokens
  })().finally(() => {
      refreshing = null
    })
  return refreshing
}

export interface ApiInit extends RequestInit {
  json?: unknown
  /** Sent as X-Clinic-Id for practice-console endpoints. */
  clinicId?: string
  query?: Record<string, string | number | boolean | null | undefined>
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, clinicId, query, ...rest } = init
  const headers = new Headers(rest.headers)
  if (clinicId) headers.set('X-Clinic-Id', clinicId)
  const req: RequestInit = { ...rest, headers, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    if (qs) path += `?${qs}`
  }

  let res = await raw(path, req)
  if (res.status === 401 && accessToken && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await raw(path, req)
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.detail ?? res.statusText)
  return body as T
}

export async function logoutRequest() {
  const refreshToken = await store.get(REFRESH_KEY)
  await api('/auth/logout', { method: 'POST', json: { refresh_token: refreshToken } }).catch(() => undefined)
}

function errorMessage(detail: unknown): string {
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '')
  return 'Something went wrong. Please try again.'
}
