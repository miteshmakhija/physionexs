import { useMutation } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { useState } from 'react'

import { useAuth } from '@/auth/AuthProvider'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Button, Field, Input } from '@/components/ui'
import { api, refreshSession, type Schemas } from '@/lib/api'

/** Two-factor authentication (authenticator app) setup for physios and admins. */
export default function Security() {
  const { me } = useAuth()
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const start = useMutation({
    mutationFn: async () => {
      const s = await api<Schemas['TotpSetupOut']>('/auth/totp/setup', { method: 'POST' })
      return { secret: s.secret, qr: await QRCode.toDataURL(s.otpauth_uri, { margin: 1, width: 220 }) }
    },
    onSuccess: setSetup,
  })
  const enable = useMutation({
    mutationFn: () => api<Schemas['MeOut']>('/auth/totp/enable', { method: 'POST', json: { code } }),
    onSuccess: () => void refreshSession(),
  })

  return (
    <div className="max-w-2xl">
      <PageHeader title="Account security" subtitle={me?.email ?? me?.phone ?? undefined} />
      <section className="border border-line p-6">
        <h2 className="text-[16px] font-semibold">Two-factor authentication</h2>
        {me?.totp_enabled ? (
          <p className="mt-2 text-[14px] text-leaf-dark">✓ On. You'll be asked for a code from your authenticator app each time you sign in.</p>
        ) : setup ? (
          <div className="mt-4 grid gap-6 sm:grid-cols-[220px_1fr]">
            <img src={setup.qr} alt="Scan with your authenticator app" className="size-[220px] border border-line" />
            <div className="space-y-4 text-[14px]">
              <ol className="list-decimal space-y-1 pl-5 text-ink-2">
                <li>Open Google Authenticator, Microsoft Authenticator or 1Password.</li>
                <li>Scan the code, or enter this key: <code className="break-all font-semibold text-ink">{setup.secret}</code></li>
                <li>Type the 6-digit code it shows.</li>
              </ol>
              <form onSubmit={(e) => { e.preventDefault(); enable.mutate() }} className="space-y-3">
                <Field label="6-digit code">
                  <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="tracking-[0.4em]" autoFocus />
                </Field>
                {enable.error && <Alert>{(enable.error as Error).message}</Alert>}
                <Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>Turn on</Button>
              </form>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 text-[14px] text-muted">
              Protect your account with a code from an authenticator app in addition to your password.
              {me?.role === 'super_admin' && ' Required for Super Admin access.'}
            </p>
            {start.error && <div className="mt-3"><Alert>{(start.error as Error).message}</Alert></div>}
            <Button className="mt-4" onClick={() => start.mutate()} loading={start.isPending}>Set up</Button>
          </>
        )}
      </section>
    </div>
  )
}
