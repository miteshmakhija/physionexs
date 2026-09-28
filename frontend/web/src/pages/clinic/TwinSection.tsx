import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { MeasureTrend } from '@/components/charts'
import { Alert, Button, Field, Input, Select, cx } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'

type Twin = Schemas['TwinOut']
type Measure = Schemas['TwinMeasureOut']
type Reading = Schemas['MeasurementOut']

const SIDE: Record<string, string> = { left: 'Left', right: 'Right', none: '' }

function fmtValue(v: number, unit: string) {
  return unit === 'deg' ? `${v}°` : unit === 'score' ? `${v}/10` : `${v} ${unit}`
}

function measureName(m: { label: string; side: string }) {
  return [SIDE[m.side], SIDE[m.side] ? m.label.toLowerCase() : m.label].filter(Boolean).join(' ')
}

/** Patient file → Recovery twin: body map, each measure against its target, trends, and clinic readings. */
export function TwinSection({ cpId, canWrite, clinicId }: { cpId: string; canWrite: boolean; clinicId: string }) {
  const q = useQuery({ queryKey: ['twin', cpId], queryFn: () => api<Twin>(`/clinic/patients/${cpId}/twin`, { clinicId }) })
  if (!q.data) return null
  const t = q.data
  const knees = t.measures.filter((m) => m.code === 'knee_flexion')
  const trends = t.measures.filter((m) => t.measurements.some((r) => r.code === m.code && r.side === m.side))

  return (
    <section className="mt-8 border-t border-line pt-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Recovery twin</h2>
        <p className="text-[13px] text-muted">
          {t.protocol_label
            ? [t.protocol_label, t.affected_side && `${t.affected_side} side`, t.surgery_date && `surgery ${dayLabel(t.surgery_date)}`, t.weeks_since_surgery != null && `week ${t.weeks_since_surgery}`].filter(Boolean).join(' · ')
            : 'Set the care plan’s protocol to Knee replacement to track knee recovery.'}
        </p>
      </div>

      {t.measures.length > 0 && (
        <div className="grid gap-6 md:grid-cols-[150px_1fr]">
          <KneeMap measures={knees} />
          <div className="grid content-start gap-3 sm:grid-cols-2">
            {t.measures.map((m) => <MeasureCard key={`${m.code}-${m.side}`} m={m} />)}
          </div>
        </div>
      )}

      {trends.length > 0 && (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          {trends.map((m) => {
            const code = t.codes.find((c) => c.code === m.code)!
            return (
              <div key={`${m.code}-${m.side}`}>
                <h3 className="mb-2 text-[14px] font-semibold">{measureName(m)}</h3>
                <MeasureTrend
                  title={`${measureName(m)} over time`}
                  unit={m.unit}
                  lo={code.min}
                  hi={code.max}
                  target={m.target}
                  points={t.measurements.filter((r) => r.code === m.code && r.side === m.side).map((r) => ({ at: r.measured_at, value: r.value, trusted: r.trusted }))}
                />
              </div>
            )
          })}
        </div>
      )}

      {canWrite && <AddReading twin={t} cpId={cpId} clinicId={clinicId} />}
      <Readings twin={t} cpId={cpId} canWrite={canWrite} clinicId={clinicId} />
    </section>
  )
}

function statusText(m: Measure) {
  if (m.status === 'no_data') return 'No reading yet'
  if (m.status === 'no_target') return 'No target set'
  if (m.status === 'target_met') return 'Target reached'
  return `${m.progress_pct}% of the way from ${fmtValue(m.baseline!, m.unit)}`
}

