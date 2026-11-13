import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { SectionForm, StepNav, type Step } from '@/components/assessment'
import { Alert, Button, Field, Input, Loader, Segmented, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import {
  FORM_VERSION,
  conditionsWithHistory,
  feedsRecovery,
  historyFromConditions,
  needsScreening,
  progressOf,
  regionOf,
  sectionsFor,
  soapFromAssessment,
  type FormSection,
  type FormValues,
  type SectionValues,
  type VisitType,
} from '@shared/assessment'

type Note = Schemas['ConsultationOut']
type FormDef = Schemas['AssessmentFormOut']
type YesNo = 'yes' | 'no'
type RedFlagAction = 'referred' | 'medical_review'
type StoredForm = { visit_type?: VisitType; red_flags?: Record<string, YesNo>; red_flag_action?: RedFlagAction | null; red_flag_note?: string | null; sections?: Record<string, unknown> }
type Screening = { flags: Record<string, YesNo>; action: RedFlagAction | null; note: string }

// Common physio measures; free-form extras can be added below.
const VITALS = [
  { key: 'rom', label: 'Range of motion', placeholder: 'Knee flexion 0–120°' },
  { key: 'strength', label: 'Strength (MMT)', placeholder: 'Quads 4/5' },
  { key: 'swelling', label: 'Swelling', placeholder: 'Mild' },
  { key: 'special_tests', label: 'Special tests', placeholder: 'Valgus stress: mild laxity' },
]

export default function Consultation() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const draftId = params.get('note')
  const { clinicId, twinPilot, aiAssist } = useClinic()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const file = useQuery({ queryKey: ['patient-file', id], queryFn: () => api<Schemas['PatientFileOut']>(`/clinic/patients/${id}`, { clinicId }) })

  const formDef = useQuery({ queryKey: ['assessment-form'], queryFn: () => api<FormDef>('/clinic/assessment-form', { clinicId }), staleTime: Infinity })

  if (file.isLoading || formDef.isLoading) return <Loader />
  if (!file.data) return <Alert>Patient not found.</Alert>
  if (!formDef.data) return <Alert>Couldn’t load the assessment form. Refresh to try again.</Alert>
  const draft = draftId ? file.data.consultations.find((c) => c.id === draftId && !c.signed_at) : undefined

  return (
    <NoteForm
      key={draft?.id ?? 'new'}
      patient={file.data}
      draft={draft}
      formDef={formDef.data}
      onSaved={(signed) => {
        void qc.invalidateQueries({ queryKey: ['patient-file', id] })
        if (signed) navigate(`/clinic/patients/${id}`)
      }}
      clinicId={clinicId}
      twinPilot={twinPilot}
      aiAssist={aiAssist}
    />
  )
}

