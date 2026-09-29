import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { useClinic } from '@/auth/useClinic'
import { ClinicMark, PoweredBy } from '@/components/clinical'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Button, Field, Input, Loader, Select } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { PAYMENTS_SOON, payWithRazorpay, SUBSCRIPTION_PAYMENTS_LIVE } from '@/lib/razorpay'
import { dayLabel, rupees } from '@shared/format'

type Profile = Schemas['ClinicProfileOut']
type Branch = Schemas['BranchOut']

export default function ClinicProfile() {
  const { clinicId } = useClinic()
  const profile = useQuery({ queryKey: ['clinic-profile'], queryFn: () => api<Profile>('/clinic/profile', { clinicId }) })
  if (profile.isLoading) return <Loader />
  if (!profile.data) return <Alert>Couldn't load the clinic profile.</Alert>
  return (
    <div className="max-w-5xl">
      <PageHeader title="Clinic profile" subtitle="Your logo and details appear on every invoice and prescription." />
      <ProfileForm initial={profile.data} clinicId={clinicId} />
      <Branches clinicId={clinicId} />
      <SubscriptionPanel clinicId={clinicId} />
    </div>
  )
}

/** Downscale an uploaded logo to ≤ 480px on its long side and encode as PNG/WebP, keeping it well under the 300 KB limit. */
async function toDataUrl(file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, 480 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const png = canvas.toDataURL('image/png')
  return png.length < 300_000 ? png : canvas.toDataURL('image/webp', 0.9)
}

function ProfileForm({ initial, clinicId }: { initial: Profile; clinicId: string }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState({ name: initial.name, phone: initial.phone ?? '', email: initial.email ?? '', address: initial.address ?? '', gstin: initial.gstin ?? '' })
  const [logo, setLogo] = useState<string | null>(initial.logo_url ?? null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api<Profile>('/clinic/profile', { method: 'PUT', clinicId, json: { name: f.name, phone: f.phone || null, email: f.email || null, address: f.address || null, gstin: f.gstin || null, logo_url: logo } }),
    onSuccess: (p) => qc.setQueryData(['clinic-profile'], p),
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <section>
          <h2 className="eyebrow mb-3">Clinic logo</h2>
          <div className="flex items-center gap-4">
            <div className="grid h-20 w-40 shrink-0 place-items-center overflow-hidden border border-line bg-white p-2">
              {logo ? <img src={logo} alt="Clinic logo" className="h-full w-full object-contain" /> : <ClinicMark name={f.name} size="sm" />}
            </div>
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setLogoError(null)
                try {
                  setLogo(await toDataUrl(file))
                } catch {
                  setLogoError('Could not read that image.')
                }
              }} />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>Upload logo</Button>
                {logo && <Button type="button" variant="ghost" onClick={() => setLogo(null)}>Remove</Button>}
              </div>
              <p className="text-[12.5px] text-muted">{logo ? 'PNG or JPG, transparent background recommended.' : 'No logo yet: your initials are shown on invoices and prescriptions.'}</p>
              {logoError && <p className="text-[12.5px] text-danger">{logoError}</p>}
            </div>
          </div>
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Clinic name"><Input value={f.name} onChange={set('name')} required minLength={2} /></Field></div>
          <Field label="Phone number"><Input type="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
          <div className="sm:col-span-2"><Field label="Clinic address"><Input value={f.address} onChange={set('address')} /></Field></div>
          <Field label="GSTIN" hint="15 characters, e.g. 27ABCDE1234F1Z5"><Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} /></Field>
        </section>
        {save.error && <Alert>{(save.error as Error).message}</Alert>}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={save.isPending}>Save changes</Button>
          {save.isSuccess && <span className="text-[13px] text-leaf-dark">Saved — applies to new documents</span>}
        </div>
      </form>

      <aside>
        <h2 className="eyebrow mb-3">Letterhead preview</h2>
        <div className="border border-line bg-white p-5 text-[12.5px]">
          <div className="flex items-start justify-between gap-3 border-b-2 border-ink pb-3">
            <div>
              <ClinicMark name={f.name} logoUrl={logo} size="sm" />
              <p className="text-[14px] font-bold">{f.name}</p>
              <p className="text-muted">Physiotherapy &amp; Rehabilitation</p>
            </div>
            <div className="text-right text-muted">
              <p>{f.phone}</p>
              <p>{f.email}</p>
            </div>
          </div>
          <p className="mt-3 text-muted">{f.address || 'Clinic address'}</p>
          {f.gstin && <p className="text-muted">GSTIN {f.gstin}</p>}
          <div className="mt-4 flex justify-end border-t border-line pt-3"><PoweredBy /></div>
        </div>
      </aside>
    </div>
  )
}

