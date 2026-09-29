import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Alert, Button, Card, Field, Logo, PasswordInput } from '@/components/ui'
import { api } from '@/lib/api'

/** Where the "Reset password" link in the email lands: choose a new password, then sign in. */
export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setError('The two passwords don’t match.')
    setBusy(true)
    setError(null)
    try {
      await api('/auth/password/reset-link', { method: 'POST', json: { token, new_password: password } })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[460px]">
        <Link to="/" className="mb-8 flex justify-center"><Logo className="h-10" /></Link>
        <Card className="space-y-5 p-6 sm:p-8">
          <div>
            <h1 className="text-[24px] font-bold tracking-[-0.02em]">Choose a new password</h1>
            {!done && <p className="mt-1 text-[13.5px] text-muted">You’ll be signed out everywhere else.</p>}
          </div>
          {!token ? (
            <Alert>This link is incomplete. Open it again from the email, or request a new one.</Alert>
          ) : done ? (
            <>
              <Alert tone="info">Password updated. Sign in with your new password.</Alert>
              <div className="grid gap-2 sm:grid-cols-2">
                <Link to="/signin?as=patient" className="flex h-11 items-center justify-center bg-ink text-[12.5px] font-semibold uppercase tracking-[0.09em] text-white hover:bg-ink-2">I’m a patient</Link>
                <Link to="/signin?as=physio" className="flex h-11 items-center justify-center border border-ink text-[12.5px] font-semibold uppercase tracking-[0.09em] hover:bg-surface-2">Clinic sign in</Link>
              </div>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <Alert>{error}</Alert>}
              <Field label="New password" hint="At least 8 characters.">
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required autoFocus />
              </Field>
              <Field label="Repeat new password">
                <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
              </Field>
              <Button type="submit" loading={busy} className="w-full">Set new password</Button>
            </form>
          )}
          <Link to="/signin" className="block text-[13px] font-semibold text-ink underline">← Back to sign in</Link>
        </Card>
      </div>
    </div>
  )
}
