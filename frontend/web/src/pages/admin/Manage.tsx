import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'

import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Button, cx, Field, Input, Loader, Select } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel, time } from '@shared/format'

// ── Audit log ───────────────────────────────────────────────────────────────

const ENTITIES = ['', 'user', 'clinic', 'physio_profile', 'appointment', 'consultation', 'care_plan', 'prescription', 'invoice', 'subscription', 'exercise', 'review', 'setting', 'clinic_member']

export function AuditLogPage() {
  const [q, setQ] = useState('')
  const [entity, setEntity] = useState('')
  const [page, setPage] = useState(0)
  const search = useDeferredValue(q.trim())
  const list = useQuery({
    queryKey: ['audit', search, entity, page],
    queryFn: () => api<Schemas['AuditPage']>('/admin/audit', { query: { q: search, entity, limit: 50, offset: page * 50 } }),
    placeholderData: (p) => p,
  })
  const d = list.data
  return (
    <div className="max-w-6xl">
      <PageHeader title="Audit log" subtitle="Every create, update and delete across the platform." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search summary, record id or person…" className="!w-80" aria-label="Search audit log" />
        <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0) }} className="!w-52" aria-label="Record type">
          {ENTITIES.map((x) => <option key={x} value={x}>{x ? x.replace('_', ' ') : 'All record types'}</option>)}
        </Select>
      </div>
      {!d ? <Loader /> : (
        <>
          <ul className="divide-y divide-line border-y border-line text-[13.5px]">
            {d.rows.map((r) => (
              <li key={r.id} className="grid gap-1 py-3 sm:grid-cols-[150px_1fr_220px]">
                <span className="tabular-nums text-muted">{dayLabel(r.created_at)} · {time(r.created_at)}</span>
                <span><span className="font-semibold">{r.action}</span> · {r.entity.replace('_', ' ')}{r.summary ? ` · ${r.summary}` : ''}{r.clinic && <span className="text-muted"> · {r.clinic}</span>}</span>
                <span className="text-muted sm:text-right">by {r.actor ?? 'System'}{r.ip ? ` · ${r.ip}` : ''}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between text-[13px] text-muted">
            <span>{d.total} entries</span>
            <span className="flex gap-2">
              <Button variant="secondary" className="!h-9" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="secondary" className="!h-9" disabled={(page + 1) * 50 >= d.total} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Settings ────────────────────────────────────────────────────────────────

type Setting = Schemas['SettingOut']

export function SettingsPage() {
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<Setting[]>('/admin/settings') })
  if (!q.data) return <Loader />
  const by = Object.fromEntries(q.data.map((s) => [s.key, s]))
  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader title="Platform settings" subtitle="Global configuration for the patient app and the practice console. Every change is audit-logged." />
      <RewardsForm s={by.rewards} />
      <SupportForm s={by.support} />
      <PricingForm s={by.pms_pricing} />
      <FeeForm s={by.platform_fee} />
      <section className="border-t border-line pt-6 text-[14px]">
        <h2 className="eyebrow mb-2">Appointment reminders</h2>
        <p className="text-muted">Patients get reminders 24 hours and 2 hours before each appointment (hourly scheduled job).</p>
      </section>
    </div>
  )
}

function useSave(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (value: unknown) => api<Setting>(`/admin/settings/${key}`, { method: 'PUT', json: value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-settings'] })
      void qc.invalidateQueries({ queryKey: ['support'] })
    },
  })
}

function Section({ title, s, save, children, onSubmit }: { title: string; s?: Setting; save: ReturnType<typeof useSave>; children: React.ReactNode; onSubmit: () => void }) {
  return (
    <form className="border-t border-line pt-6" onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="eyebrow">{title}</h2>
        {s?.updated_at && <span className="text-[12px] text-muted">Updated {dayLabel(s.updated_at)}{s.updated_by ? ` by ${s.updated_by}` : ''}</span>}
      </div>
      {children}
      {save.error && <div className="mt-3"><Alert>{(save.error as Error).message}</Alert></div>}
      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" loading={save.isPending}>Save</Button>
        {save.isSuccess && <span className="text-[13px] text-leaf-dark">Saved</span>}
      </div>
    </form>
  )
}

function RewardsForm({ s }: { s?: Setting }) {
  const v = (s?.value ?? {}) as { tiers?: { days: number; points: number }[]; paise_per_point?: number }
  const [tiers, setTiers] = useState(v.tiers ?? [])
  const [ppp, setPpp] = useState(String((v.paise_per_point ?? 100) / 100))
  const save = useSave('rewards')
  return (
    <Section title="Rewards & points" s={s} save={save} onSubmit={() => save.mutate({ tiers, paise_per_point: Math.round(Number(ppp) * 100) })}>
      <div className="space-y-2">
        {tiers.map((t, i) => (
          <div key={i} className="flex items-center gap-2 text-[14px]">
            <Input type="number" min={1} value={t.days} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)))} className="!h-10 !w-24" aria-label="Streak days" />
            <span className="text-muted">-day streak →</span>
            <Input type="number" min={0} value={t.points} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))} className="!h-10 !w-28" aria-label="Points" />
            <span className="text-muted">points</span>
            <button type="button" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} className="px-2 text-muted hover:text-danger" aria-label="Remove tier">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setTiers([...tiers, { days: 28, points: 200 }])} className="eyebrow !text-ink hover:underline">+ Add tier</button>
      </div>
      <div className="mt-4 max-w-xs"><Field label="Point value (₹ per point)"><Input type="number" min={0.01} step={0.01} value={ppp} onChange={(e) => setPpp(e.target.value)} /></Field></div>
    </Section>
  )
}

