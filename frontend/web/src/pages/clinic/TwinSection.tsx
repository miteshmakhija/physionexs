import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { MeasureTrend } from '@/components/charts'
import { FlagList } from '@/components/flags'
import { AIDraft } from '@/components/AIDraft'
import { KneeMap } from '@/components/KneeMap'
import { Alert, Button, Field, Input, Select, Stat, cx } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { EXERCISES, SLEEP, SWELLING, labelOf } from '@shared/checkin'
import { dayLabel, isoDay } from '@shared/format'

type Twin = Schemas['TwinOut']
type Measure = Schemas['TwinMeasureOut']
type Reading = Schemas['MeasurementOut']

const SIDE: Record<string, string> = { left: 'Left', right: 'Right', none: '' }
const isCamera = (r: Reading) => r.method === 'camera_v1' // unvalidated estimates (design B1)

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
  const clinical = t.measurements.filter((r) => !isCamera(r))
  const trends = t.measures.filter((m) => clinical.some((r) => r.code === m.code && r.side === m.side))

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

      {canWrite && t.protocol && <Summary cpId={cpId} clinicId={clinicId} />}
      <TwinFlags twin={t} canWrite={canWrite} clinicId={clinicId} />

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
              <div key={`${m.code}-${m.side}`} className="min-w-0">
                <h3 className="mb-2 text-[14px] font-semibold">{measureName(m)}</h3>
                <MeasureTrend
                  title={`${measureName(m)} over time`}
                  unit={m.unit}
                  lo={code.min}
                  hi={code.max}
                  target={m.target}
                  points={clinical.filter((r) => r.code === m.code && r.side === m.side).map((r) => ({ at: r.measured_at, value: r.value, trusted: r.trusted }))}
                />
              </div>
            )
          })}
        </div>
      )}

      <Checkins twin={t} />

      {canWrite && <AddReading twin={t} cpId={cpId} clinicId={clinicId} />}
      {canWrite && t.protocol && (
        <Link to={`/clinic/patients/${cpId}/camera`} className="eyebrow mt-3 inline-block !text-ink hover:underline">Measure with camera (validation) →</Link>
      )}
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

function AddReading({ twin, cpId, clinicId }: { twin: Twin; cpId: string; clinicId: string }) {
  const qc = useQueryClient()
  const defaultSide = twin.affected_side === 'left' ? 'left' : 'right'
  const [f, setF] = useState({ code: 'knee_flexion', side: defaultSide, value: '', day: isoDay() })
  const code = twin.codes.find((c) => c.code === f.code)!
  const save = useMutation({
    mutationFn: () => {
      const today = f.day === isoDay()
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
        <Input type="date" value={f.day} max={isoDay()} onChange={set('day')} required />
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
            <tr key={r.id} className={cx(!r.trusted && !isCamera(r) && 'bg-amber-tint/50')}>
              <td className="py-1.5">{dayLabel(r.measured_at)}</td>
              <td>{measureName(r)}</td>
              <td className={cx(!r.trusted && 'text-muted')}>{fmtValue(r.value, r.unit)}<span className="text-muted"> · {isCamera(r) ? 'camera estimate, not validated' : r.method.replace('_', ' ')}</span></td>
              <td className="text-muted">{r.recorded_by_name ?? '—'}</td>
              <td className="text-right">
                {!r.trusted && !isCamera(r) && (
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

/** Patient-reported daily check-ins: red flags first, then the latest answers and 30-day trends. */
function Checkins({ twin }: { twin: Twin }) {
  const c = twin.checkins ?? []
  if (!twin.protocol && c.length === 0) return null
  const weekAgo = isoDay(new Date(Date.now() - 6 * 86_400_000))
  const last = c[0]
  const seven = c.filter((x) => x.day >= weekAgo)

  return (
    <div className="mt-8">
      <h3 className="mb-3 text-[14px] font-semibold">Daily check-ins</h3>
      {!last ? (
        <p className="text-[13.5px] text-muted">No check-ins yet. The patient is asked to check in daily from their app once they agree to share.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Last check-in" value={dayLabel(last.day)} sub={`${last.source === 'web' ? 'Web' : last.source === 'whatsapp' ? 'WhatsApp' : 'App'}`} />
            <Stat label="Pain · stiffness" value={`${last.pain} · ${last.stiffness}`} sub="out of 10" />
            <Stat label="Swelling · sleep" value={labelOf(SWELLING, last.swelling)} sub={`Slept ${labelOf(SLEEP, last.sleep).toLowerCase()}`} />
            <Stat label="Check-ins · 7 days" value={`${seven.length} of 7`} sub={`Exercises: ${labelOf(EXERCISES, last.exercises).toLowerCase()} yesterday`} />
          </div>
          {c.length > 1 && (
            <div className="mt-6 grid gap-8 lg:grid-cols-2">
              {(['pain', 'stiffness'] as const).map((k) => (
                <div key={k} className="min-w-0">
                  <h4 className="mb-2 text-[13.5px] font-semibold">{k === 'pain' ? 'Pain' : 'Stiffness'} · check-ins</h4>
                  <MeasureTrend title={`${k} from daily check-ins, 0 to 10`} unit="score" lo={0} hi={10} target={null}
                    points={c.map((x) => ({ at: `${x.day}T12:00:00`, value: x[k], trusted: true }))} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TwinFlags({ twin, canWrite, clinicId }: { twin: Twin; canWrite: boolean; clinicId: string }) {
  const [showClosed, setShowClosed] = useState(false)
  const flags = twin.flags ?? []
  const active = flags.filter((f) => f.status === 'open' || f.status === 'acknowledged')
  const closed = flags.filter((f) => !active.includes(f))
  if (!flags.length) return null
  return (
    <div className="mb-8">
      {active.length > 0 && <FlagList flags={active} clinicId={clinicId} canWrite={canWrite} showPatient={false} />}
      {closed.length > 0 && (
        showClosed
          ? <div className="mt-3"><FlagList flags={closed} clinicId={clinicId} canWrite={false} showPatient={false} /></div>
          : <button className="eyebrow mt-3 !text-ink hover:underline" onClick={() => setShowClosed(true)}>Show {closed.length} closed flag{closed.length > 1 ? 's' : ''} (30 days)</button>
      )}
    </div>
  )
}

/** AI assist: the last 7 days in a short paragraph for the physio (not stored). */
function Summary({ cpId, clinicId }: { cpId: string; clinicId: string }) {
  const { aiAssist } = useClinic()
  const run = useMutation({ mutationFn: () => api<{ text: string }>(`/clinic/ai/patients/${cpId}/summary`, { method: 'POST', clinicId }) })
  if (!aiAssist) return null
  return (
    <div className="mb-6">
      {run.data ? <AIDraft text={run.data.text} /> : (
        <Button variant="secondary" className="!h-9" loading={run.isPending} onClick={() => run.mutate()}>Summarise last 7 days with AI</Button>
      )}
      {run.error && <p className="mt-1 text-[12.5px] text-danger">{(run.error as Error).message}</p>}
    </div>
  )
}