function MeasureCard({ m }: { m: Measure }) {
  return (
    <div className="border border-line p-4">
      <p className="eyebrow">{measureName(m)}</p>
      <p className="mt-1 text-[26px] font-extrabold leading-tight tracking-[-0.02em] tabular-nums">
        {m.latest ? fmtValue(m.latest.value, m.unit) : '—'}
        {m.target != null && <span className="text-[13px] font-semibold tracking-normal text-muted"> / {fmtValue(m.target, m.unit)}{m.by_week ? ` by wk ${m.by_week}` : ''}</span>}
      </p>
      {m.progress_pct != null && (
        <div className="mt-2 h-1 bg-line" role="progressbar" aria-valuenow={m.progress_pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${measureName(m)} progress`}>
          <div className={cx('h-1', m.status === 'target_met' ? 'bg-leaf' : 'bg-brand')} style={{ width: `${m.progress_pct}%` }} />
        </div>
      )}
      <p className="mt-2 text-[12.5px] text-muted">
        {statusText(m)}
        {m.latest && ` · ${dayLabel(m.latest.measured_at)}`}
      </p>
    </div>
  )
}

/** Front view, so the patient's right knee is on the viewer's left. */
function KneeMap({ measures }: { measures: Measure[] }) {
  const tone = (side: 'left' | 'right') => {
    const m = measures.find((x) => x.side === side)
    if (!m) return null
    return m.status === 'target_met' ? 'fill-leaf' : m.status === 'no_data' ? 'fill-line-strong' : 'fill-brand'
  }
  const knees = [{ side: 'right' as const, x: 62 }, { side: 'left' as const, x: 98 }]
  return (
    <figure className="hidden md:block">
      <svg viewBox="0 0 160 250" className="h-56 w-auto" role="img" aria-label="Body map: tracked knees are highlighted">
        <g className="stroke-line-strong" strokeWidth="3" strokeLinecap="round" fill="none">
          <circle cx="80" cy="24" r="14" />
          <path d="M80 40V118M56 54H104M56 54L48 96L46 134M104 54L112 96L114 134M66 118H94M66 118L62 178L60 238M94 118L98 178L100 238" />
        </g>
        {knees.map(({ side, x }) => {
          const cls = tone(side)
          return cls ? (
            <g key={side}>
              <circle cx={x} cy="178" r="11" className={cx(cls, 'opacity-20')} />
              <circle cx={x} cy="178" r="5.5" className={cls} />
            </g>
          ) : <circle key={side} cx={x} cy="178" r="4" strokeWidth="2" className="fill-surface stroke-line-strong" />
        })}
      </svg>
      <figcaption className="mt-1 text-center text-[11.5px] text-muted">R · L</figcaption>
    </figure>
  )
}

function AddReading({ twin, cpId, clinicId }: { twin: Twin; cpId: string; clinicId: string }) {
  const qc = useQueryClient()
  const defaultSide = twin.affected_side === 'left' ? 'left' : 'right'
  const [f, setF] = useState({ code: 'knee_flexion', side: defaultSide, value: '', day: new Date().toISOString().slice(0, 10) })
  const code = twin.codes.find((c) => c.code === f.code)!
  const save = useMutation({
    mutationFn: () => {
      const today = f.day === new Date().toISOString().slice(0, 10)
      return api<Reading[]>(`/clinic/patients/${cpId}/measurements`, {
        method: 'POST',
        clinicId,
        json: [{
          code: f.code,
          side: code.sided ? f.side : 'none',
          value: Number(f.value),
          method: f.code === 'pain_nprs' ? 'self_report' : f.code === 'knee_girth' ? 'tape' : 'goniometer',
          measured_at: today ? null : new Date(`${f.day}T12:00:00`).toISOString(),
        }],
      })
    },
    onSuccess: () => {
      setF({ ...f, value: '' })
      void qc.invalidateQueries({ queryKey: ['twin', cpId] })
    },
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <form className="mt-8 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <Field label="Measure">
        <Select value={f.code} onChange={set('code')}>
          {twin.codes.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </Select>
      </Field>
      {code.sided && (
        <Field label="Side">
          <Select value={f.side} onChange={set('side')}>
            <option value="right">Right</option>
            <option value="left">Left</option>
          </Select>
        </Field>
      )}
      <Field label={`Value (${code.unit === 'deg' ? '°' : code.unit === 'score' ? '0–10' : code.unit})`}>
        <Input type="number" step="0.5" min={code.min} max={code.max} value={f.value} onChange={set('value')} required className="!w-28" />
      </Field>
      <Field label="Date">
        <Input type="date" value={f.day} max={new Date().toISOString().slice(0, 10)} onChange={set('day')} required />
      </Field>
      <Button type="submit" variant="secondary" loading={save.isPending}>Add reading</Button>
      {save.error && <div className="w-full"><Alert>{(save.error as Error).message}</Alert></div>}
    </form>
  )
}

function Readings({ twin, cpId, canWrite, clinicId }: { twin: Twin; cpId: string; canWrite: boolean; clinicId: string }) {
  const qc = useQueryClient()
  const [all, setAll] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['twin', cpId] })
  const confirm = useMutation({ mutationFn: (id: string) => api(`/clinic/measurements/${id}`, { method: 'PATCH', clinicId, json: { trusted: true } }), onSuccess: refresh })
  const discard = useMutation({ mutationFn: (id: string) => api(`/clinic/measurements/${id}`, { method: 'DELETE', clinicId }), onSuccess: refresh })
  if (twin.measurements.length === 0) return <p className="mt-4 text-[13.5px] text-muted">No readings recorded yet.</p>
  const rows = all ? twin.measurements : twin.measurements.slice(0, 8)

  return (
    <div className="mt-6">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {['Date', 'Measure', 'Value', 'Recorded by', ''].map((h) => <th key={h} className="eyebrow py-2 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums">
          {rows.map((r) => (
            <tr key={r.id} className={cx(!r.trusted && 'bg-amber-tint/50')}>
              <td className="py-1.5">{dayLabel(r.measured_at)}</td>
              <td>{measureName(r)}</td>
              <td className={cx(!r.trusted && 'text-muted')}>{fmtValue(r.value, r.unit)}<span className="text-muted"> · {r.method.replace('_', ' ')}</span></td>
              <td className="text-muted">{r.recorded_by_name ?? '—'}</td>
              <td className="text-right">
                {!r.trusted && (
                  <span className="text-[12.5px]">
                    <span className="text-amber">Big jump — held. </span>
                    {canWrite && (
                      <>
                        <button className="font-semibold underline" onClick={() => confirm.mutate(r.id)}>Confirm</button>{' · '}
                        <button className="font-semibold underline" onClick={() => window.confirm('Discard this reading?') && discard.mutate(r.id)}>Discard</button>
                      </>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {twin.measurements.length > rows.length && (
        <button className="eyebrow mt-3 !text-ink hover:underline" onClick={() => setAll(true)}>Show all {twin.measurements.length} readings</button>
      )}
    </div>
  )
}
