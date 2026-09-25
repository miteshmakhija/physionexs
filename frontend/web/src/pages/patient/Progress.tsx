import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { AdherenceBars, PainLine, ProgressTable } from '@/components/charts'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, cx, Loader, Stat } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

export default function Progress() {
  const [range, setRange] = useState<'week' | 'month'>('week')
  const [table, setTable] = useState(false)
  const q = useQuery({
    queryKey: ['progress', range],
    queryFn: () => api<Schemas['ProgressOut']>('/me/progress', { query: { range } }),
    placeholderData: (prev) => prev, // keep the previous render while switching ranges
  })

  const p = q.data
  const days = p?.days.map((d) => ({ day: d.day, pct: d.pct, pain: d.pain, done: d.done, scheduled: d.scheduled })) ?? []
  const painDelta = p?.pain_now != null && p.pain_start != null ? p.pain_now - p.pain_start : null

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Progress"
        actions={
          <div className="flex">
            {(['week', 'month'] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={cx('-ml-px h-9 border px-4 text-[13px] first:ml-0', range === r ? 'relative z-10 border-ink bg-ink text-white' : 'border-line-strong hover:bg-surface-2')}>
                {r === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
        }
      />
      {!p ? <Loader /> : (
        <div className={cx('space-y-8 transition-opacity', q.isFetching && 'opacity-60')}>
          {p.unlogged_doses_today > 0 && <Alert tone="warning">You have {p.unlogged_doses_today} unlogged medicine dose(s) today. Staying consistent keeps these charts accurate.</Alert>}

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Adherence" value={p.adherence_pct != null ? `${p.adherence_pct}%` : '—'} sub={`avg this ${range}`} />
            <Stat label="Streak" value={`${p.streak_days} days`} sub={`best: ${p.best_streak_days} days`} />
            <Stat
              label="Pain level"
              value={p.pain_now != null ? `${p.pain_now}/10` : '—'}
              sub={painDelta == null ? 'Log pain after exercises' : painDelta < 0 ? `improving — down from ${p.pain_start}/10` : painDelta > 0 ? `up from ${p.pain_start}/10 — tell your physio` : 'unchanged'}
            />
          </div>

          <section className="border-t border-line pt-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold">Exercise completion <span className="font-normal text-muted">· % of each day's exercises done</span></h2>
              <button onClick={() => setTable(!table)} className="eyebrow !text-ink hover:underline">{table ? 'View as chart' : 'View as table'}</button>
            </div>
            {table ? <ProgressTable days={days} /> : <AdherenceBars days={days} />}
          </section>

          {!table && (
            <section className="border-t border-line pt-6">
              <h2 className="mb-3 text-[15px] font-semibold">Pain level <span className="font-normal text-muted">· average logged per day, 0–10</span></h2>
              {days.some((d) => d.pain != null) ? <PainLine days={days} /> : <p className="py-8 text-center text-[14px] text-muted">No pain scores logged in this period yet.</p>}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
