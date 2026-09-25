import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { Alert, Button, Field, Input, Loader, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

type Note = Schemas['ConsultationOut']

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
  const { clinicId } = useClinic()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const file = useQuery({ queryKey: ['patient-file', id], queryFn: () => api<Schemas['PatientFileOut']>(`/clinic/patients/${id}`, { clinicId }) })

  if (file.isLoading) return <Loader />
  if (!file.data) return <Alert>Patient not found.</Alert>
  const draft = draftId ? file.data.consultations.find((c) => c.id === draftId && !c.signed_at) : undefined

  return (
    <NoteForm
      key={draft?.id ?? 'new'}
      patient={file.data}
      draft={draft}
      onSaved={(signed) => {
        void qc.invalidateQueries({ queryKey: ['patient-file', id] })
        if (signed) navigate(`/clinic/patients/${id}`)
      }}
      clinicId={clinicId}
    />
  )
}

function NoteForm({ patient, draft, onSaved, clinicId }: { patient: Schemas['PatientFileOut']; draft?: Note; onSaved: (signed: boolean) => void; clinicId: string }) {
  const [noteId, setNoteId] = useState(draft?.id ?? null)
  const [soap, setSoap] = useState({
    subjective: draft?.subjective ?? '',
    objective: draft?.objective ?? '',
    assessment: draft?.assessment ?? patient.active_plan?.condition ?? '',
    plan: draft?.plan ?? '',
  })
  const [vitals, setVitals] = useState<Record<string, string>>(Object.fromEntries(Object.entries(draft?.vitals ?? {}).map(([k, v]) => [k, String(v)])))
  const [pain, setPain] = useState<number | null>(draft?.pain_vas ?? null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const save = useMutation({
    mutationFn: (sign: boolean) => {
      const json = { ...soap, vitals: Object.fromEntries(Object.entries(vitals).filter(([, v]) => v.trim())), pain_vas: pain, sign }
      return noteId
        ? api<Note>(`/clinic/consultations/${noteId}`, { method: 'PUT', clinicId, json })
        : api<Note>(`/clinic/patients/${patient.id}/consultations`, { method: 'POST', clinicId, json })
    },
    onSuccess: (n, sign) => {
      setNoteId(n.id)
      setSavedAt(new Date())
      onSaved(sign)
    },
  })
  const set = (k: keyof typeof soap) => (e: { target: { value: string } }) => setSoap({ ...soap, [k]: e.target.value })
  const bg = patient.background

  return (
    <div className="max-w-5xl">
      <Link to={`/clinic/patients/${patient.id}`} className="eyebrow hover:underline">← {patient.full_name}</Link>
      <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Consultation note</h1>
      <p className="text-[13.5px] text-muted">SOAP note · {patient.full_name}{patient.active_plan ? ` · ${patient.active_plan.condition}` : ''}</p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          <Field label="S — Subjective"><Textarea rows={3} value={soap.subjective} onChange={set('subjective')} placeholder="What the patient reports: pain, function, sleep, response to last session…" /></Field>
          <Field label="O — Objective"><Textarea rows={3} value={soap.objective} onChange={set('objective')} placeholder="Observation, palpation, ROM, strength, special tests…" /></Field>
          <Field label="A — Assessment"><Textarea rows={2} value={soap.assessment} onChange={set('assessment')} placeholder="Clinical impression / diagnosis" /></Field>
          <Field label="P — Plan"><Textarea rows={3} value={soap.plan} onChange={set('plan')} placeholder="Treatment given, progression, home program, review date…" /></Field>

          {save.error && <Alert>{(save.error as Error).message}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => save.mutate(true)} loading={save.isPending}>Save & sign</Button>
            <Button variant="secondary" onClick={() => save.mutate(false)} disabled={save.isPending}>Save draft</Button>
            {savedAt && <span className="text-[13px] text-muted">Draft saved {savedAt.toLocaleTimeString()}</span>}
            <Link to={`/clinic/patients/${patient.id}/exercises`} className="eyebrow ml-auto !text-ink hover:underline">Prescribe exercises →</Link>
          </div>
          <p className="text-[12.5px] text-muted">Signed notes are locked and can't be edited.</p>
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
