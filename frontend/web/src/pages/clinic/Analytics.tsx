import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useClinic } from '@/auth/useClinic'
import { BarChart, tickLabel } from '@/components/charts'
import { PageHeader } from '@/components/ConsoleLayout'
import { cx, Loader, Stat } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayParts, rupees } from '@shared/format'

const RANGES = [7, 30, 90] as const

function Delta({ now, prev, invert = false }: { now: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="text-muted">vs previous period</span>
  const pct = Math.round((100 * (now - prev)) / prev)
  const good = invert ? pct <= 0 : pct >= 0
  return <span className={good ? 'text-leaf-dark' : 'text-danger'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% vs previous</span>
}

export default function Analytics() {
  const { clinicId } = useClinic()
  const [days, setDays] = useState<(typeof RANGES)[number]>(7)
  const [table, setTable] = useState(false)
  const q = useQuery({
    queryKey: ['analytics', days],
    queryFn: () => api<Schemas['AnalyticsOut']>('/clinic/analytics', { clinicId, query: { days } }),
    placeholderData: (p) => p,
  })
  const a = q.data

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Analytics"
        subtitle={`Practice performance · last ${days} days`}
        actions={
          <div className="flex">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setDays(r)} aria-pressed={days === r} className={cx('-ml-px h-9 border px-4 text-[13px] first:ml-0', days === r ? 'relative z-10 border-ink bg-ink text-white' : 'border-line-strong hover:bg-surface-2')}>
                {r} days
              </button>
            ))}
          </div>
        }
      />
      {!a ? <Loader /> : (
        <div className={cx('space-y-8 transition-opacity', q.isFetching && 'opacity-60')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Revenue" value={rupees(a.revenue_paise)} sub={<Delta now={a.revenue_paise} prev={a.revenue_prev_paise} />} />
            <Stat label="Appointments" value={a.appointments} sub={<Delta now={a.appointments} prev={a.appointments_prev} />} />
            <Stat label="Avg. adherence" value={a.avg_adherence == null ? '—' : `${a.avg_adherence}%`} sub="patients on active plans" />
            <Stat label="No-shows" value={a.no_show_pct == null ? '—' : `${a.no_show_pct}%`} sub="of past booked appointments" />
          </div>

          <section className="border-t border-line pt-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold">Revenue <span className="font-normal text-muted">· collected per day</span></h2>
              <button onClick={() => setTable(!table)} className="eyebrow !text-ink hover:underline">{table ? 'View as chart' : 'View as table'}</button>
            </div>
            {table ? (
              <table className="w-full text-left text-[13px] tabular-nums">
                <thead><tr className="border-b border-line"><th className="eyebrow py-2 font-semibold">Day</th><th className="eyebrow py-2 font-semibold">Collected</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {a.revenue_by_day.map((p) => <tr key={p.day}><td className="py-1.5">{dayParts(p.day).long}</td><td>{rupees(p.value)}</td></tr>)}
                </tbody>
              </table>
            ) : (
              <BarChart
                title="Revenue collected per day, rupees"
                ticks={(m) => [0, m / 2, m].map((v) => ({ v, label: v >= 100_000 ? `₹${(v / 100_000).toFixed(v % 100_000 ? 1 : 0)}k` : `₹${Math.round(v / 100)}` }))}
                points={a.revenue_by_day.map((p, i) => ({
                  key: p.day,
                  label: tickLabel(p.day, i, a.revenue_by_day.length),
                  value: p.value,
                  readout: rupees(p.value),
                  detail: dayParts(p.day).long,
                }))}
              />
            )}
          </section>

          <div className="grid gap-8 border-t border-line pt-6 lg:grid-cols-[1.2fr_1fr]">
            <section>
              <h2 className="mb-3 text-[15px] font-semibold">Conditions treated</h2>
              {a.conditions.length === 0 ? <p className="text-[14px] text-muted">No care plans in this period.</p> : (
                <ul className="space-y-3">
                  {a.conditions.map((c) => (
                    <li key={c.label} className="text-[14px]">
                      <div className="mb-1 flex justify-between gap-3"><span>{c.label}</span><span className="tabular-nums text-muted">{c.count} · {c.pct}%</span></div>
                      <div className="h-1.5 bg-line"><div className="h-full rounded-r-[4px] bg-brand" style={{ width: `${c.pct}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Stat label="Patient retention" value={a.returning_pct == null ? '—' : `${a.returning_pct}%`} sub={`returning · ${a.new_patients} new`} />
              <Stat label="Online vs in-clinic" value={a.online_pct == null ? '—' : `${a.online_pct}%`} sub={a.online_pct == null ? 'no bookings' : `tele-consults · ${100 - a.online_pct}% in-clinic`} />
              <Stat label="Avg. rating" value={a.rating_avg == null ? '—' : `★ ${a.rating_avg.toFixed(1)}`} sub={`${a.reviews} review${a.reviews === 1 ? '' : 's'}`} />
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
