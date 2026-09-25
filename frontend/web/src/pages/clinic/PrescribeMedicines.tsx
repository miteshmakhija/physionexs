import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { Alert, Button, Field, Input, Loader, Select, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

type Med = Schemas['MedicationIn']
const FREQUENCIES = ['1-0-0', '0-0-1', '1-0-1', '1-1-1', '0-1-0', 'Once daily', 'Twice daily', 'SOS', 'Weekly']
const QUICK_TESTS = ['X-Ray', 'MRI', 'Ultrasound', 'Blood panel', 'Vitamin D', 'Nerve conduction study']

export default function PrescribeMedicines() {
  const { id } = useParams()
  const { clinicId } = useClinic()
  const file = useQuery({ queryKey: ['patient-file', id], queryFn: () => api<Schemas['PatientFileOut']>(`/clinic/patients/${id}`, { clinicId }) })
  if (file.isLoading) return <Loader />
  if (!file.data) return <Alert>Patient not found.</Alert>
  if (!file.data.active_plan) {
    return (
      <div className="max-w-xl">
        <Alert tone="info">Start a care plan first — medicines and tests are prescribed as part of a plan.</Alert>
        <Link to={`/clinic/patients/${id}/plan`} className="eyebrow mt-4 inline-block !text-ink underline">Start care plan →</Link>
      </div>
    )
  }
  return <Editor key={file.data.active_plan.id} patient={file.data} plan={file.data.active_plan} clinicId={clinicId} />
}

function Editor({ patient, plan, clinicId }: { patient: Schemas['PatientFileOut']; plan: Schemas['CarePlanOut']; clinicId: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const blank: Med = { name: '', dose: '', frequency: '1-0-1', timing: 'After food', duration_days: 5, instructions: '' }
  const [meds, setMeds] = useState<Med[]>(plan.medications.map(({ name, dose, frequency, timing, duration_days, instructions }) => ({ name, dose, frequency, timing, duration_days, instructions })))
  const [notes, setNotes] = useState(plan.notes ?? '')
  const [test, setTest] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      await api(`/clinic/care-plans/${plan.id}/medications`, {
        method: 'PUT',
        clinicId,
        json: meds.filter((m) => m.name.trim()).map((m) => ({ ...m, dose: m.dose || null, timing: m.timing || null, instructions: m.instructions || null })),
      })
      if ((plan.notes ?? '') !== notes) {
        const { condition, condition_detail, goal, stage, sessions_planned, ends_on } = plan
        await api(`/clinic/care-plans/${plan.id}`, { method: 'PUT', clinicId, json: { condition, condition_detail, goal, stage, sessions_planned, ends_on, notes: notes || null } })
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patient-file', patient.id] })
      navigate(`/clinic/patients/${patient.id}`)
    },
  })
  const order = useMutation({
    mutationFn: (name: string) => api(`/clinic/care-plans/${plan.id}/tests`, { method: 'POST', clinicId, json: { name } }),
    onSuccess: () => {
      setTest('')
      void qc.invalidateQueries({ queryKey: ['patient-file', patient.id] })
    },
  })
  const update = (i: number, patch: Partial<Med>) => setMeds(meds.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const ordered = new Set(plan.tests.map((t) => t.name))

  return (
    <div className="max-w-4xl">
      <Link to={`/clinic/patients/${patient.id}`} className="eyebrow hover:underline">← {patient.full_name}</Link>
      <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Prescribe medicines & tests</h1>
      {patient.background?.prior_medicines?.length ? (
        <div className="mt-4"><Alert tone="warning">Already taking: {patient.background.prior_medicines.map((m) => m.name).join(', ')}. Check for interactions before prescribing.</Alert></div>
      ) : null}

      <section className="mt-6">
        <h2 className="eyebrow mb-3">Medicines</h2>
        <div className="space-y-3">
          {meds.map((m, i) => (
            <div key={i} className="grid gap-3 border border-line p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <Field label="Medicine"><Input value={m.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Ibuprofen 400 mg" className="!h-10" /></Field>
              <Field label="Dose"><Input value={m.dose ?? ''} onChange={(e) => update(i, { dose: e.target.value })} placeholder="1 tablet" className="!h-10" /></Field>
              <Field label="Frequency">
                <Select value={m.frequency} onChange={(e) => update(i, { frequency: e.target.value })} className="!h-10">
                  {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
                </Select>
              </Field>
              <Field label="Days"><Input type="number" min={1} value={m.duration_days ?? ''} onChange={(e) => update(i, { duration_days: e.target.value ? Number(e.target.value) : null })} className="!h-10" /></Field>
              <button onClick={() => setMeds(meds.filter((_, j) => j !== i))} className="self-end pb-2.5 text-muted hover:text-danger" aria-label="Remove">✕</button>
              <div className="sm:col-span-2"><Input value={m.timing ?? ''} onChange={(e) => update(i, { timing: e.target.value })} placeholder="Timing (after food)" className="!h-10" /></div>
              <div className="sm:col-span-3"><Input value={m.instructions ?? ''} onChange={(e) => update(i, { instructions: e.target.value })} placeholder="Instructions (optional)" className="!h-10" /></div>
            </div>
          ))}
        </div>
        <button onClick={() => setMeds([...meds, blank])} className="eyebrow mt-3 !text-ink hover:underline">+ Add medicine</button>
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <Field label="Clinical note for patient" hint="Shown in the patient's care plan and printed on the prescription.">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Take Ibuprofen with food. Apply gel after exercises." />
        </Field>
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="eyebrow mb-3">Order tests</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_TESTS.map((t) => (
            <button key={t} disabled={ordered.has(t) || order.isPending} onClick={() => order.mutate(t)} className="h-8 border border-line-strong px-3 text-[12.5px] hover:border-ink disabled:text-subtle disabled:hover:border-line-strong">
              {ordered.has(t) ? `✓ ${t}` : `+ ${t}`}
            </button>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (test.trim()) order.mutate(test.trim()) }}>
          <Input value={test} onChange={(e) => setTest(e.target.value)} placeholder="Other test, e.g. MRI knee" className="!h-10 max-w-sm" />
          <Button type="submit" variant="secondary" className="!h-10">Order</Button>
        </form>
        {plan.tests.length > 0 && <p className="mt-3 text-[13px] text-muted">Ordered: {plan.tests.map((t) => t.name).join(', ')}</p>}
      </section>

      {save.error && <div className="mt-4"><Alert>{(save.error as Error).message}</Alert></div>}
      <Button className="mt-6" onClick={() => save.mutate()} loading={save.isPending}>Send to patient app</Button>
    </div>
  )
}
