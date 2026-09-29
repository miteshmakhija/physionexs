import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { homePathFor, useAuth } from '@/auth/AuthProvider'
import { Alert, Button, Card, cx, Field, Input, Logo, PasswordInput } from '@/components/ui'
import { api, ApiError, type Me, type Schemas } from '@/lib/api'
import { authConfig, startGoogle, type Intent } from '@/lib/google'

/** Patients and physiotherapists get separate sign-in pages; the role comes from ?as= or where they were going. */
export default function SignIn() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = params.get('next')
  const as = params.get('as')
  const audience: Intent | null =
    as === 'physio' || as === 'patient' ? as : next?.startsWith('/clinic') || next?.startsWith('/admin') ? 'physio' : next?.startsWith('/app') ? 'patient' : null

  const done = (me: Me) => navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : homePathFor(me), { replace: true })

  if (!audience) return <Chooser />
  return (
    <Shell>
      {audience === 'patient' ? <PatientAuth onDone={done} next={next} /> : <PhysioAuth onDone={done} next={next} initialMode={params.get('mode') === 'register' ? 'register' : 'signin'} />}
    </Shell>
  )
}

function Shell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[460px]">
        <Link to="/" className="mb-8 flex justify-center"><Logo className="h-10" /></Link>
        <Card className="p-6 sm:p-8">{children}</Card>
        {footer}
      </div>
    </div>
  )
}

function Chooser() {
  return (
    <Shell>
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">Sign in to Physionexs</h1>
      <p className="mt-1 text-[13.5px] text-muted">Choose how you use Physionexs.</p>
      <div className="mt-6 grid gap-3">
        {[
          { to: '/signin?as=patient', title: "I'm a patient", body: 'Book physios, follow your plan, track progress.' },
          { to: '/signin?as=physio', title: "I'm a physiotherapist or clinic staff", body: 'Run your clinic from the practice console.' },
        ].map((o) => (
          <Link key={o.to} to={o.to} className="border border-line p-4 transition hover:border-ink">
            <span className="block text-[15px] font-semibold">{o.title} →</span>
            <span className="block text-[13px] text-muted">{o.body}</span>
          </Link>
        ))}
      </div>
    </Shell>
  )
}

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
      {sub && <p className="mt-1 text-[13.5px] text-muted">{sub}</p>}
    </div>
  )
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-[12px] text-subtle">
      <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
    </div>
  )
}

function GoogleButton({ intent, next, label = 'Continue with Google' }: { intent: Intent; next: string | null; label?: string }) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void authConfig().then((c) => setAvailable(!!c.google_client_id))
  }, [])
  if (available === false) return null
  return (
    <div>
      <button
        type="button"
        disabled={busy || available === null}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await startGoogle(intent, next)
          } catch (e) {
            setError((e as Error).message)
            setBusy(false)
          }
        }}
        className="flex h-11 w-full items-center justify-center gap-3 rounded-md border border-line-strong bg-white text-[14px] font-semibold text-ink transition hover:bg-surface-2 disabled:opacity-60"
      >
        <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {busy ? 'Redirecting to Google…' : label}
      </button>
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
    </div>
  )
}

function useRun() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>, onApiError?: (e: ApiError) => boolean) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      if (!(e instanceof ApiError && onApiError?.(e))) setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

// ── Patient ─────────────────────────────────────────────────────────────────

function PatientAuth({ onDone, next }: { onDone: (me: Me) => void; next: string | null }) {
  const [emailMode, setEmailMode] = useState<'signin' | 'register' | 'forgot'>('signin')
  if (emailMode === 'forgot') return <ForgotPassword onBack={() => setEmailMode('signin')} />
  return (
    <div className="space-y-5">
      <Heading title={emailMode === 'register' ? 'Create your account' : 'Welcome to Physionexs'} sub="Sign in to book physios and follow your recovery plan." />
      <GoogleButton intent="patient" next={next} />
      <Divider />
      <PatientEmail mode={emailMode} setMode={setEmailMode} onDone={onDone} />
    </div>
  )
}

function PatientEmail({ mode, setMode, onDone }: { mode: 'signin' | 'register' | 'forgot'; setMode: (m: 'signin' | 'register' | 'forgot') => void; onDone: (me: Me) => void }) {
  const { login, registerPatient } = useAuth()
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '' })
  const { busy, error, run } = useRun()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () =>
      onDone(mode === 'register' ? await registerPatient({ full_name: f.full_name, email: f.email, phone: f.phone || null, password: f.password }) : await login(f.email, f.password, 'patient')),
    )
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {mode === 'register' && <Field label="Full name"><Input value={f.full_name} onChange={set('full_name')} autoComplete="name" required minLength={2} /></Field>}
      <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} autoComplete="email" required /></Field>
      {mode === 'register' && <Field label="Mobile number (optional)" hint="For appointment reminders. You sign in with your email."><Input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></Field>}
      <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
        <PasswordInput value={f.password} onChange={set('password')} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 8 : 1} required />
      </Field>
      {mode === 'signin' && (
        <div className="-mt-2 text-right">
          <button type="button" onClick={() => setMode('forgot')} className="text-[13px] font-semibold text-muted hover:text-ink">Forgot password?</button>
        </div>
      )}
      <Button type="submit" loading={busy} className="w-full">{mode === 'register' ? 'Create account' : 'Sign in'}</Button>
      <p className="text-center text-[13px] text-muted">
        {mode === 'register' ? 'Already have an account? ' : 'New to Physionexs? '}
        <button type="button" onClick={() => setMode(mode === 'register' ? 'signin' : 'register')} className="font-semibold text-ink underline">
          {mode === 'register' ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </form>
  )
}

