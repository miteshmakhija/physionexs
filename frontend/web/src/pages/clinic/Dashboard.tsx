import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { useAuth } from '@/auth/AuthProvider'
import { useClinic } from '@/auth/useClinic'
import { Adherence } from '@/components/clinical'
import { PageHeader } from '@/components/ConsoleLayout'
import { Avatar, Button, cx, Loader, Select, Stat } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { payWithRazorpay } from '@/lib/razorpay'
import { dayLabel, MODE_LABEL, rupees, STATUS_LABEL, time } from '@shared/format'

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const { me } = useAuth()
  const { clinicId, isOwner } = useClinic()
  const [branchId, setBranchId] = useState('')
  const q = useQuery({
    queryKey: ['dashboard', branchId],
    queryFn: () => api<Schemas['DashboardOut']>('/clinic/dashboard', { clinicId, query: { branch_id: branchId } }),
    refetchInterval: 60_000,
    placeholderData: (p) => p,
  })
  const d = q.data
  const allBranches = useQuery({ queryKey: ['branches'], queryFn: () => api<Schemas['BranchOut'][]>('/clinic/branches', { clinicId }) })
  const firstName = me?.full_name.replace(/^Dr\.?\s*/i, 'Dr. ').split(' ').slice(0, 2).join(' ')

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        subtitle="Here's how your clinic is doing today."
        actions={
          <div className="flex items-center gap-3">
            <CheckIn clinicId={clinicId} />
            {(allBranches.data?.length ?? 0) > 1 && (
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="!w-56" aria-label="Branch">
                <option value="">All branches</option>
                {allBranches.data!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </div>
        }
      />
      {!d ? <Loader /> : (
        <div className={cx('space-y-8 transition-opacity', q.isFetching && 'opacity-70')}>
          {isOwner && d.subscription?.due_soon && <SubscriptionBanner sub={d.subscription} clinicId={clinicId} />}

          <div className={cx('grid gap-3 sm:grid-cols-2', isOwner ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
            <Stat label="Appointments today" value={d.appointments_today} sub="booked + walk-ins" />
            <Stat label="Tokens waiting" value={d.tokens_waiting} sub={<Link to="/clinic/queue" className="underline">Open queue</Link>} />
            <Stat label="Active patients" value={d.active_patients} sub="seen in 90 days" />
            <Stat label="Staff on roll" value={d.staff_on_roll} />
            {isOwner && <Stat label="Revenue · this week" value={rupees(d.revenue_week_paise ?? 0)} sub={<Link to="/clinic/billing" className="underline">Billing</Link>} />}
          </div>

          {d.branches.length > 1 && (
            <section>
              <h2 className="eyebrow mb-3">Branch breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-y border-line text-left text-[14px]">
                  <thead>
                    <tr className="border-b border-line">
                      {['Branch', 'Today', 'Waiting', 'Patients', ...(isOwner ? ['Revenue · week'] : [])].map((h) => <th key={h} className="eyebrow py-2.5 font-semibold">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line tabular-nums">
                    {d.branches.map((b) => (
                      <tr key={b.id}>
                        <td className="py-3"><span className="font-semibold">{b.name}</span><span className="block text-[12.5px] text-muted">{[b.area, b.lead_name].filter(Boolean).join(' · ')}</span></td>
                        <td>{b.today}</td>
                        <td>{b.waiting}</td>
                        <td>{b.patients}</td>
                        {isOwner && <td>{rupees(b.revenue_week_paise ?? 0)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="grid gap-8 lg:grid-cols-2">
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="eyebrow">Today's schedule</h2>
                <Link to="/clinic/schedule" className="eyebrow !text-ink hover:underline">Open calendar →</Link>
              </div>
              {d.schedule.length === 0 ? <p className="border-y border-line py-8 text-center text-[14px] text-muted">No booked appointments today.</p> : (
                <ul className="divide-y divide-line border-y border-line">
                  {d.schedule.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-3 text-[14px]">
                      <span className="w-16 font-semibold tabular-nums">{time(a.starts_at)}</span>
                      <Avatar name={a.patient_name} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{a.patient_name}</span>
                        <span className="block text-[12.5px] text-muted">{[a.reason, MODE_LABEL[a.mode as keyof typeof MODE_LABEL]].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="eyebrow">{STATUS_LABEL[a.status]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="eyebrow mb-1">Needs attention</h2>
              <p className="mb-3 text-[13px] text-muted">Patients falling behind on logged exercises.</p>
              {d.attention.length === 0 ? <p className="border-y border-line py-8 text-center text-[14px] text-muted">Everyone's on track.</p> : (
                <ul className="divide-y divide-line border-y border-line">
                  {d.attention.map((p) => (
                    <li key={p.clinic_patient_id}>
                      <Link to={`/clinic/patients/${p.clinic_patient_id}`} className="flex items-center gap-3 py-3 text-[14px] hover:bg-surface-2">
                        <Avatar name={p.name} />
                        <span className="min-w-0 flex-1"><span className="block font-semibold">{p.name}</span><span className="block text-[12.5px] text-muted">{p.note}</span></span>
                        <Adherence pct={p.adherence} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

function SubscriptionBanner({ sub, clinicId }: { sub: Schemas['SubscriptionOut']; clinicId: string }) {
  const qc = useQueryClient()
  const pay = useMutation({
    mutationFn: async () => {
      const checkout = await api<Schemas['RazorpayCheckout']>('/clinic/subscription/checkout', { method: 'POST', clinicId, json: {} })
      const result = await payWithRazorpay(checkout)
      if (!result) return null
      return api<Schemas['SubscriptionOut']>('/clinic/subscription/verify', { method: 'POST', clinicId, json: result })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })
  const text = sub.status === 'overdue'
    ? 'Your practice console subscription is overdue.'
    : sub.status === 'trial'
      ? `Free trial${sub.trial_ends_at ? ` ends ${dayLabel(sub.trial_ends_at)}` : ''}.`
      : `Next payment due ${sub.current_period_end ? dayLabel(sub.current_period_end) : 'soon'}.`
  return (
    <div className={cx('flex flex-wrap items-center justify-between gap-4 border p-4', sub.status === 'overdue' ? 'border-danger' : 'border-line')}>
      <p className="text-[14px]">
        <span className="font-semibold">Practice console · {rupees(sub.price_paise)}{sub.plan === 'yearly' ? '/yr' : '/mo'}</span>
        <span className="text-muted"> — {text} Automatic reminders are sent before each due date.</span>
      </p>
      <div className="flex items-center gap-3">
        {pay.error && <span className="text-[13px] text-danger">{(pay.error as Error).message}</span>}
        <Button onClick={() => pay.mutate()} loading={pay.isPending}>Pay now</Button>
      </div>
    </div>
  )
}

function CheckIn({ clinicId }: { clinicId: string }) {
  const [done, setDone] = useState<string | null>(null)
  const check = useMutation({
    mutationFn: () => api<Schemas['StaffOut']>('/clinic/attendance/check-in', { method: 'POST', clinicId }),
    onSuccess: (s) => setDone(s.check_in?.slice(0, 5) ?? 'now'),
    onError: (e) => {
      const m = /at (\d{2}:\d{2})/.exec((e as Error).message)
      if (m) setDone(m[1])
    },
  })
  if (done) return <span className="text-[13px] text-muted">Checked in · {done}</span>
  return <Button variant="secondary" onClick={() => check.mutate()} loading={check.isPending}>Check in</Button>
}