function SupportForm({ s }: { s?: Setting }) {
  const v = (s?.value ?? {}) as Record<string, string>
  const [f, setF] = useState({ email: v.email ?? '', phone: v.phone ?? v.helpline ?? '', address: v.address ?? '', hours: v.hours ?? '' })
  const save = useSave('support')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Section title="Support & contact" s={s} save={save} onSubmit={() => save.mutate(f)}>
      <p className="mb-3 text-[13px] text-muted">Shown in the website footer and the patient app's “Need help?” card.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Helpline"><Input value={f.phone} onChange={set('phone')} required /></Field>
        <div className="sm:col-span-2"><Field label="Office address"><Input value={f.address} onChange={set('address')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Support hours"><Input value={f.hours} onChange={set('hours')} /></Field></div>
      </div>
    </Section>
  )
}

function PricingForm({ s }: { s?: Setting }) {
  const v = (s?.value ?? {}) as { monthly_paise?: number; yearly_paise?: number; trial_days?: number; commission_bps?: number }
  const [f, setF] = useState({ monthly: String((v.monthly_paise ?? 50_000) / 100), yearly: String((v.yearly_paise ?? 500_000) / 100), trial: String(v.trial_days ?? 14), commission: String((v.commission_bps ?? 300) / 100) })
  const save = useSave('pms_pricing')
  return (
    <Section title="Plans & pricing (new clinics)" s={s} save={save} onSubmit={() => save.mutate({ monthly_paise: Math.round(Number(f.monthly) * 100), yearly_paise: Math.round(Number(f.yearly) * 100), trial_days: Number(f.trial), commission_bps: Math.round(Number(f.commission) * 100) })}>
      <p className="mb-3 text-[13px] text-muted">Monthly and yearly plans have no fee on app bookings; pay per booking has no subscription. Existing clinics keep their own terms — change those under Subscriptions.</p>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Monthly (₹)"><Input type="number" min={0} value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></Field>
        <Field label="Yearly (₹)"><Input type="number" min={0} value={f.yearly} onChange={(e) => setF({ ...f, yearly: e.target.value })} /></Field>
        <Field label="Free trial (days)"><Input type="number" min={0} max={180} value={f.trial} onChange={(e) => setF({ ...f, trial: e.target.value })} /></Field>
        <Field label="Pay per booking (%)"><Input type="number" min={0} max={50} step={0.5} value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value })} /></Field>
      </div>
    </Section>
  )
}