function NoteForm({ patient, draft, formDef, onSaved, clinicId, twinPilot, aiAssist }: { patient: Schemas['PatientFileOut']; draft?: Note; formDef: FormDef; onSaved: (signed: boolean) => void; clinicId: string; twinPilot: boolean; aiAssist: boolean }) {
  const [noteId, setNoteId] = useState(draft?.id ?? null)
  const stored = (draft?.assessment_form ?? {}) as StoredForm
  const firstVisit = !patient.consultations.some((c) => c.id !== draft?.id)
  const [visitType, setVisitType] = useState<VisitType>(stored.visit_type ?? (firstVisit ? 'initial' : 'follow_up'))
  const [screen, setScreen] = useState<Screening>({ flags: stored.red_flags ?? {}, action: stored.red_flag_action ?? null, note: stored.red_flag_note ?? '' })
  const screening = needsScreening(visitType)
  const unanswered = formDef.red_flags.filter((f) => !screen.flags[f.code]).length
  const positive = formDef.red_flags.some((f) => screen.flags[f.code] === 'yes')
  const signBlock = !screening ? null
    : unanswered ? `Answer all red-flag questions to sign (${unanswered} left).`
    : positive && !screen.action ? 'Record the referral or medical review to sign.'
    : null
  // Structured answers: a draft's own, else carried forward from the last assessment and the medical background.
  const [values, setValues] = useState<FormValues>(() => stored.sections as FormValues | undefined ?? prefill(patient, draft?.id))
  const steps = useMemo(() => {
    const sections = sectionsFor(visitType)
    const at = sections.findIndex((s) => s.id === 'history') + 1 || 1
    const list: ({ kind: 'section'; section: FormSection } | { kind: 'red_flags' } | { kind: 'note' })[] = sections.map((section) => ({ kind: 'section', section }))
    if (screening) list.splice(at, 0, { kind: 'red_flags' })
    return [...list, { kind: 'note' as const }]
  }, [visitType, screening])
  const [stepIdx, setStepIdx] = useState(0)
  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const region = regionOf(values)
  const [soap, setSoap] = useState({
    subjective: draft?.subjective ?? '',
    objective: draft?.objective ?? '',
    assessment: draft?.assessment ?? patient.active_plan?.condition ?? '',
    plan: draft?.plan ?? '',
  })
  const redFlagLine = () => {
    if (!screening || unanswered) return undefined
    const yes = formDef.red_flags.filter((f) => screen.flags[f.code] === 'yes').map((f) => f.label.toLowerCase())
    if (!yes.length) return 'Red-flag screening: no red flags identified.'
    const action = formDef.red_flag_actions.find((a) => a.code === screen.action)?.label
    return `Red-flag screening: ${yes.join(', ')}.${action ? ` ${action}${screen.note.trim() ? ` (${screen.note.trim()})` : ''}.` : ''}`
  }
  const drafted = (onlyEmpty: boolean): typeof soap => {
    const g = soapFromAssessment(values, visitType, redFlagLine())
    return Object.fromEntries((Object.keys(soap) as (keyof typeof soap)[]).map((k) => [k, onlyEmpty && soap[k].trim() ? soap[k] : g[k] || soap[k]])) as typeof soap
  }
  const fillSoap = (onlyEmpty: boolean) => setSoap(drafted(onlyEmpty))
  const goTo = (i: number) => {
    // Arriving at the note fills any S/O/A/P box that is still empty; typed text is never replaced silently.
    if (steps[i]?.kind === 'note') fillSoap(true)
    setStepIdx(i)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const stepInfo: Step[] = steps.map((s) => {
    if (s.kind === 'red_flags') return { id: 'red_flags', title: 'Red flags', required: true, done: !signBlock, started: unanswered < formDef.red_flags.length }
    if (s.kind === 'note') return { id: 'note', title: 'SOAP note', done: !!(soap.subjective.trim() || soap.objective.trim()), started: false }
    const p = progressOf(s.section, values[s.section.id])
    return { id: s.section.id, title: s.section.title, done: p.total > 0 && p.answered === p.total, started: p.answered > 0 }
  })
  const [vitals, setVitals] = useState<Record<string, string>>(Object.fromEntries(Object.entries(draft?.vitals ?? {}).map(([k, v]) => [k, String(v)])))
  const [pain, setPain] = useState<number | null>(draft?.pain_vas ?? null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const plan = patient.active_plan
  const kneeSides: ('left' | 'right')[] = twinPilot && plan?.protocol === 'tka' ? (plan.affected_side === 'both' ? ['right', 'left'] : plan.affected_side ? [plan.affected_side] : []) : []
  // Knee ROM degrees and MRC grades are saved to recovery tracking by the backend when the note is signed.
  const tracksKnee = twinPilot && feedsRecovery(region)
  const recoveryNote = (id: string) => tracksKnee && (id === 'rom' || id === 'strength')
    ? `Knee ${id === 'rom' ? 'flexion and extension lag (°)' : 'flexion and extension grades'} are saved to recovery tracking when you sign.`
    : undefined

  const save = useMutation({
    mutationFn: async ({ sign, text }: { sign: boolean; text: typeof soap }) => {
      const assessment_form = {
        version: FORM_VERSION, visit_type: visitType, sections: values,
        red_flags: screen.flags, red_flag_action: positive ? screen.action : null,
        red_flag_note: positive && screen.note.trim() ? screen.note.trim() : null,
      }
      const intensity = values.complaints?.pain === 'yes' ? values.complaints.pain_intensity as number | undefined : undefined
      const json = { ...text, vitals: Object.fromEntries(Object.entries(vitals).filter(([, v]) => v.trim())), pain_vas: pain ?? intensity ?? null, assessment_form, sign }
      const n = await (noteId
        ? api<Note>(`/clinic/consultations/${noteId}`, { method: 'PUT', clinicId, json })
        : api<Note>(`/clinic/patients/${patient.id}/consultations`, { method: 'POST', clinicId, json }))
      setNoteId(n.id)
      // Signed history adds new conditions to the medical background (additive only; nothing is removed).
      if (sign && values.history) {
        const before = patient.background?.conditions ?? []
        const after = conditionsWithHistory(values.history, before)
        if (after.length > before.length) {
          await api(`/clinic/patients/${patient.id}/background`, { method: 'PUT', clinicId, json: { ...(patient.background ?? {}), conditions: after.slice(0, 30) } })
        }
      }
      return n
    },
    onSuccess: (_n, { sign }) => {
      setSavedAt(new Date())
      onSaved(sign)
    },
  })
  const set = (k: keyof typeof soap) => (e: { target: { value: string } }) => setSoap({ ...soap, [k]: e.target.value })
  const draftO = useMutation({
    mutationFn: () => api<{ text: string }>(`/clinic/ai/patients/${patient.id}/objective`, { method: 'POST', clinicId }),
    onSuccess: (r) => setSoap((s) => ({ ...s, objective: r.text })),
  })
  const bg = patient.background

  return (
    <div className="max-w-5xl">
      <Link to={`/clinic/patients/${patient.id}`} className="eyebrow hover:underline">← {patient.full_name}</Link>
      <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Consultation note</h1>
      <p className="text-[13.5px] text-muted">SOAP note · {patient.full_name}{patient.active_plan ? ` · ${patient.active_plan.condition}` : ''}</p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          <Field label="Assessment type">
            <Segmented<VisitType> value={visitType} onChange={(v) => { setVisitType(v); setStepIdx(0) }} options={formDef.visit_types.map((v) => ({ value: v.code as VisitType, label: v.label }))} />
          </Field>
          <StepNav steps={stepInfo} current={Math.min(stepIdx, steps.length - 1)} onSelect={goTo} />

          <div className="border-t border-line pt-5">
            <h2 className="mb-4 text-[18px] font-bold tracking-[-0.01em]">
              {step.kind === 'section' ? step.section.title : step.kind === 'red_flags' ? 'Red-flag screening' : 'SOAP note'}
            </h2>
            {step.kind === 'section' && (
              <SectionForm section={step.section} values={values[step.section.id] ?? {}} region={region} note={recoveryNote(step.section.id)}
                onChange={(v) => setValues((all) => ({ ...all, [step.section.id]: v }))} />
            )}
            {step.kind === 'red_flags' && <RedFlagScreening formDef={formDef} value={screen} onChange={setScreen} />}
            {step.kind === 'note' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13px] text-muted">Drafted from the assessment. Edit freely; this text is what visit history and prescriptions show.</p>
                  <button type="button" className="text-[12.5px] font-semibold text-ink underline"
                    onClick={() => (!Object.values(soap).some((t) => t.trim()) || window.confirm('Replace the S/O/A/P text with a fresh draft from the assessment?')) && fillSoap(false)}>
                    Redraft from assessment
                  </button>
                </div>
          <Field label="S — Subjective"><Textarea rows={4} value={soap.subjective} onChange={set('subjective')} placeholder="What the patient reports: pain, function, sleep, response to last session…" /></Field>
          <Field label="O — Objective" hint={aiAssist && kneeSides.length ? 'AI drafts are a starting point — check every line before signing.' : undefined}>
            <Textarea rows={3} value={soap.objective} onChange={set('objective')} placeholder="Observation, palpation, ROM, strength, special tests…" />
          </Field>
          {aiAssist && kneeSides.length > 0 && (
            <div className="-mt-3">
              <button type="button" className="text-[12.5px] font-semibold text-violet underline disabled:opacity-60" disabled={draftO.isPending}
                onClick={() => (!soap.objective.trim() || window.confirm('Replace the Objective text with an AI draft?')) && draftO.mutate()}>
                {draftO.isPending ? 'Drafting…' : 'Draft Objective from recovery data (AI)'}
              </button>
              {draftO.error && <p className="mt-1 text-[12.5px] text-danger">{(draftO.error as Error).message}</p>}
            </div>
          )}
          <Field label="A — Assessment"><Textarea rows={2} value={soap.assessment} onChange={set('assessment')} placeholder="Clinical impression / diagnosis" /></Field>
          <Field label="P — Plan"><Textarea rows={4} value={soap.plan} onChange={set('plan')} placeholder="Treatment given, progression, home program, review date…" /></Field>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-line pt-4">
            <Button variant="secondary" onClick={() => goTo(stepIdx - 1)} disabled={stepIdx === 0}>← Back</Button>
            <span className="text-[12.5px] tabular-nums text-muted">{Math.min(stepIdx, steps.length - 1) + 1} / {steps.length}</span>
            {stepIdx < steps.length - 1 ? <Button onClick={() => goTo(stepIdx + 1)}>Next →</Button> : <span className="w-24" />}
          </div>

          {save.error && <Alert>{(save.error as Error).message}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => { const text = drafted(true); setSoap(text); save.mutate({ sign: true, text }) }} loading={save.isPending} disabled={!!signBlock}>Save & sign</Button>
            <Button variant="secondary" onClick={() => save.mutate({ sign: false, text: soap })} disabled={save.isPending}>Save draft</Button>
            {savedAt && <span className="text-[13px] text-muted">Draft saved {savedAt.toLocaleTimeString()}</span>}
            <Link to={`/clinic/patients/${patient.id}/exercises`} className="eyebrow ml-auto !text-ink hover:underline">Prescribe exercises →</Link>
          </div>
          <p className={`text-[12.5px] ${signBlock ? 'font-semibold text-danger' : 'text-muted'}`}>{signBlock ?? "Signed notes are locked and can't be edited."}</p>
        </div>

        <aside className="space-y-6">
          <div className="border border-line p-4">
            <p className="eyebrow mb-3">Vitals & measures</p>
            <div className="space-y-3">
              <Field label="Pain (VAS 0–10)">
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={10} value={pain ?? 0} onChange={(e) => setPain(Number(e.target.value))} className="flex-1 accent-ink" aria-label="Pain score" />
                  <span className="w-10 text-right text-[15px] font-semibold tabular-nums">{pain ?? '—'}</span>
                </div>
              </Field>
              {tracksKnee && steps.some((s) => s.kind === 'section' && s.section.id === 'rom') && (
                <button type="button" className="text-left text-[12.5px] font-semibold text-ink underline"
                  onClick={() => goTo(steps.findIndex((s) => s.kind === 'section' && s.section.id === 'rom'))}>
                  Knee readings for recovery tracking → Range of motion
                </button>
              )}
              {VITALS.map((v) => (
                <Field key={v.key} label={v.label}>
                  <Input value={vitals[v.key] ?? ''} onChange={(e) => setVitals({ ...vitals, [v.key]: e.target.value })} placeholder={v.placeholder} className="!h-10" />
                </Field>
              ))}
            </div>
          </div>
          <div className="border border-line p-4 text-[13px]">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="eyebrow">Medical background</p>
              <Link to={`/clinic/patients/${patient.id}`} className="eyebrow !text-ink hover:underline">Edit</Link>
            </div>
            {bg ? (
              <div className="space-y-2 text-ink-2">
                {bg.past_history && <p>{bg.past_history}</p>}
                {bg.conditions?.length ? <p><span className="text-muted">Conditions: </span>{bg.conditions.join(', ')}</p> : null}
                {bg.prior_medicines?.length ? <p><span className="text-muted">Medicines: </span>{bg.prior_medicines.map((m) => m.name).join(', ')}</p> : null}
                {bg.weaknesses && <p><span className="text-muted">Deficits: </span>{bg.weaknesses}</p>}
              </div>
            ) : <p className="text-muted">Not recorded.</p>}
          </div>
        </aside>
      </div>
    </div>
  )
}

/** A new note starts from the last assessment's region/referral and history, plus conditions on the medical background. */
function prefill(patient: Schemas['PatientFileOut'], excludeId?: string): FormValues {
  const last = patient.consultations.find((c) => c.id !== excludeId && c.assessment_form)?.assessment_form as StoredForm | undefined
  const prev = (last?.sections ?? {}) as FormValues
  const visit: SectionValues = Object.fromEntries(['referred_by', 'body_region', 'side'].filter((k) => prev.visit?.[k]).map((k) => [k, prev.visit[k]]))
  const plan = patient.active_plan
  if (!visit.body_region && plan?.protocol === 'tka') {
    visit.body_region = 'knee'
    if (plan.affected_side) visit.side = plan.affected_side === 'both' ? 'bilateral' : plan.affected_side
  }
  const history: SectionValues = { ...historyFromConditions(patient.background?.conditions ?? []), ...(prev.history ?? {}) }
  return { ...(Object.keys(visit).length ? { visit } : {}), ...(Object.keys(history).length ? { history } : {}) }
}

/** Mandatory red-flag screening for initial assessments and reassessments. Wording comes from the API. */
function RedFlagScreening({ formDef, value, onChange }: { formDef: FormDef; value: Screening; onChange: (v: Screening) => void }) {
  const answered = formDef.red_flags.filter((f) => value.flags[f.code]).length
  const positive = formDef.red_flags.filter((f) => value.flags[f.code] === 'yes')
  const done = answered === formDef.red_flags.length
  const setFlag = (code: string, a: YesNo) => onChange({ ...value, flags: { ...value.flags, [code]: a } })
  const markRestNo = () => onChange({ ...value, flags: Object.fromEntries(formDef.red_flags.map((f) => [f.code, value.flags[f.code] ?? 'no'])) })

  return (
    <section className={`border p-4 ${positive.length ? 'border-danger' : 'border-line'}`} aria-labelledby="red-flags">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p id="red-flags" className="eyebrow">Red-flag screening · required</p>
        <div className="flex items-baseline gap-3 text-[12.5px]">
          <span className="tabular-nums text-muted">{answered}/{formDef.red_flags.length} answered</span>
          {!done && <button type="button" className="font-semibold text-ink underline" onClick={markRestNo}>Mark the rest No</button>}
        </div>
      </div>
      <ul className="divide-y divide-line">
        {formDef.red_flags.map((f) => (
          <li key={f.code} className="flex items-center justify-between gap-3 py-2 text-[14px]">
            <span className={value.flags[f.code] === 'yes' ? 'font-semibold text-danger' : ''}>{f.label}</span>
            <span className="flex shrink-0 gap-1" role="radiogroup" aria-label={f.label}>
              {(['yes', 'no'] as const).map((a) => {
                const on = value.flags[f.code] === a
                return (
                  <button key={a} type="button" role="radio" aria-checked={on} onClick={() => setFlag(f.code, a)}
                    className={`h-8 w-12 border text-[12px] font-semibold uppercase tracking-[0.06em] ${on ? (a === 'yes' ? 'border-danger bg-danger text-white' : 'border-ink bg-ink text-white') : 'border-line-strong text-muted hover:text-ink'}`}>
                    {a}
                  </button>
                )
              })}
            </span>
          </li>
        ))}
      </ul>
      {done && positive.length === 0 && <p className="mt-3 text-[13px] font-semibold text-leaf-dark">No red flags identified.</p>}
      {positive.length > 0 && (
        <div className="mt-3 space-y-3">
          <Alert>Red flag identified: {positive.map((f) => f.label.toLowerCase()).join(', ')}. Referral or medical review is required.</Alert>
          <div className="flex flex-wrap gap-4 text-[14px]">
            {formDef.red_flag_actions.map((a) => (
              <label key={a.code} className="flex items-center gap-2">
                <input type="radio" name="red-flag-action" className="accent-ink" checked={value.action === a.code} onChange={() => onChange({ ...value, action: a.code as RedFlagAction })} />
                {a.label}
              </label>
            ))}
          </div>
          <Field label="Referral details (optional)">
            <Input value={value.note} maxLength={500} onChange={(e) => onChange({ ...value, note: e.target.value })} placeholder="Referred to, reason, urgency…" className="!h-10" />
          </Field>
        </div>
      )}
    </section>
  )
}
