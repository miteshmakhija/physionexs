import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { BarChart } from '@/components/charts'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Avatar, Button, cx, Input, Loader, Select, Stat } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel, rupees, time } from '@shared/format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (iso: string) => {
  const [y, m] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`
}

function Shares({ items, empty }: { items: Schemas['CategoryShare'][]; empty: string }) {
  if (!items.length) return <p className="text-[14px] text-muted">{empty}</p>
  return (
    <ul className="space-y-3">
      {items.map((s) => (
        <li key={s.label} className="text-[14px]">
          <div className="mb-1 flex justify-between gap-3"><span>{s.label}</span><span className="tabular-nums text-muted">{s.count} · {s.pct}%</span></div>
          <div className="h-1.5 bg-line"><div className="h-full rounded-r-[4px] bg-brand" style={{ width: `${s.pct}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

function RevenueSplit({ r }: { r: Schemas['RevenueSplit'] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Stat label="From patient bookings" value={rupees(r.commission_paise)} sub="platform commission" />
      <Stat label="From clinics (PMS)" value={rupees(r.pms_paise)} sub="subscription fees" />
      <Stat label="Platform revenue" value={rupees(r.commission_paise + r.pms_paise)} sub="bookings + subscriptions" />
      <Stat label="Booking value (GMV)" value={rupees(r.gmv_paise)} sub="paid, excluding refunds" />
      <Stat label="Avg. platform fee" value={r.avg_fee_pct == null ? '—' : `${r.avg_fee_pct}%`} sub="of booking value" />
      <Stat label="Owed to clinics" value={rupees(r.payout_paise)} sub="booking value minus fees" />
    </div>
  )
}

