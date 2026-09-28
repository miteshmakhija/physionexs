import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { useClinic } from '@/auth/useClinic'
import { PageHeader } from '@/components/ConsoleLayout'
import { Button, Loader } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'

type Pair = Schemas['ValidationPairOut']
type Agreement = Schemas['AgreementOut']

const MEASURE: Record<string, string> = { knee_flexion: 'Knee flexion', knee_extension_lag: 'Extension lag' }
const POSTURE: Record<string, string> = { supine: 'lying', seated: 'sitting', standing: 'standing' }
const sign = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}°`)

/** Camera vs goniometer agreement (design B1). The clinical lead uses this to accept or reject camera measurement. */
export default function Validation() {
  const { clinicId } = useClinic()
  return <ValidationView path="/clinic/validation" clinicId={clinicId} scope="clinic" />
}

/** Super Admin: every clinic's pairs, without patient names. */
export function AdminValidation() {
  return <ValidationView path="/admin/twin/validation" scope="all" />
}

function ValidationView({ path, clinicId, scope }: { path: string; clinicId?: string; scope: 'clinic' | 'all' }) {
  const q = useQuery({ queryKey: ['validation', scope], queryFn: () => api<Schemas['ValidationOut']>(path, { clinicId }) })
  const [group, setGroup] = useState<string | null>(null)
  if (!q.data) return <Loader />
  const { summary, pairs } = q.data
  const key = (g: { code: string; posture: string }) => `${g.code}:${g.posture}`
  const selected = summary.find((s) => key(s) === group) ?? summary[0]

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={scope === 'all' ? 'Camera validation · all clinics' : 'Camera validation'}
        subtitle={scope === 'all'
          ? 'Every pilot clinic’s camera readings against the goniometer, without patient names. Use this to decide whether camera measurement is accurate enough.'
          : 'Camera angles against goniometer readings taken at the same moment. Camera readings stay out of clinical use until agreement is accepted.'}
        actions={pairs.length > 0 && <Button variant="secondary" onClick={() => downloadCsv(pairs)}>Download CSV</Button>}
      />
      {summary.length === 0 ? (
        <p className="border-y border-line py-10 text-center text-[14px] text-muted">No pairs yet. Open a patient’s file and choose “Measure with camera”.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-y border-line text-left text-[14px]">
              <thead>
                <tr className="border-b border-line">
                  {['Measure', 'Pairs', 'Patients', 'Bias', '95% limits of agreement', '3D bias'].map((h) => <th key={h} className="eyebrow py-2.5 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {summary.map((s) => (
                  <tr key={key(s)} className={key(s) === key(selected) ? 'bg-surface-2' : 'cursor-pointer hover:bg-surface-2'} onClick={() => setGroup(key(s))}>
                    <td className="py-2.5 font-semibold">{MEASURE[s.code] ?? s.code}, {POSTURE[s.posture] ?? s.posture}</td>
                    <td>{s.n}</td>
                    <td>{s.patients}</td>
                    <td>{sign(s.bias)}</td>
                    <td>{s.lower == null ? 'Need 2+ pairs' : `${sign(s.lower)} to ${sign(s.upper)}`}</td>
                    <td className="text-muted">{sign(s.bias_3d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12.5px] text-muted">
            Bias is the average of camera − goniometer; 95% of differences are expected within the limits of agreement. Agree the acceptance rule
            (e.g. limits within ±X°) with your clinical lead before collecting, and aim for about 100 pairs from 20+ patients.
          </p>

          <section className="mt-8">
            <h2 className="eyebrow mb-3">Bland–Altman · {MEASURE[selected.code] ?? selected.code}, {POSTURE[selected.posture] ?? selected.posture}</h2>
            <BlandAltmanPlot pairs={pairs.filter((p) => key(p) === key(selected))} a={selected} />
          </section>

          <section className="mt-8">
            <h2 className="eyebrow mb-3">Pairs</h2>
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  {[...(scope === 'all' ? ['Date'] : ['Date', 'Patient']), 'Measure', 'Camera', 'Goniometer', 'Diff', 'Clear frames', 'Conditions'].map((h) => <th key={h} className="eyebrow py-2 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {pairs.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1.5">{dayLabel(p.created_at)}</td>
                    {scope !== 'all' && <td>{p.patient_name ?? '—'}</td>}
                    <td>{p.side === 'left' ? 'L' : 'R'} {MEASURE[p.code] ?? p.code}, {POSTURE[p.posture] ?? p.posture}</td>
                    <td>{p.camera_value}°</td>
                    <td>{p.reference_value}°</td>
                    <td className="font-semibold">{sign(Math.round((p.camera_value - p.reference_value) * 10) / 10)}</td>
                    <td>{Math.round(p.confidence * 100)}%</td>
                    <td className="text-muted">{[p.lighting, p.clothing].filter(Boolean).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}

/** Difference (camera − goniometer) against the mean of the two, with bias and 95% limits of agreement. */
function BlandAltmanPlot({ pairs, a }: { pairs: Pair[]; a: Agreement }) {
  const titleId = useId()
  const W = 640
  const H = 260
  const P = { l: 48, r: 110, t: 12, b: 32 }
  const pts = pairs.map((p) => ({ x: (p.camera_value + p.reference_value) / 2, y: p.camera_value - p.reference_value }))
  if (!pts.length) return null
  const xs = pts.map((p) => p.x)
  const ys = [...pts.map((p) => p.y), a.lower ?? 0, a.upper ?? 0, 0]
  const x0 = Math.floor(Math.min(...xs) / 10) * 10 - 5
  const x1 = Math.ceil(Math.max(...xs) / 10) * 10 + 5
  const yMax = Math.max(5, Math.ceil(Math.max(...ys.map(Math.abs)) + 2))
  const x = (v: number) => P.l + ((v - x0) / (x1 - x0)) * (W - P.l - P.r)
  const y = (v: number) => P.t + ((yMax - v) / (2 * yMax)) * (H - P.t - P.b)
  const line = (v: number | null | undefined, label: string, dash?: string) =>
    v == null ? null : (
      <g key={label}>
        <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#646867" strokeWidth={1.5} strokeDasharray={dash} />
        <text x={W - P.r + 6} y={y(v)} dy="0.32em" className="fill-muted text-[11px]">{label} {sign(Math.round(v * 10) / 10)}</text>
      </g>
    )
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-labelledby={titleId}>
      <title id={titleId}>Bland–Altman plot: camera minus goniometer against their mean</title>
      {[-yMax, 0, yMax].map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#ECECED" />
          <text x={P.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">{sign(t)}</text>
        </g>
      ))}
      {[x0, (x0 + x1) / 2, x1].map((t) => <text key={t} x={x(t)} y={H - 10} textAnchor="middle" className="fill-muted text-[11px] tabular-nums">{t}°</text>)}
      {line(a.bias, 'Bias')}
      {line(a.upper, 'Upper', '4 4')}
      {line(a.lower, 'Lower', '4 4')}
      {pts.map((p, i) => <circle key={i} cx={x(p.x)} cy={y(p.y)} r={4} fill="#1170C2" stroke="#fff" strokeWidth={1.5} />)}
    </svg>
  )
}

function downloadCsv(pairs: Pair[]) {
  const cols = ['created_at', 'code', 'side', 'posture', 'camera_value', 'camera_value_3d', 'reference_value', 'confidence', 'frames', 'spread', 'fps', 'model', 'lighting', 'clothing', 'note'] as const
  const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  // No patient names in the export: pairs are identified by date and measure only.
  const csv = [cols.join(','), ...pairs.map((p) => cols.map((c) => esc(p[c])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `camera-validation-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
