import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { homePathFor, useAuth } from '@/auth/AuthProvider'
import { Alert, Button, Card, cx, Field, Input, Logo, Segmented } from '@/components/ui'
import { ApiError, type Me } from '@/lib/api'

type As = 'patient' | 'physio'

export default function SignIn() {
  const [params] = useSearchParams()
  const [as, setAs] = useState<As>(params.get('as') === 'physio' ? 'physio' : 'patient')
  const navigate = useNavigate()

  const done = (me: Me) => {
    const next = params.get('next')
    navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : homePathFor(me), { replace: true })
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <Link to="/" className="mb-8 flex justify-center">
          <Logo className="h-10" />
        </Link>
        <Card className="p-6 sm:p-8">
          <p className="eyebrow mb-2">Sign in as</p>
          <Segmented
            value={as}
            onChange={setAs}
            options={[
              { value: 'patient', label: 'Patient' },
              { value: 'physio', label: 'Physiotherapist' },
            ]}
          />
          <div className="mt-6">{as === 'patient' ? <PatientAuth onDone={done} /> : <PhysioAuth onDone={done} />}</div>
        </Card>
        <p className="mt-6 text-center text-[12.5px] text-muted">
          Clinic staff sign in with the mobile number registered by your clinic.
        </p>
      </div>
    </div>
  )
}

// ── Patient: phone OTP ─────────────────────────────────────────────────────

function PatientAuth({ onDone }: { onDone: (me: Me) => void }) {
  const { requestOtp, verifyOtp } = useAuth()
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [needsName, setNeedsName] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      if (e instanceof ApiError && e.detail === 'full_name_required') setNeedsName(true)
      else setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (step === 'phone') {
      void run(async () => {
        await requestOtp(phone)
        setStep('code')
      })
    } else {
      void run(async () => onDone(await verifyOtp(phone, code, needsName ? fullName : undefined)))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">
          {needsName ? 'Create your account' : 'Welcome to Physionexs'}
        </h1>
        <p className="mt-1 text-[13.5px] text-muted">
          {step === 'phone' ? 'We’ll text you a one-time code.' : `Enter the code sent to ${phone}.`}
        </p>
      </div>
      {error && <Alert>{error}</Alert>}

      {step === 'phone' ? (
        <Field label="Mobile number">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98123 45678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            autoFocus
          />
        </Field>
      ) : (
        <>
          <Field label="6-digit code">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4,8}"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
              className="tracking-[0.4em]"
            />
          </Field>
          {needsName && (
            <Field label="Full name" hint="New to Physionexs — tell us what to call you.">
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} autoFocus />
            </Field>
          )}
        </>
      )}

      <Button type="submit" loading={busy} className="w-full">
        {step === 'phone' ? 'Send code' : needsName ? 'Create account' : 'Verify & continue'}
      </Button>
      {step === 'code' && (
        <button
          type="button"
          className="w-full text-[13px] font-semibold text-brand"
          onClick={() => {
            setStep('phone')
            setCode('')
            setNeedsName(false)
          }}
        >
          Use a different number
        </button>
      )}
    </form>
  )
}

// ── Physiotherapist: password (+ TOTP) or register ─────────────────────────

function PhysioAuth({ onDone }: { onDone: (me: Me) => void }) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  return mode === 'signin' ? (
    <PhysioSignIn onDone={onDone} onRegister={() => setMode('register')} />
  ) : (
    <PhysioRegister onDone={onDone} onSignIn={() => setMode('signin')} />
  )
}

function PhysioSignIn({ onDone, onRegister }: { onDone: (me: Me) => void; onRegister: () => void }) {
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone(await login(identifier, password, needsTotp ? totp : undefined))
    } catch (err) {
      if (err instanceof ApiError && err.detail === 'totp_required') setNeedsTotp(true)
      else setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">Practice console</h1>
        <p className="mt-1 text-[13.5px] text-muted">Sign in to run your clinic.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <Field label="Email or phone">
        <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
      </Field>
      <Field label="Password">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      {needsTotp && (
        <Field label="Two-factor authentication code" hint="Enter the 6-digit code from your authenticator app.">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
            className="tracking-[0.4em]"
          />
        </Field>
      )}
      <Button type="submit" loading={busy} className="w-full">
        Sign in
      </Button>
      <p className="text-center text-[13px] text-muted">
        New to Physionexs?{' '}
        <button type="button" onClick={onRegister} className="font-bold text-brand">
          Register your clinic
        </button>
      </p>
    </form>
  )
}

const PLANS = [
  { value: 'monthly', label: 'Monthly', price: '₹500', unit: '/mo', note: null },
  { value: 'yearly', label: 'Yearly', price: '₹5,000', unit: '/yr', note: '2 mo free' },
] as const

function PhysioRegister({ onDone, onSignIn }: { onDone: (me: Me) => void; onSignIn: () => void }) {
  const { registerPhysio } = useAuth()
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    registration_no: '',
    council: '',
    qualification: '',
    clinic_name: '',
    city: '',
  })
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('monthly')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone(await registerPhysio({ ...form, council: form.council || null, qualification: form.qualification || null, plan }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">Register your clinic</h1>
        <p className="mt-1 text-[13.5px] text-muted">14-day free trial, cancel anytime.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <Field label="Full name">
        <Input value={form.full_name} onChange={set('full_name')} placeholder="Dr. Ananya Sharma" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email">
          <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </Field>
        <Field label="Mobile">
          <Input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" required />
        </Field>
      </div>
      <Field
        label="Physiotherapy Council Registration No."
        hint="We verify this with your national / state council before your profile goes live."
      >
        <Input value={form.registration_no} onChange={set('registration_no')} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Council">
          <Input value={form.council} onChange={set('council')} placeholder="IAP, HCPC, APTA…" />
        </Field>
        <Field label="Qualification">
          <Input value={form.qualification} onChange={set('qualification')} placeholder="MPT (Ortho)" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Clinic name">
          <Input value={form.clinic_name} onChange={set('clinic_name')} required />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={set('city')} required />
        </Field>
      </div>

      <div>
        <span className="eyebrow mb-1.5 block">Choose your PMS plan</span>
        <div className="grid grid-cols-2 gap-3">
          {PLANS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPlan(p.value)}
              aria-pressed={plan === p.value}
              className={cx(
                'rounded-md border p-3 text-left transition',
                plan === p.value ? 'border-ink bg-surface-2' : 'border-line-strong hover:bg-surface-2',
              )}
            >
              <span className="flex items-center justify-between text-[12.5px] font-semibold text-ink-2">
                {p.label}
                {p.note && <span className="rounded-full bg-leaf-tint px-2 py-0.5 text-[10.5px] text-leaf-dark">{p.note}</span>}
              </span>
              <span className="mt-1 block text-[20px] font-bold">
                {p.price}
                <span className="text-[12px] font-semibold text-muted">{p.unit}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          A platform fee of 10% applies to bookings made through the Physionexs app — the rest is settled to your account.
        </p>
      </div>

      <Field label="Password" hint="At least 8 characters.">
        <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={8} required />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        Start free trial
      </Button>
      <p className="text-center text-[13px] text-muted">
        Already registered?{' '}
        <button type="button" onClick={onSignIn} className="font-bold text-brand">
          Sign in
        </button>
      </p>
    </form>
  )
}