export function AdminDashboard() {
  const q = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => api<Schemas['AdminDashboard']>('/admin/dashboard') })
  const pending = useQuery({ queryKey: ['verifications'], queryFn: () => api<Schemas['VerificationItem'][]>('/admin/verifications') })
  const d = q.data
  if (q.error) return <Alert>{(q.error as Error).message === 'totp_setup_required' ? 'Turn on two-factor authentication to use Super Admin.' : (q.error as Error).message}</Alert>
  if (!d) return <Loader />
  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader title="Platform overview" subtitle="Everything across the patient app and the practice console, in one place." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Pending verifications" value={d.pending_verifications} sub={<Link to="/admin/verification" className="underline">Review & approve</Link>} />
        <Stat label="Patients onboarded" value={d.patients} sub={`+${d.patients_this_month} this month`} />
        <Stat label="Physiotherapists" value={d.physios} sub="onboarded" />
        <Stat label="Total bookings" value={d.bookings} sub="all time" />
        <Stat label="Reviews" value={d.reviews} sub={d.rating_avg == null ? 'no ratings yet' : `avg ★ ${d.rating_avg.toFixed(1)}`} />
      </div>
      <section>
        <h2 className="eyebrow mb-3">Revenue split — patients & clinics</h2>
        <RevenueSplit r={d.revenue} />
      </section>
      <div className="grid gap-8 lg:grid-cols-3">
        <section>
          <div className="mb-3 flex items-baseline justify-between"><h2 className="eyebrow">Bookings by speciality</h2><Link to="/admin/analytics" className="eyebrow !text-ink hover:underline">Analytics →</Link></div>
          <Shares items={d.by_speciality} empty="No bookings yet." />
        </section>
        <section>
          <div className="mb-3 flex items-baseline justify-between"><h2 className="eyebrow">Awaiting verification</h2><Link to="/admin/verification" className="eyebrow !text-ink hover:underline">View all →</Link></div>
          {!pending.data?.length ? <p className="text-[14px] text-muted">All caught up.</p> : (
            <ul className="divide-y divide-line border-y border-line">
              {pending.data.slice(0, 5).map((p) => (
                <li key={p.user_id} className="flex items-center gap-3 py-2.5 text-[14px]"><Avatar name={p.full_name} /><span><span className="block font-semibold">{p.full_name}</span><span className="block text-[12.5px] text-muted">{p.registration_no}</span></span></li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <div className="mb-3 flex items-baseline justify-between"><h2 className="eyebrow">Recent activity</h2><Link to="/admin/audit" className="eyebrow !text-ink hover:underline">Audit log →</Link></div>
          <ul className="space-y-2.5 text-[13px]">
            {d.activity.map((a) => (
              <li key={a.id}><span className="font-semibold">{a.action}</span> · {a.entity}{a.summary ? ` · ${a.summary}` : ''}<span className="block text-muted">{a.actor ?? 'System'} · {dayLabel(a.created_at)} {time(a.created_at)}</span></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

export function AdminAnalytics() {
  const [months, setMonths] = useState(6)
  const q = useQuery({ queryKey: ['admin-analytics', months], queryFn: () => api<Schemas['AdminAnalytics']>('/admin/analytics', { query: { months } }), placeholderData: (p) => p })
  const a = q.data
  const plans = (a?.plan_monthly ?? 0) + (a?.plan_yearly ?? 0)
  const chart = (title: string, pick: (m: Schemas['MonthPoint']) => number, fmt: (v: number) => string, color?: string) => (
    <section className="border-t border-line pt-5">
      <h2 className="mb-2 text-[14px] font-semibold">{title}</h2>
      <BarChart
        title={title}
        color={color}
        ticks={(m) => [0, m / 2, m].map((v) => ({ v, label: fmt(v) }))}
        points={a!.months.map((m) => ({ key: m.month, label: monthLabel(m.month), value: pick(m), readout: fmt(pick(m)), detail: monthLabel(m.month) }))}
      />
    </section>
  )
  const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(Math.round(v)))
  const money = (p: number) => (p >= 100_000 ? `₹${compact(p / 100)}` : `₹${Math.round(p / 100)}`)
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Analytics"
        subtitle="Growth, bookings and revenue across the platform"
        actions={<Select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="!w-40" aria-label="Range">{[6, 12, 24].map((m) => <option key={m} value={m}>Last {m} months</option>)}</Select>}
      />
      {!a ? <Loader /> : (
        <div className={cx('space-y-6 transition-opacity', q.isFetching && 'opacity-60')}>
          <div className="grid gap-6 lg:grid-cols-2">
            {chart('Patients onboarded per month', (m) => m.patients, compact)}
            {chart('Physiotherapists onboarded per month', (m) => m.physios, compact, '#2C8E26')}
            {chart('Bookings per month', (m) => m.bookings, compact)}
            {chart('Revenue per month · booking commission', (m) => m.commission_paise, money)}
            {chart('Revenue per month · PMS subscriptions', (m) => m.pms_paise, money, '#2C8E26')}
            <section className="border-t border-line pt-5">
              <h2 className="mb-3 text-[14px] font-semibold">Bookings by speciality</h2>
              <Shares items={a.by_speciality} empty="No bookings yet." />
            </section>
          </div>
          <div className="grid gap-3 border-t border-line pt-6 sm:grid-cols-3">
            <Stat label="PMS plan mix · monthly" value={a.plan_monthly} sub={plans ? `${Math.round((100 * a.plan_monthly) / plans)}% of clinics` : undefined} />
            <Stat label="PMS plan mix · yearly" value={a.plan_yearly} sub={plans ? `${Math.round((100 * a.plan_yearly) / plans)}% of clinics` : undefined} />
            <Stat label="Avg. platform fee" value={a.avg_fee_pct == null ? '—' : `${a.avg_fee_pct}%`} sub="on patient bookings" />
          </div>
        </div>
      )}
    </div>
  )
}

export function AdminSubscriptions() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const q = useQuery({ queryKey: ['admin-subs', status], queryFn: () => api<Schemas['SubscriptionPage']>('/admin/subscriptions', { query: { status } }), placeholderData: (p) => p })
  const [editing, setEditing] = useState<string | null>(null)
  const p = q.data
  return (
    <div className="max-w-6xl">
      <PageHeader title="PMS subscriptions" subtitle="Per-clinic billing for the practice console. Edit a clinic to change its price, plan, status or platform fee." />
      {!p ? <Loader /> : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Monthly recurring revenue" value={rupees(p.kpis.mrr_paise)} sub={`${rupees(p.kpis.arr_paise)} ARR`} />
            <Stat label="Active" value={p.kpis.active} />
            <Stat label="On trial" value={p.kpis.trial} />
            <Stat label="Overdue" value={p.kpis.overdue} sub={p.kpis.cancelled ? `${p.kpis.cancelled} cancelled` : undefined} />
          </div>
          <div className="mb-3 flex gap-4 border-b border-line">
            {['', 'active', 'trial', 'overdue', 'cancelled'].map((s) => (
              <button key={s || 'all'} onClick={() => setStatus(s)} className={cx('-mb-px border-b-2 pb-2 text-[13px] font-semibold capitalize', status === s ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>{s || 'All'}</button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[14px]">
              <thead><tr className="border-b border-line">{['Clinic', 'Plan', 'Price', 'Platform fee', 'Next due', 'Status', ''].map((h) => <th key={h} className="eyebrow py-2.5 font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {p.rows.map((r) => editing === r.clinic_id ? (
                  <EditRow key={r.clinic_id} row={r} onDone={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['admin-subs'] }) }} />
                ) : (
                  <tr key={r.clinic_id}>
                    <td className="py-3"><span className="block font-semibold">{r.clinic_name}</span><span className="block text-[12.5px] text-muted">{r.owner_name}{r.owner_email ? ` · ${r.owner_email}` : ''}</span></td>
                    <td className="capitalize">{r.plan}</td>
                    <td className="tabular-nums">{rupees(r.price_paise)}</td>
                    <td className="tabular-nums">{r.platform_fee_bps / 100}%</td>
                    <td className="text-muted">{r.current_period_end ? dayLabel(r.current_period_end) : '—'}</td>
                    <td className={cx('eyebrow', r.status === 'overdue' && '!text-danger', r.status === 'active' && '!text-leaf-dark')}>{r.status}</td>
                    <td><button className="eyebrow !text-ink hover:underline" onClick={() => setEditing(r.clinic_id)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12.5px] text-muted">Clinics get automatic reminders before each due date and are marked overdue when a period lapses.</p>
        </>
      )}
    </div>
  )
}

function EditRow({ row, onDone }: { row: Schemas['SubscriptionRow']; onDone: () => void }) {
  const [f, setF] = useState({ plan: row.plan, price: String(row.price_paise / 100), status: row.status, due: row.current_period_end?.slice(0, 10) ?? '', fee: String(row.platform_fee_bps) })
  const save = useMutation({
    mutationFn: () => api(`/admin/subscriptions/${row.clinic_id}`, {
      method: 'PUT',
      json: { plan: f.plan, price_paise: Math.round(Number(f.price) * 100), status: f.status, platform_fee_bps: Number(f.fee), current_period_end: f.due ? `${f.due}T18:29:59Z` : null },
    }),
    onSuccess: onDone,
  })
  return (
    <tr className="bg-surface-2">
      <td className="py-3 font-semibold">{row.clinic_name}</td>
      <td><Select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value as typeof f.plan })} className="!h-9"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select></td>
      <td><Input type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} className="!h-9 !w-28" aria-label="Price (₹)" /></td>
      <td><Select value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} className="!h-9"><option value="1000">10%</option><option value="1500">15%</option></Select></td>
      <td><Input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className="!h-9" aria-label="Next due" /></td>
      <td><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })} className="!h-9">{['trial', 'active', 'overdue', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></td>
      <td className="space-x-2 whitespace-nowrap">
        <Button className="!h-9" onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
        <button className="eyebrow hover:underline" onClick={onDone}>Cancel</button>
        {save.error && <span className="block text-[12px] text-danger">{(save.error as Error).message}</span>}
      </td>
    </tr>
  )
}