// ── Forgot password (shared) ────────────────────────────────────────────────

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<'ask' | 'reset' | 'done'>('ask')
  const [identifier, setIdentifier] = useState('')
  const [channel, setChannel] = useState<string>('email')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useRun()

  const ask = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api<Schemas['ForgotPasswordOut']>('/auth/password/forgot', { method: 'POST', json: { identifier } })
      setChannel(r.channel)
      setStep('reset')
    })
  }
  const reset = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await api('/auth/password/reset', { method: 'POST', json: { identifier, code, new_password: password } })
      setStep('done')
    })
  }

  return (
    <div className="space-y-5">
      <Heading title="Reset your password" sub={step === 'ask' ? 'We’ll send a 6-digit code to your email.' : undefined} />
      {error && <Alert>{error}</Alert>}
      {step === 'ask' && (
        <form onSubmit={ask} className="space-y-4">
          <Field label="Email"><Input type="email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="email" required autoFocus /></Field>
          <Button type="submit" loading={busy} className="w-full">Send code</Button>
        </form>
      )}
      {step === 'reset' && (
        <form onSubmit={reset} className="space-y-4">
          <Alert tone="info">If an account exists for {identifier}, we’ve sent a code by {channel === 'sms' ? 'SMS' : 'email'}. It expires in 15 minutes.</Alert>
          <Field label="6-digit code"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus className="tracking-[0.4em]" /></Field>
          <Field label="New password" hint="At least 8 characters. You’ll be signed out everywhere else."><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></Field>
          <Button type="submit" loading={busy} className="w-full" disabled={code.length !== 6}>Set new password</Button>
          <button type="button" onClick={() => setStep('ask')} className="w-full text-[13px] font-semibold text-muted hover:text-ink">Send a new code</button>
        </form>
      )}
      {step === 'done' && <Alert tone="info">Password updated. Sign in with your new password.</Alert>}
      <button type="button" onClick={onBack} className="text-[13px] font-semibold text-ink underline">← Back to sign in</button>
    </div>
  )
}

// ── Physiotherapist / clinic team ───────────────────────────────────────────

type Role = 'doctor' | 'staff'

function RoleTabs({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  const tabs: { value: Role; title: string; sub: string }[] = [
    { value: 'doctor', title: 'Doctor-Admin', sub: 'Owner · full access' },
    { value: 'staff', title: 'Staff', sub: 'No billing / analytics' },
  ]
  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold text-ink-2">Sign in as</p>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1 ring-1 ring-line" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cx('rounded-md px-3 py-2.5 text-center transition', value === t.value ? 'bg-white shadow-[0_1px_3px_rgb(0_0_0/0.08)]' : 'hover:bg-white/60')}
          >
            <span className={cx('block text-[15px] font-semibold', value === t.value ? 'text-brand' : 'text-ink-2')}>{t.title}</span>
            <span className="block text-[12px] text-muted">{t.sub}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function PhysioAuth({ onDone, initialMode }: { onDone: (me: Me) => void; next: string | null; initialMode: 'signin' | 'register' }) {
  const [role, setRole] = useState<Role>('doctor')
  const [mode, setMode] = useState<'signin' | 'register' | 'forgot'>(initialMode)
  if (mode === 'forgot') return <ForgotPassword onBack={() => setMode('signin')} />
  if (mode === 'register') return <PhysioRegister onDone={onDone} onSignIn={() => setMode('signin')} />
  return (
    <div className="space-y-5">
      <Heading title="Practice console" sub="Sign in to run your clinic." />
      <RoleTabs value={role} onChange={setRole} />
      {role === 'doctor' ? (
        <DoctorSignIn onDone={onDone} onForgot={() => setMode('forgot')} onRegister={() => setMode('register')} />
      ) : (
        <StaffSignIn onDone={onDone} onForgot={() => setMode('forgot')} />
      )}
    </div>
  )
}

/** Practice-console password sign-in by email (+ authenticator code when 2FA is on). Patient accounts are refused. */
function PasswordSignIn({ onDone, onForgot }: { onDone: (me: Me) => void; onForgot: () => void }) {
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const { busy, error, run } = useRun()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(
      async () => onDone(await login(identifier, password, 'clinic', needsTotp ? totp : undefined)),
      (e) => {
        if (e.detail !== 'totp_required') return false
        setNeedsTotp(true)
        return true
      },
    )
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label="Email"><Input type="email" autoComplete="email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></Field>
      <Field label="Password"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
      <div className="-mt-2 text-right">
        <button type="button" onClick={onForgot} className="text-[13px] font-semibold text-muted hover:text-ink">Forgot password?</button>
      </div>
      {needsTotp && (
        <Field label="Two-factor authentication code" hint="Enter the 6-digit code from your authenticator app.">
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} required autoFocus className="tracking-[0.4em]" />
        </Field>
      )}
      <Button type="submit" loading={busy} className="w-full">Sign in</Button>
    </form>
  )
}

