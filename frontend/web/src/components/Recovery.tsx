import { useQuery } from '@tanstack/react-query'

import { MeasureTrend } from '@/components/charts'
import { KneeMap } from '@/components/KneeMap'
import { cx } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'

type Measure = Schemas['RecoveryMeasureOut']

const SIDE: Record<string, string> = { left: 'Left', right: 'Right' }
const fmt = (v: number, unit: string) => (unit === 'deg' ? `${v}°` : `${v} ${unit}`)

/** Patient Progress: knee recovery against the physio's targets, plus pain and stiffness from daily check-ins. */
export function Recovery() {
  const q = useQuery({ queryKey: ['recovery'], queryFn: () => api<Schemas['RecoveryOut']>('/me/recovery') })
  const r = q.data
  if (!r?.available) return null
  const { measures = [], readings = [], checkins = [] } = r
  const bends = measures.filter((m) => m.code === 'knee_flexion')

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-[18px] font-bold">Knee recovery</h2>
        <p className="text-[13.5px] text-muted">
          {[r.condition, r.weeks_since_surgery != null && `week ${r.weeks_since_surgery} after surgery`, r.clinic_name && `measured at ${r.clinic_name}`].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-[130px_1fr]">
        <KneeMap measures={bends} />
        <div className="grid content-start gap-3 sm:grid-cols-2">
          {measures.map((m) => <MeasureCard key={`${m.code}-${m.side}`} m={m} />)}
        </div>
      </div>
      {bends.map((m) => {
        const pts = readings.filter((x) => x.code === 'knee_flexion' && x.side === m.side)
        return pts.length > 1 ? (
          <div key={m.side}>
            <h3 className="mb-2 text-[15px] font-semibold">{SIDE[m.side]} knee bend <span className="font-normal text-muted">· measured at your visits</span></h3>
            <MeasureTrend title={`${SIDE[m.side]} knee bend over time`} unit="deg" lo={0} hi={160} target={m.target}
              points={pts.map((x) => ({ at: `${x.measured_on}T12:00:00`, value: x.value, trusted: true }))} />
          </div>
        ) : null
      })}
      {checkins.length > 1 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {(['pain', 'stiffness'] as const).map((k) => (
            <div key={k}>
              <h3 className="mb-2 text-[15px] font-semibold">{k === 'pain' ? 'Pain' : 'Stiffness'} <span className="font-normal text-muted">· your daily check-ins, 0–10</span></h3>
              <MeasureTrend title={`${k} from your daily check-ins`} unit="score" lo={0} hi={10} target={null}
                points={checkins.map((c) => ({ at: `${c.day}T12:00:00`, value: c[k], trusted: true }))} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function MeasureCard({ m }: { m: Measure }) {
  const status = m.status === 'no_data'
    ? 'Your physio will measure this at your next visit.'
    : m.status === 'target_met'
      ? 'Target reached — well done.'
      : m.status === 'no_target'
        ? `Last measured ${dayLabel(m.latest_on!)}.`
        : `${m.progress_pct}% of the way from ${fmt(m.baseline!, m.unit)} to your target · ${dayLabel(m.latest_on!)}`
  return (
    <div className="border border-line p-4">
      <p className="eyebrow">{SIDE[m.side]} · {m.label}</p>
      <p className="mt-1 text-[28px] font-extrabold leading-tight tracking-[-0.02em] tabular-nums">
        {m.latest != null ? fmt(m.latest, m.unit) : '—'}
        {m.target != null && <span className="text-[13px] font-semibold tracking-normal text-muted"> / target {fmt(m.target, m.unit)}{m.by_week ? ` by week ${m.by_week}` : ''}</span>}
      </p>
      {m.progress_pct != null && (
        <div className="mt-2 h-1.5 rounded-full bg-line" role="progressbar" aria-valuenow={m.progress_pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.label} progress`}>
          <div className={cx('h-1.5 rounded-full', m.status === 'target_met' ? 'bg-leaf' : 'bg-brand')} style={{ width: `${m.progress_pct}%` }} />
        </div>
      )}
      <p className="mt-2 text-[12.5px] text-muted">{status}</p>
      {m.hint && <p className="mt-1 text-[12px] text-subtle">{m.hint}</p>}
    </div>
  )
}