function FeeForm({ s }: { s?: Setting }) {
  const v = (s?.value ?? {}) as { default_bps?: number; allowed_bps?: number[] }
  const [allowed, setAllowed] = useState((v.allowed_bps ?? [1000, 1500]).map((b) => b / 100).join(', '))
  const [def, setDef] = useState(String((v.default_bps ?? 1000) / 100))
  const save = useSave('platform_fee')
  return (
    <Section
      title="Allowed per-clinic booking fees"
      s={s}
      save={save}
      onSubmit={() => save.mutate({ default_bps: Math.round(Number(def) * 100), allowed_bps: allowed.split(',').map((x) => Math.round(Number(x.trim()) * 100)).filter((x) => !Number.isNaN(x)) })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Allowed fees (%)" hint="Comma separated, e.g. 10, 15"><Input value={allowed} onChange={(e) => setAllowed(e.target.value)} /></Field>
        <Field label="Default (%)" hint="Subscription plans use 0%."><Input type="number" min={0} step={0.5} value={def} onChange={(e) => setDef(e.target.value)} /></Field>
      </div>
    </Section>
  )
}

// ── Records ─────────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = { deactivate: 'Deactivate', activate: 'Activate', hide: 'Hide', unhide: 'Restore', set_fee: 'Set fee', pilot_on: 'Pilot on', pilot_off: 'Pilot off' }

export function RecordsPage() {
  const qc = useQueryClient()
  const cols = useQuery({ queryKey: ['records'], queryFn: () => api<Schemas['Collection'][]>('/admin/records') })
  const [key, setKey] = useState('patients')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const search = useDeferredValue(q.trim())
  const list = useQuery({
    queryKey: ['records', key, search, page],
    queryFn: () => api<Schemas['RecordsPage']>(`/admin/records/${key}`, { query: { q: search, limit: 50, offset: page * 50 } }),
    placeholderData: (p) => p,
  })
  const act = useMutation({
    mutationFn: ({ id, action, value }: { id: string; action: string; value?: number }) => api<{ summary: string }>(`/admin/records/${key}/${id}/action`, { method: 'POST', json: { action, value } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records'] }),
  })
  const run = (row: Record<string, unknown>, action: string) => {
    if (action === 'set_fee') {
      const pct = window.prompt('New platform fee (%) for this clinic:', String(row.platform_fee ?? '').replace('%', ''))
      if (pct) act.mutate({ id: String(row.id), action, value: Math.round(Number(pct) * 100) })
      return
    }
    const ask = action === 'pilot_on'
      ? `Switch on the recovery-twin pilot for ${row.name}? Its physios get knee tracking, check-ins, flags and camera validation.`
      : action === 'pilot_off'
        ? `Switch off the recovery-twin pilot for ${row.name}? Its patients stop getting check-ins; existing data is kept.`
        : `${ACTION_LABEL[action]} this record?`
    if (window.confirm(ask)) act.mutate({ id: String(row.id), action })
  }
  const d = list.data
  const applicable = (row: Record<string, unknown>, a: string) =>
    (a === 'deactivate' && row.active !== false) || (a === 'activate' && row.active === false) || (a === 'hide' && !row.hidden) || (a === 'unhide' && row.hidden === true) || a === 'set_fee' ||
    (a === 'pilot_on' && row.twin_pilot === false) || (a === 'pilot_off' && row.twin_pilot === true)

  return (
    <div>
      <PageHeader title="Records" subtitle="Browse the platform's data. Changes go through audited actions — financial and clinical records are never edited or deleted here." />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="space-y-0.5">
          {cols.data?.map((c) => (
            <button key={c.key} onClick={() => { setKey(c.key); setPage(0); setQ('') }} className={cx('flex w-full justify-between border-l-2 px-3 py-2 text-left text-[13.5px]', key === c.key ? 'border-ink font-semibold' : 'border-transparent text-muted hover:text-ink')}>
              <span>{c.label}</span><span className="tabular-nums">{c.count}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder={`Search ${d?.label.toLowerCase() ?? ''}…`} className="mb-3 !w-80" aria-label="Search records" />
          {act.error && <div className="mb-3"><Alert>{(act.error as Error).message}</Alert></div>}
          {act.data && <div className="mb-3"><Alert tone="info">{act.data.summary}</Alert></div>}
          {!d ? <Loader /> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead><tr className="border-b border-line">{d.columns.map((c) => <th key={c} className="eyebrow whitespace-nowrap py-2 pr-4 font-semibold">{c.replace('_', ' ')}</th>)}{d.actions.length > 0 && <th />}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.rows.map((row) => (
                      <tr key={String(row.id)} className="align-top">
                        {d.columns.map((c) => <td key={c} className="max-w-[260px] truncate py-2 pr-4" title={String(row[c] ?? '')}>{format(row[c])}</td>)}
                        {d.actions.length > 0 && (
                          <td className="whitespace-nowrap py-2 text-right">
                            {d.actions.filter((a) => applicable(row, a)).map((a) => (
                              <button key={a} onClick={() => run(row, a)} className={cx('eyebrow ml-3 hover:underline', a === 'deactivate' || a === 'hide' ? '!text-danger' : '!text-ink')}>{ACTION_LABEL[a]}</button>
                            ))}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between text-[13px] text-muted">
                <span>{d.total} records</span>
                <span className="flex gap-2">
                  <Button variant="secondary" className="!h-9" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                  <Button variant="secondary" className="!h-9" disabled={(page + 1) * 50 >= d.total} onClick={() => setPage(page + 1)}>Next</Button>
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function format(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return `${dayLabel(v)} ${time(v)}`
  return String(v)
}