function DoctorSignIn({ onDone, onForgot, onRegister }: { onDone: (me: Me) => void; onForgot: () => void; onRegister: () => void }) {
  return (
    <div className="space-y-5">
      <PasswordSignIn onDone={onDone} onForgot={onForgot} />
      <p className="text-center text-[13px] text-muted">
        New to Physionexs? <button type="button" onClick={onRegister} className="font-semibold text-ink underline">Register your clinic</button>
      </p>
    </div>
  )
}

/** Clinic team members. They can't register — the Doctor-Admin adds them under Staff management with a temporary password. */
function StaffSignIn({ onDone, onForgot }: { onDone: (me: Me) => void; onForgot: () => void }) {
  return (
    <div className="space-y-5">
      <PasswordSignIn onDone={onDone} onForgot={onForgot} />
      <p className="text-center text-[12.5px] text-muted">Use the email and temporary password your clinic’s Doctor-Admin gave you. Not added yet? Ask them to add you under Staff management.</p>
    </div>
  )
}

const PLANS = [
  { value: 'monthly', label: 'Monthly', price: '₹500', unit: '/mo', note: null, fine: 'No fee on app bookings' },
  { value: 'yearly', label: 'Yearly', price: '₹5,000', unit: '/yr', note: '2 mo free', fine: 'No fee on app bookings' },
  { value: 'commission', label: 'Pay per booking', price: '3%', unit: '/booking', note: 'No subscription', fine: 'Of each app booking' },
] as const

function PhysioRegister({ onDone, onSignIn }: { onDone: (me: Me) => void; onSignIn: () => void }) {
  const { registerPhysio } = useAuth()
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', registration_no: '', council: '', qualification: '', clinic_name: '', city: '' })
  const [plan, setPlan] = useState<'monthly' | 'yearly' | 'commission'>('monthly')
  const { busy, error, run } = useRun()
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => onDone(await registerPhysio({ ...form, plan })))
  }
  const chosen = PLANS.find((p) => p.value === plan)!
  return (
    <div className="space-y-5">
      <Heading title="Register your clinic" sub="You’ll be the clinic’s Doctor-Admin. Add your staff after signing in." />
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Full name" required><Input value={form.full_name} onChange={set('full_name')} placeholder="Dr. Ananya Sharma" required minLength={2} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" required><Input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></Field>
          <Field label="Mobile" required><Input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" required /></Field>
        </div>
        <Field label="Physiotherapy Council Registration No." required hint="We verify this with your national / state council before your profile goes live.">
          <Input value={form.registration_no} onChange={set('registration_no')} required minLength={3} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Council" required><Input value={form.council} onChange={set('council')} placeholder="IAP, HCPC, APTA…" required minLength={2} /></Field>
          <Field label="Qualification" required><Input value={form.qualification} onChange={set('qualification')} placeholder="MPT (Ortho)" required minLength={2} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Clinic name" required><Input value={form.clinic_name} onChange={set('clinic_name')} required minLength={2} /></Field>
          <Field label="City" required><Input value={form.city} onChange={set('city')} required minLength={2} /></Field>
        </div>
        <div>
          <span className="eyebrow mb-1.5 block">Choose your plan *</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {PLANS.map((p) => (
              <button key={p.value} type="button" onClick={() => setPlan(p.value)} aria-pressed={plan === p.value}
                className={cx('rounded-md border p-3 text-left transition', plan === p.value ? 'border-ink bg-surface-2' : 'border-line-strong hover:bg-surface-2')}>
                <span className="block text-[12.5px] font-semibold text-ink-2">{p.label}</span>
                <span className="mt-1 block text-[19px] font-bold">{p.price}<span className="text-[11.5px] font-semibold text-muted">{p.unit}</span></span>
                {p.note && <span className="mt-1 inline-block rounded-full bg-leaf-tint px-2 py-0.5 text-[10.5px] text-leaf-dark">{p.note}</span>}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {plan === 'commission'
              ? 'No monthly or yearly fee. Physionexs keeps 3% of each booking patients pay through the app; the rest is settled to your account.'
              : `${chosen.label} subscription with a 14-day free trial. No transaction fee on bookings patients pay through the app.`}
          </p>
        </div>
        <Field label="Password" required hint="At least 8 characters.">
          <PasswordInput value={form.password} onChange={set('password')} autoComplete="new-password" minLength={8} required />
        </Field>
        <Button type="submit" loading={busy} className="w-full">{plan === 'commission' ? 'Create clinic account' : 'Start free trial'}</Button>
      </form>
      <p className="text-center text-[13px] text-muted">
        Already registered? <button type="button" onClick={onSignIn} className="font-semibold text-ink underline">Sign in</button>
      </p>
    </div>
  )
}
