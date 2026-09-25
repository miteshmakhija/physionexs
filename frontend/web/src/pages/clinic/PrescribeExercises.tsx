import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { Alert, Button, cx, Field, Input, Loader, Select, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

type Exercise = Schemas['ExerciseOut']
type Item = Schemas['PlanExerciseIn'] & { name: string; body_region: string; dose_unit: string }

const FREQ = [
  { value: 'daily', label: 'Daily' },
  { value: 'alternate_days', label: 'Alternate days' },
  { value: 'weekly_3x', label: '3× a week' },
  { value: 'weekly', label: 'Weekly' },
] as const

export default function PrescribeExercises() {
  const { id } = useParams()
  const { clinicId } = useClinic()
  const file = useQuery({ queryKey: ['patient-file', id], queryFn: () => api<Schemas['PatientFileOut']>(`/clinic/patients/${id}`, { clinicId }) })
  if (file.isLoading) return <Loader />
  if (!file.data) return <Alert>Patient not found.</Alert>
  if (!file.data.active_plan) {
    return (
      <div className="max-w-xl">
        <Alert tone="info">Start a care plan first — exercises are prescribed as part of a plan.</Alert>
        <Link to={`/clinic/patients/${id}/plan`} className="eyebrow mt-4 inline-block !text-ink underline">Start care plan →</Link>
      </div>
    )
  }
  return <Editor key={file.data.active_plan.id} patient={file.data} plan={file.data.active_plan} clinicId={clinicId} />
}

function Editor({ patient, plan, clinicId }: { patient: Schemas['PatientFileOut']; plan: Schemas['CarePlanOut']; clinicId: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [region, setRegion] = useState('')
  const [creating, setCreating] = useState(false)
  const search = useDeferredValue(q.trim())
  const [items, setItems] = useState<Item[]>(
    plan.exercises.map((e) => ({ exercise_id: e.exercise_id, name: e.name, body_region: e.body_region, dose_unit: e.dose_unit, sets: e.sets, reps: e.reps, hold_seconds: e.hold_seconds, rest_seconds: e.rest_seconds, frequency: e.frequency, times_per_day: e.times_per_day, notes: e.notes })),
  )

  const regions = useQuery({ queryKey: ['exercise-regions'], queryFn: () => api<string[]>('/clinic/exercises/regions', { clinicId }) })
  const library = useQuery({
    queryKey: ['exercise-library', search, region],
    queryFn: () => api<Schemas['ExercisePage']>('/clinic/exercises', { clinicId, query: { q: search, body_region: region, limit: 60 } }),
  })
  const save = useMutation({
    mutationFn: () =>
      api(`/clinic/care-plans/${plan.id}/exercises`, {
        method: 'PUT',
        clinicId,
        json: items.map(({ name: _n, body_region: _b, dose_unit: _d, ...rest }) => rest),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patient-file', patient.id] })
      navigate(`/clinic/patients/${patient.id}`)
    },
  })

  const add = (e: Exercise) => {
    if (items.some((i) => i.exercise_id === e.id)) return
    const seconds = e.dose_unit === 'seconds'
    setItems([...items, {
      exercise_id: e.id, name: e.name, body_region: e.body_region, dose_unit: e.dose_unit,
      sets: e.default_sets ?? 3, reps: seconds ? null : e.default_reps ?? 10, hold_seconds: seconds ? e.default_hold_seconds ?? 10 : null,
      rest_seconds: e.default_rest_seconds ?? 30, frequency: 'daily', times_per_day: 1, notes: null,
    }])
  }
  const update = (i: number, patch: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: number) => {
    const next = [...items]
    const [x] = next.splice(i, 1)
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x)
    setItems(next)
  }

  return (
    <div>
      <Link to={`/clinic/patients/${patient.id}`} className="eyebrow hover:underline">← {patient.full_name}</Link>
      <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Prescribe exercises</h1>
      <p className="text-[13.5px] text-muted">{plan.condition}{plan.stage ? ` · ${plan.stage}` : ''}</p>

      <div className="mt-6 grid gap-8 xl:grid-cols-[1fr_1.15fr]">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="eyebrow">Exercise library{library.data ? ` · ${library.data.total}` : ''}</h2>
            <button className="eyebrow !text-ink hover:underline" onClick={() => setCreating(!creating)}>{creating ? 'Close' : '+ Create your own'}</button>
          </div>
          {creating && <CreateExercise clinicId={clinicId} onCreated={(e) => { add(e); setCreating(false); void qc.invalidateQueries({ queryKey: ['exercise-library'] }) }} />}
          <div className="flex gap-2">
            <Input placeholder="Search knee, shoulder, balance…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search exercises" />
            <Select value={region} onChange={(e) => setRegion(e.target.value)} className="!w-40" aria-label="Body region">
              <option value="">All regions</option>
              {regions.data?.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
            </Select>
          </div>
          {library.isLoading ? <Loader /> : library.data?.items.length === 0 ? (
            <p className="py-8 text-[14px] text-muted">
              No published exercises match. Exercises appear here once the Physionexs team publishes them — or create your own.
            </p>
          ) : (
            <ul className="mt-3 max-h-[640px] divide-y divide-line overflow-y-auto border-y border-line">
              {library.data?.items.map((e) => {
                const added = items.some((i) => i.exercise_id === e.id)
                return (
                  <li key={e.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold">{e.name}{e.visibility === 'clinic' && <span className="eyebrow ml-2">Your clinic</span>}</p>
                      <p className="text-[12.5px] text-muted">{[e.body_region, e.category, e.position?.replace('_', ' '), (e.equipment ?? []).join(', ')].filter(Boolean).join(' · ')}</p>
                      {e.cues && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{e.cues}</p>}
                    </div>
                    <button
                      onClick={() => add(e)}
                      disabled={added}
                      className={cx('h-8 shrink-0 border px-3 text-[12.5px]', added ? 'border-line text-subtle' : 'border-ink hover:bg-ink hover:text-white')}
                    >
                      {added ? 'Added' : 'Add'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="eyebrow mb-3">Program · {patient.full_name} · {items.length} exercise{items.length === 1 ? '' : 's'}</h2>
          {items.length === 0 ? (
            <p className="border border-dashed border-line-strong p-6 text-[14px] text-muted">Add exercises from the library.</p>
          ) : (
            <ol className="space-y-3">
              {items.map((it, i) => (
                <li key={it.exercise_id} className="border border-line p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[14.5px] font-semibold"><span className="mr-2 text-muted">{i + 1}.</span>{it.name}</p>
                    <div className="flex shrink-0 gap-1 text-[13px] text-muted">
                      <button onClick={() => move(i, -1)} aria-label="Move up" className="px-1 hover:text-ink">↑</button>
                      <button onClick={() => move(i, 1)} aria-label="Move down" className="px-1 hover:text-ink">↓</button>
                      <button onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove" className="px-1 hover:text-danger">✕</button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Num label="Sets" value={it.sets} onChange={(v) => update(i, { sets: v ?? 1 })} />
                    {it.dose_unit === 'seconds'
                      ? <Num label="Hold (s)" value={it.hold_seconds} onChange={(v) => update(i, { hold_seconds: v, reps: null })} />
                      : <Num label="Reps" value={it.reps} onChange={(v) => update(i, { reps: v, hold_seconds: null })} />}
                    <Num label="Rest (s)" value={it.rest_seconds} onChange={(v) => update(i, { rest_seconds: v ?? 0 })} />
                    <Field label="Frequency">
                      <Select value={it.frequency} onChange={(e) => update(i, { frequency: e.target.value as Item['frequency'] })} className="!h-10">
                        {FREQ.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <Input className="mt-3 !h-10" placeholder="Note for the patient (optional)" value={it.notes ?? ''} onChange={(e) => update(i, { notes: e.target.value || null })} />
                </li>
              ))}
            </ol>
          )}
          {save.error && <div className="mt-3"><Alert>{(save.error as Error).message}</Alert></div>}
          <Button className="mt-5 w-full" onClick={() => save.mutate()} loading={save.isPending}>Assign to patient app</Button>
        </section>
      </div>
    </div>
  )
}

function Num({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <Field label={label}>
      <Input type="number" min={0} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className="!h-10" />
    </Field>
  )
}

function CreateExercise({ clinicId, onCreated }: { clinicId: string; onCreated: (e: Exercise) => void }) {
  const [f, setF] = useState({ name: '', body_region: 'knee', category: 'strength', steps: '', cues: '', precautions: '', dose_unit: 'reps' })
  const create = useMutation({
    mutationFn: () =>
      api<Exercise>('/clinic/exercises', {
        method: 'POST',
        clinicId,
        json: {
          name: f.name, body_region: f.body_region.trim().toLowerCase(), category: f.category, dose_unit: f.dose_unit,
          default_reps: f.dose_unit === 'reps' ? 10 : null, default_hold_seconds: f.dose_unit === 'seconds' ? 20 : null,
          steps: f.steps.split('\n').map((s) => s.trim()).filter(Boolean), cues: f.cues || null, precautions: f.precautions || null,
        },
      }),
    onSuccess: onCreated,
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="mb-4 grid gap-3 border border-line p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
      <div className="sm:col-span-2"><Field label="Name"><Input value={f.name} onChange={set('name')} required minLength={3} /></Field></div>
      <Field label="Body region"><Input value={f.body_region} onChange={set('body_region')} required /></Field>
      <Field label="Category">
        <Select value={f.category} onChange={set('category')}>
          {['strength', 'mobility', 'stretch', 'balance', 'proprioception', 'endurance', 'breathing', 'functional'].map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Field>
      <div className="sm:col-span-2"><Field label="Steps" hint="One per line"><Textarea value={f.steps} onChange={set('steps')} required /></Field></div>
      <Field label="Key cues"><Input value={f.cues} onChange={set('cues')} /></Field>
      <Field label="Dosed by">
        <Select value={f.dose_unit} onChange={set('dose_unit')}><option value="reps">Reps</option><option value="seconds">Hold time</option></Select>
      </Field>
      <div className="sm:col-span-2"><Field label="Precautions"><Input value={f.precautions} onChange={set('precautions')} /></Field></div>
      {create.error && <div className="sm:col-span-2"><Alert>{(create.error as Error).message}</Alert></div>}
      <div className="sm:col-span-2"><Button type="submit" loading={create.isPending}>Save to your clinic library</Button></div>
    </form>
  )
}
