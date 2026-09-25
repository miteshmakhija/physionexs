import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { Adherence } from '@/components/clinical'
import { Alert, Avatar, Button, Field, Input, Loader, Select, Stat, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'

type File = Schemas['PatientFileOut']
type Plan = Schemas['CarePlanOut']

export default function PatientFile() {
  const { id } = useParams()
  const { clinicId, isOwner, role } = useClinic()
  const canWrite = isOwner || role === 'physio'
  const q = useQuery({ queryKey: ['patient-file', id], queryFn: () => api<File>(`/clinic/patients/${id}`, { clinicId }) })
  const rx = useQuery({ queryKey: ['patient-rx', id], queryFn: () => api<Schemas['PrescriptionOut'][]>(`/clinic/patients/${id}/prescriptions`, { clinicId }) })

  if (q.isLoading) return <Loader />
  if (!q.data) return <Alert>{(q.error as Error)?.message ?? 'Patient not found'}</Alert>
  const p = q.data
  const plan = p.active_plan

  return (
    <div className="max-w-5xl">
      <Link to="/clinic/patients" className="eyebrow hover:underline">← Patients</Link>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Avatar name={p.full_name} className="size-14 text-[16px]" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-bold tracking-[-0.02em]">{p.full_name}</h1>
          <p className="text-[13.5px] text-muted">
            {[p.age != null ? `${p.age} yrs` : null, p.sex, plan?.condition, p.phone].filter(Boolean).join(' · ')}
            {p.has_app && ' · Uses the Physionexs app'}
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Link to={`/clinic/patients/${p.id}/plan`} className="flex h-11 items-center border border-ink px-4 text-[12.5px] font-semibold uppercase tracking-[0.09em] hover:bg-surface-2">
              {plan ? 'Edit plan' : 'Start care plan'}
            </Link>
            <Link to={`/clinic/patients/${p.id}/consult`} className="flex h-11 items-center bg-ink px-4 text-[12.5px] font-semibold uppercase tracking-[0.09em] text-white hover:bg-ink-2">
              Start consultation
            </Link>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Exercise adherence" value={<Adherence pct={p.adherence_7d} />} sub="last 7 days" />
        <Stat label="Pain level" value={p.latest_pain != null ? `${p.latest_pain}/10` : '—'} sub={p.first_pain != null && p.first_pain !== p.latest_pain ? `from ${p.first_pain}/10 at first visit` : 'VAS, from consultation notes'} />
        <Stat label="Sessions" value={plan?.sessions_planned ? `${p.sessions_done} of ${plan.sessions_planned}` : p.sessions_done} sub="treatment plan" />
      </div>

      {plan ? <PlanSection plan={plan} cpId={p.id} canWrite={canWrite} clinicId={clinicId} /> : (
        <Section title="Current plan">
          <p className="text-[14px] text-muted">No active care plan. {canWrite && 'Start one to prescribe exercises and medicines to the patient app.'}</p>
        </Section>
      )}

      <Section title="Visit history">
        {p.consultations.length === 0 ? (
          <p className="text-[14px] text-muted">No consultation notes yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {p.consultations.map((c) => (
              <li key={c.id} className="py-3 text-[14px]">
                <p className="font-semibold">
                  {c.title} · {dayLabel(c.created_at)}
                  <span className="ml-2 font-normal text-muted">{c.physio_name}{c.signed_at ? ' · Signed' : ' · Draft'}</span>
                  {c.pain_vas != null && <span className="ml-2 font-normal text-muted">· Pain {c.pain_vas}/10</span>}
                </p>
                {c.assessment && <p className="mt-1 text-ink-2"><span className="text-muted">A:</span> {c.assessment}</p>}
                {c.plan && <p className="text-ink-2"><span className="text-muted">P:</span> {c.plan}</p>}
                {!c.signed_at && canWrite && <Link to={`/clinic/patients/${p.id}/consult?note=${c.id}`} className="eyebrow mt-1 inline-block !text-ink underline">Continue draft</Link>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <BackgroundSection file={p} canWrite={canWrite} clinicId={clinicId} />

      <Section title="Prescriptions">
        {!rx.data?.length ? (
          <p className="text-[14px] text-muted">None issued yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rx.data.map((r) => (
              <li key={r.id} className="flex justify-between py-2.5 text-[14px]">
                <Link to={`/clinic/prescriptions/${r.id}`} className="font-semibold hover:underline">{r.rx_no}</Link>
                <span className="text-muted">{dayLabel(r.issued_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function PlanSection({ plan, cpId, canWrite, clinicId }: { plan: Plan; cpId: string; canWrite: boolean; clinicId: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const issue = useMutation({
    mutationFn: () => api<Schemas['PrescriptionOut']>(`/clinic/care-plans/${plan.id}/prescriptions`, { method: 'POST', clinicId }),
    onSuccess: (rx) => navigate(`/clinic/prescriptions/${rx.id}`),
  })
  const result = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api(`/clinic/tests/${id}`, { method: 'PATCH', clinicId, json: { status: 'result_ready', result_note: note } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient-file', cpId] }),
  })

  return (
    <Section
      title="Current plan"
      action={canWrite && <Button variant="secondary" loading={issue.isPending} onClick={() => issue.mutate()}>Generate prescription</Button>}
    >
      <div className="grid gap-4 text-[14px] sm:grid-cols-3">
        <Info label="Diagnosis" value={[plan.condition, plan.condition_detail].filter(Boolean).join(' — ')} />
        <Info label="Goal" value={plan.goal ?? '—'} />
        <Info label="Stage" value={plan.stage ?? '—'} />
      </div>
      {plan.notes && <p className="mt-4 whitespace-pre-line text-[14px] text-ink-2"><span className="text-muted">Advice to patient: </span>{plan.notes}</p>}

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[14px] font-semibold">Exercises</h3>
            {canWrite && <Link to={`/clinic/patients/${cpId}/exercises`} className="eyebrow !text-ink hover:underline">Prescribe →</Link>}
          </div>
          {plan.exercises.length === 0 ? <p className="text-[13.5px] text-muted">None yet.</p> : (
            <ul className="divide-y divide-line border-y border-line text-[13.5px]">
              {plan.exercises.map((e) => (
                <li key={e.id} className="flex justify-between gap-3 py-2">
                  <span>{e.name}</span>
                  <span className="text-muted">{e.sets} × {e.reps ?? `${e.hold_seconds}s`} · {e.frequency.replace('_', ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[14px] font-semibold">Medicines & tests</h3>
            {canWrite && <Link to={`/clinic/patients/${cpId}/medicines`} className="eyebrow !text-ink hover:underline">Prescribe →</Link>}
          </div>
          {plan.medications.length === 0 && plan.tests.length === 0 ? <p className="text-[13.5px] text-muted">None yet.</p> : (
            <ul className="divide-y divide-line border-y border-line text-[13.5px]">
              {plan.medications.map((m) => (
                <li key={m.id} className="flex justify-between gap-3 py-2">
                  <span>{m.name}</span>
                  <span className="text-muted">{m.frequency}{m.duration_days ? ` · ${m.duration_days} days` : ''}</span>
                </li>
              ))}
              {plan.tests.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{t.name} <span className="text-muted">· test</span></span>
                  {t.status === 'result_ready' ? (
                    <span className="text-leaf-dark">Result ready{t.result_note ? ` — ${t.result_note}` : ''}</span>
                  ) : canWrite ? (
                    <button
                      className="eyebrow !text-ink hover:underline"
                      onClick={() => {
                        const note = window.prompt(`Result summary for ${t.name} (shared with the patient):`)
                        if (note !== null) result.mutate({ id: t.id, note })
                      }}
                    >
                      Add result
                    </button>
                  ) : <span className="text-muted">Ordered</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {issue.error && <div className="mt-3"><Alert>{(issue.error as Error).message}</Alert></div>}
    </Section>
  )
}

function BackgroundSection({ file, canWrite, clinicId }: { file: File; canWrite: boolean; clinicId: string }) {
  const qc = useQueryClient()
  const bg = file.background
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState({
    past_history: bg?.past_history ?? '',
    conditions: (bg?.conditions ?? []).join(', '),
    prior_medicines: (bg?.prior_medicines ?? []).map((m) => [m.name, m.frequency].filter(Boolean).join(' · ')).join('\n'),
    core_strengths: bg?.core_strengths ?? '',
    weaknesses: bg?.weaknesses ?? '',
    core_grade: bg?.core_grade ?? '',
  })
  const save = useMutation({
    mutationFn: () =>
      api(`/clinic/patients/${file.id}/background`, {
        method: 'PUT',
        clinicId,
        json: {
          past_history: f.past_history || null,
          conditions: f.conditions.split(',').map((x) => x.trim()).filter(Boolean),
          prior_medicines: f.prior_medicines.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const [name, frequency] = l.split('·').map((x) => x.trim())
            return { name, frequency: frequency || null }
          }),
          core_strengths: f.core_strengths || null,
          weaknesses: f.weaknesses || null,
          core_grade: f.core_grade || null,
        },
      }),
    onSuccess: () => {
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['patient-file', file.id] })
    },
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <Section title="Medical background & functional analysis" action={canWrite && !editing && <button className="eyebrow !text-ink hover:underline" onClick={() => setEditing(true)}>Edit</button>}>
      {editing ? (
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <div className="sm:col-span-2"><Field label="Past medical & injury history"><Textarea value={f.past_history} onChange={set('past_history')} /></Field></div>
          <Field label="Known conditions / diseases" hint="Comma separated"><Input value={f.conditions} onChange={set('conditions')} placeholder="Hypertension, Type 2 diabetes" /></Field>
          <Field label="Core strength grade">
            <Select value={f.core_grade} onChange={set('core_grade')}>
              <option value="">—</option>
              {['poor', 'fair', 'good', 'strong'].map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2"><Field label="Medicines already prescribed" hint="One per line, e.g. “Metformin 500 · 0-0-1”"><Textarea value={f.prior_medicines} onChange={set('prior_medicines')} /></Field></div>
          <Field label="Core strengths"><Textarea value={f.core_strengths} onChange={set('core_strengths')} /></Field>
          <Field label="Weaknesses & deficits"><Textarea value={f.weaknesses} onChange={set('weaknesses')} /></Field>
          <div className="flex gap-3 sm:col-span-2">
            <Button type="submit" loading={save.isPending}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
          {save.error && <div className="sm:col-span-2"><Alert>{(save.error as Error).message}</Alert></div>}
        </form>
      ) : !bg ? (
        <p className="text-[14px] text-muted">Not recorded yet.</p>
      ) : (
        <dl className="grid gap-x-8 gap-y-4 text-[14px] sm:grid-cols-2">
          <Info label="Past history" value={bg.past_history ?? '—'} />
          <Info label="Conditions / diseases" value={bg.conditions?.join(', ') || '—'} />
          <Info label="Prior medicines" value={bg.prior_medicines?.map((m) => [m.name, m.frequency].filter(Boolean).join(' ')).join(' · ') || '—'} />
          <Info label="Core strength grade" value={bg.core_grade ? bg.core_grade[0].toUpperCase() + bg.core_grade.slice(1) : '—'} />
          <Info label="Core strengths" value={bg.core_strengths ?? '—'} />
          <Info label="Weaknesses & deficits" value={bg.weaknesses ?? '—'} />
        </dl>
      )}
    </Section>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line">{value}</dd>
    </div>
  )
}
