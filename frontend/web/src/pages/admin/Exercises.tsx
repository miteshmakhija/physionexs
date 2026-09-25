import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Button, cx, Field, Input, Loader, Select, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

type Exercise = Schemas['ExerciseOut']
type Status = Exercise['status']

const TABS: { value: Status; label: string }[] = [
  { value: 'in_review', label: 'Awaiting review' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
]
const CATEGORIES = ['strength', 'mobility', 'stretch', 'balance', 'proprioception', 'endurance', 'breathing', 'functional']
const POSITIONS = ['standing', 'sitting', 'supine', 'prone', 'side_lying', 'quadruped', 'kneeling']

export function AdminExerciseList() {
  const [tab, setTab] = useState<Status>('in_review')
  const [q, setQ] = useState('')
  const search = useDeferredValue(q.trim())
  const list = useQuery({
    queryKey: ['admin-exercises', tab, search],
    queryFn: () => api<Schemas['ExercisePage']>('/admin/exercises', { query: { status: tab, q: search, limit: 100 } }),
  })
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Exercise library"
        subtitle="Every exercise is reviewed by a Physionexs physiotherapist before patients can see it."
        actions={<Link to="/admin/exercises/new" className="flex h-11 items-center bg-ink px-5 text-[12.5px] font-semibold uppercase tracking-[0.09em] text-white hover:bg-ink-2">Add exercise</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-4 border-b border-line">
        {TABS.map((t) => (
          <button key={t.value} onClick={() => setTab(t.value)} className={cx('-mb-px border-b-2 pb-2 text-[13px] font-semibold', tab === t.value ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {t.label}
          </button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="!mb-2 ml-auto !h-9 !w-64" aria-label="Search exercises" />
      </div>
      {list.isLoading ? <Loader /> : list.data?.items.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-muted">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.data?.items.map((e) => (
            <li key={e.id}>
              <Link to={`/admin/exercises/${e.id}`} className="flex items-center gap-4 py-3 hover:bg-surface-2 sm:px-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">{e.name}</p>
                  <p className="text-[12.5px] text-muted">{[e.body_region, e.category, e.source === 'clinic' ? 'Submitted by a clinic' : null].filter(Boolean).join(' · ')}</p>
                </div>
                {e.review_note && <span className="hidden max-w-xs truncate text-[12.5px] text-muted sm:block">{e.review_note}</span>}
                <span className="eyebrow">{e.media.length ? `${e.media.length} media` : 'No media'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[12.5px] text-muted">{list.data?.total ?? 0} exercise(s). Photos and videos can be attached once media upload is enabled.</p>
    </div>
  )
}

export function AdminExerciseEditor() {
  const { id } = useParams()
  const isNew = id === 'new'
  const q = useQuery({ queryKey: ['admin-exercise', id], queryFn: () => api<Exercise>(`/admin/exercises/${id}`), enabled: !isNew })
  if (!isNew && q.isLoading) return <Loader />
  if (!isNew && !q.data) return <Alert>Exercise not found.</Alert>
  return <Editor key={id} exercise={isNew ? null : q.data!} />
}

function Editor({ exercise }: { exercise: Exercise | null }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [f, setF] = useState({
    name: exercise?.name ?? '',
    body_region: exercise?.body_region ?? '',
    category: exercise?.category ?? 'strength',
    position: exercise?.position ?? '',
    equipment: exercise?.equipment?.join(', ') ?? '',
    difficulty: String(exercise?.difficulty ?? 1),
    dose_unit: exercise?.dose_unit ?? 'reps',
    default_sets: String(exercise?.default_sets ?? 3),
    default_reps: exercise?.default_reps?.toString() ?? '10',
    default_hold_seconds: exercise?.default_hold_seconds?.toString() ?? '',
    default_rest_seconds: String(exercise?.default_rest_seconds ?? 30),
    steps: exercise?.steps?.join('\n') ?? '',
    cues: exercise?.cues ?? '',
    common_mistakes: exercise?.common_mistakes ?? '',
    precautions: exercise?.precautions ?? '',
    contraindications: exercise?.contraindications ?? '',
    conditions: exercise?.conditions?.join(', ') ?? '',
  })
  const [note, setNote] = useState('')
  const body = () => {
    const seconds = f.dose_unit === 'seconds'
    const list = (s: string, sep = ',') => s.split(sep).map((x) => x.trim()).filter(Boolean)
    return {
      name: f.name, body_region: f.body_region.trim().toLowerCase(), category: f.category, position: f.position || null,
      equipment: list(f.equipment), difficulty: Number(f.difficulty), dose_unit: f.dose_unit,
      default_sets: Number(f.default_sets), default_reps: seconds ? null : Number(f.default_reps) || null,
      default_hold_seconds: seconds ? Number(f.default_hold_seconds) || null : null, default_rest_seconds: Number(f.default_rest_seconds),
      steps: list(f.steps, '\n'), cues: f.cues || null, common_mistakes: f.common_mistakes || null,
      precautions: f.precautions || null, contraindications: f.contraindications || null, conditions: list(f.conditions),
    }
  }
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['admin-exercises'] })
    navigate('/admin/exercises')
  }
  const save = useMutation({
    mutationFn: () => (exercise ? api<Exercise>(`/admin/exercises/${exercise.id}`, { method: 'PUT', json: body() }) : api<Exercise>('/admin/exercises', { method: 'POST', json: body() })),
    onSuccess: done,
  })
  const decide = useMutation({
    mutationFn: async (publish: boolean) => {
      if (exercise && exercise.source === 'platform') await api(`/admin/exercises/${exercise.id}`, { method: 'PUT', json: body() })
      return api<Exercise>(`/admin/exercises/${exercise!.id}/${publish ? 'publish' : 'reject'}`, { method: 'POST', json: { note: note || null } })
    },
    onSuccess: done,
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const error = (save.error ?? decide.error) as Error | null

  return (
    <div className="max-w-4xl">
      <Link to="/admin/exercises" className="eyebrow hover:underline">← Exercise library</Link>
      <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">{exercise ? exercise.name : 'Add exercise'}</h1>
      {exercise && <p className="eyebrow mt-1">{exercise.status.replace('_', ' ')} · {exercise.source}{exercise.review_note ? ` · ${exercise.review_note}` : ''}</p>}

      <form className="mt-6 grid gap-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <div className="sm:col-span-2"><Field label="Name"><Input value={f.name} onChange={set('name')} required minLength={3} /></Field></div>
        <Field label="Body region"><Input value={f.body_region} onChange={set('body_region')} required placeholder="knee" /></Field>
        <Field label="Category"><Select value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Position"><Select value={f.position} onChange={set('position')}><option value="">—</option>{POSITIONS.map((p) => <option key={p} value={p}>{p.replace('_', ' ')}</option>)}</Select></Field>
        <Field label="Difficulty (1–5)"><Input type="number" min={1} max={5} value={f.difficulty} onChange={set('difficulty')} /></Field>
        <Field label="Equipment" hint="Comma separated"><Input value={f.equipment} onChange={set('equipment')} /></Field>
        <Field label="Dosed by"><Select value={f.dose_unit} onChange={set('dose_unit')}><option value="reps">Reps</option><option value="seconds">Hold time</option></Select></Field>
        <Field label="Default sets"><Input type="number" min={1} value={f.default_sets} onChange={set('default_sets')} /></Field>
        {f.dose_unit === 'seconds'
          ? <Field label="Default hold (s)"><Input type="number" min={1} value={f.default_hold_seconds} onChange={set('default_hold_seconds')} required /></Field>
          : <Field label="Default reps"><Input type="number" min={1} value={f.default_reps} onChange={set('default_reps')} required /></Field>}
        <Field label="Rest (s)"><Input type="number" min={0} value={f.default_rest_seconds} onChange={set('default_rest_seconds')} /></Field>
        <div className="sm:col-span-3"><Field label="Steps" hint="One step per line, in order"><Textarea rows={5} value={f.steps} onChange={set('steps')} required /></Field></div>
        <div className="sm:col-span-3"><Field label="Key cues"><Textarea rows={2} value={f.cues} onChange={set('cues')} /></Field></div>
        <div className="sm:col-span-3"><Field label="Common mistakes"><Textarea rows={2} value={f.common_mistakes} onChange={set('common_mistakes')} /></Field></div>
        <div className="sm:col-span-3 grid gap-4 sm:grid-cols-2">
          <Field label="Precautions"><Textarea rows={2} value={f.precautions} onChange={set('precautions')} /></Field>
          <Field label="Contraindications"><Textarea rows={2} value={f.contraindications} onChange={set('contraindications')} /></Field>
        </div>
        <div className="sm:col-span-3"><Field label="Suggested for conditions" hint="Comma separated — used in search"><Input value={f.conditions} onChange={set('conditions')} /></Field></div>

        {error && <div className="sm:col-span-3"><Alert>{error.message}</Alert></div>}
        <div className="flex flex-wrap gap-3 sm:col-span-3">
          <Button type="submit" variant={exercise ? 'secondary' : 'primary'} loading={save.isPending}>{exercise ? 'Save changes' : 'Create (goes to review)'}</Button>
        </div>
      </form>

      {exercise && exercise.status !== 'published' ? (
        <section className="mt-8 border-t border-line pt-6">
          <h2 className="eyebrow mb-3">Clinical review</h2>
          <p className="mb-3 text-[13.5px] text-muted">Publishing makes this exercise available to every clinic and visible to patients it's prescribed to. Check the steps, dosing and precautions first.</p>
          <Field label="Review note" hint="Required when rejecting; sent back to the author."><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="mt-3 flex gap-3">
            <Button onClick={() => decide.mutate(true)} loading={decide.isPending && decide.variables === true}>Approve & publish</Button>
            <Button variant="secondary" onClick={() => decide.mutate(false)} disabled={!note.trim()} loading={decide.isPending && decide.variables === false}>Reject</Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