const emptyBranch = { name: '', area: '', city: '', address: '', hours: 'Mon–Sat · 9 AM–7 PM', therapy_rooms: 1 }

function Branches({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['branches', 'all'], queryFn: () => api<Branch[]>('/clinic/branches', { clinicId, query: { include_inactive: true } }) })
  const [editing, setEditing] = useState<Branch | 'new' | null>(null)
  const refresh = () => {
    setEditing(null)
    void qc.invalidateQueries({ queryKey: ['branches'] })
  }
  return (
    <section className="mt-10 border-t border-line pt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="eyebrow">Branches</h2>
          <p className="mt-1 text-[13px] text-muted">One clinic, multiple locations. Switch between them from the dashboard.</p>
        </div>
        {!editing && <Button variant="secondary" onClick={() => setEditing('new')}>Add branch</Button>}
      </div>
      {editing && <BranchForm key={editing === 'new' ? 'new' : editing.id} branch={editing === 'new' ? null : editing} clinicId={clinicId} onDone={refresh} onCancel={() => setEditing(null)} />}
      <ul className="divide-y divide-line border-y border-line">
        {list.data?.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-4 py-4 text-[14px]">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{b.name} <span className="eyebrow ml-2">{b.is_active ? 'Active' : 'Closed'}</span></p>
              <p className="text-[13px] text-muted">{[b.area, b.city].filter(Boolean).join(', ')}{b.hours ? ` · ${b.hours}` : ''}</p>
              <p className="text-[13px] text-muted">{[b.lead_name ? `Lead: ${b.lead_name}` : null, `${b.staff_count} staff`, `${b.therapy_rooms} therapy room${b.therapy_rooms === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
            </div>
            <button className="eyebrow !text-ink hover:underline" onClick={() => setEditing(b)}>Configure</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function BranchForm({ branch, clinicId, onDone, onCancel }: { branch: Branch | null; clinicId: string; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState(branch ? { name: branch.name, area: branch.area ?? '', city: branch.city, address: branch.address ?? '', hours: branch.hours ?? '', therapy_rooms: branch.therapy_rooms ?? 1 } : emptyBranch)
  const [active, setActive] = useState(branch?.is_active ?? true)
  const save = useMutation({
    mutationFn: () => {
      const json = { ...f, area: f.area || null, address: f.address || null, hours: f.hours || null, is_active: active, lead_user_id: branch?.lead_user_id ?? null, latitude: branch?.latitude ?? null, longitude: branch?.longitude ?? null }
      return branch ? api(`/clinic/branches/${branch.id}`, { method: 'PUT', clinicId, json }) : api('/clinic/branches', { method: 'POST', clinicId, json })
    },
    onSuccess: onDone,
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'therapy_rooms' ? Number(e.target.value) || 1 : e.target.value })
  return (
    <form className="mb-4 grid gap-3 border border-line p-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <Field label="Branch name"><Input value={f.name} onChange={set('name')} required minLength={2} /></Field>
      <Field label="Area"><Input value={f.area} onChange={set('area')} /></Field>
      <Field label="City"><Input value={f.city} onChange={set('city')} required /></Field>
      <div className="sm:col-span-2"><Field label="Address"><Input value={f.address} onChange={set('address')} /></Field></div>
      <Field label="Therapy rooms"><Input type="number" min={1} value={f.therapy_rooms} onChange={set('therapy_rooms')} /></Field>
      <div className="sm:col-span-2"><Field label="Opening hours (shown to patients)"><Input value={f.hours} onChange={set('hours')} /></Field></div>
      {branch && (
        <Field label="Status">
          <Select value={active ? 'active' : 'closed'} onChange={(e) => setActive(e.target.value === 'active')}><option value="active">Active</option><option value="closed">Closed</option></Select>
        </Field>
      )}
      {save.error && <div className="sm:col-span-3"><Alert>{(save.error as Error).message}</Alert></div>}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={save.isPending}>{branch ? 'Save branch' : 'Add branch'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function SubscriptionPanel({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient()
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => api<Schemas['SubscriptionOut']>('/clinic/subscription', { clinicId }) })
  const [plan, setPlan] = useState<'monthly' | 'yearly' | 'commission' | null>(null)
  const refresh = (s: Schemas['SubscriptionOut'] | null) => {
    if (s) qc.setQueryData(['subscription'], s)
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
    void qc.invalidateQueries({ queryKey: ['clinic-profile'] })
    setPlan(null)
  }
  const pay = useMutation({
    mutationFn: async (target: 'monthly' | 'yearly') => {
      const checkout = await api<Schemas['RazorpayCheckout']>('/clinic/subscription/checkout', { method: 'POST', clinicId, json: { plan: target } })
      const result = await payWithRazorpay(checkout)
      return result ? api<Schemas['SubscriptionOut']>('/clinic/subscription/verify', { method: 'POST', clinicId, json: result }) : null
    },
    onSuccess: refresh,
  })
  const toCommission = useMutation({
    mutationFn: () => api<Schemas['SubscriptionOut']>('/clinic/subscription/commission', { method: 'POST', clinicId }),
    onSuccess: refresh,
  })
  const s = sub.data
  if (!s) return null
  const chosen = plan ?? s.plan
  const onCommission = s.plan === 'commission'
  const status = onCommission ? 'Active · pay per booking' : { trial: 'Free trial', active: 'Active', overdue: 'Overdue', cancelled: 'Cancelled' }[s.status]
  const cards = [
    { value: 'monthly' as const, label: 'Monthly', price: s.plan === 'monthly' ? rupees(s.price_paise) : '₹500', unit: '/mo', fine: 'No fee on app bookings' },
    { value: 'yearly' as const, label: 'Yearly · 2 months free', price: s.plan === 'yearly' ? rupees(s.price_paise) : '₹5,000', unit: '/yr', fine: 'No fee on app bookings' },
    { value: 'commission' as const, label: 'Pay per booking', price: '3%', unit: '/booking', fine: 'No subscription' },
  ]
  const busy = pay.isPending || toCommission.isPending
  const error = (pay.error ?? toCommission.error) as Error | null
  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="eyebrow mb-1">Plan</h2>
      <p className="mb-4 text-[13px] text-muted">Monthly and yearly plans have no fee on app bookings. Pay per booking has no subscription — Physionexs keeps 3% of each booking patients pay through the app.</p>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_1.2fr]">
        {cards.map((c) => (
          <button key={c.value} onClick={() => setPlan(c.value)} className={`border p-4 text-left ${chosen === c.value ? 'border-ink' : 'border-line-strong hover:border-ink'}`}>
            <span className="eyebrow">{c.label}{s.plan === c.value ? ' · current' : ''}</span>
            <span className="mt-1 block text-[22px] font-bold">{c.price}<span className="text-[13px] font-medium text-muted">{c.unit}</span></span>
            <span className="text-[12.5px] text-muted">{c.fine}</span>
          </button>
        ))}
        <div className="border border-line p-4 text-[14px]">
          <p><span className="text-muted">Status: </span><span className="font-semibold">{status}</span></p>
          {!onCommission && (
            <p className="mt-1"><span className="text-muted">{s.status === 'trial' ? 'Trial ends' : 'Next payment due'}: </span>{(s.status === 'trial' ? s.trial_ends_at : s.current_period_end) ? dayLabel((s.status === 'trial' ? s.trial_ends_at : s.current_period_end)!) : '—'}</p>
          )}
          {error && <p className="mt-2 text-[13px] text-danger">{error.message}</p>}
          {(pay.data || toCommission.data) && <p className="mt-2 text-[13px] text-leaf-dark">Plan updated.</p>}
          {chosen === 'commission' ? (
            onCommission ? <p className="mt-3 text-[13px] text-muted">You’re on pay per booking. Pick Monthly or Yearly to switch.</p> : (
              <Button className="mt-3 w-full" loading={busy} onClick={() => window.confirm('Switch to pay per booking? Your subscription stops and 3% applies to each app booking from now on.') && toCommission.mutate()}>
                Switch to pay per booking
              </Button>
            )
          ) : (
            <>
              <Button className="mt-3 w-full" loading={busy} disabled={!SUBSCRIPTION_PAYMENTS_LIVE} onClick={() => pay.mutate(chosen)}>
                {s.plan === chosen ? `Pay ${cards.find((c) => c.value === chosen)!.price}` : `Switch & pay ${cards.find((c) => c.value === chosen)!.price}`}
              </Button>
              {!SUBSCRIPTION_PAYMENTS_LIVE && <p className="mt-2 text-[12.5px] text-muted">{PAYMENTS_SOON}</p>}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
