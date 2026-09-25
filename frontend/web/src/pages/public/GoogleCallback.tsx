import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { homePathFor } from '@/auth/AuthProvider'
import { Alert, Button, Card, Field, FullPageSpinner, Input, Logo } from '@/components/ui'
import { api, ApiError, applyTokens, type TokenOut } from '@/lib/api'
import { googleRedirectUri, saveGoogleSignup, takeGoogleState, type Intent } from '@/lib/google'

/** Google redirects here with ?code&state. We finish sign-in with the API. */
export default function GoogleCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const ran = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ token: string; next: string | null } | null>(null)
  const [intent, setIntent] = useState<Intent>('patient')

  const finish = (tokens: TokenOut, next: string | null) => {
    applyTokens(tokens)
    const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : homePathFor(tokens.user)
    navigate(safe, { replace: true })
  }

  useEffect(() => {
    if (ran.current) return // the code is single-use; don't double-submit in StrictMode
    ran.current = true
    const saved = takeGoogleState(params.get('state'))
    if (params.get('error')) return setError('Google sign-in was cancelled.')
    if (!saved || !params.get('code')) return setError('This sign-in link has expired. Please try again.')
    setIntent(saved.intent)
    api<TokenOut>('/auth/google', { method: 'POST', json: { code: params.get('code'), redirect_uri: googleRedirectUri(), intent: saved.intent } })
      .then((t) => finish(t, saved.next))
      .catch((e: unknown) => {
        const detail = e instanceof ApiError ? (e.detail as { code?: string; signup_token?: string; email?: string; full_name?: string; pending_token?: string }) : null
        if (detail?.code === 'physio_signup_required') {
          saveGoogleSignup({ signup_token: detail.signup_token!, email: detail.email!, full_name: detail.full_name! })
          navigate('/signin?as=physio&mode=register', { replace: true })
        } else if (detail?.code === 'totp_required') {
          setPending({ token: detail.pending_token!, next: saved.next })
        } else {
          setError(e instanceof Error ? e.message : 'Google sign-in failed.')
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (pending) return <TotpStep pending={pending} onDone={finish} />
  if (!error) return <FullPageSpinner />
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-[420px] p-8 text-center">
        <Logo className="mx-auto mb-6 h-9" />
        <Alert>{error}</Alert>
        <Link to={`/signin?as=${intent}`} className="eyebrow mt-6 inline-block !text-ink underline">Back to sign in</Link>
      </Card>
    </div>
  )
}

function TotpStep({ pending, onDone }: { pending: { token: string; next: string | null }; onDone: (t: TokenOut, next: string | null) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone(await api<TokenOut>('/auth/google/totp', { method: 'POST', json: { pending_token: pending.token, code } }), pending.next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect code')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-[420px] p-8">
        <Logo className="mb-6 h-9" />
        <form onSubmit={submit} className="space-y-4">
          <h1 className="text-[22px] font-bold">Two-factor authentication</h1>
          {error && <Alert>{error}</Alert>}
          <Field label="6-digit code" hint="Enter the code from your authenticator app.">
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus className="tracking-[0.4em]" />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>Verify & continue</Button>
        </form>
      </Card>
    </div>
  )
}
