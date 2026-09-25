import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { Alert, Button, Field, Input, Loader, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

type Plan = Schemas['CarePlanOut']

export default function CarePlanForm() {
  const { id } = useParams()
  const { clinicId } = useClinic()
  const file = useQuery({ queryKey: ['patient-file', id], queryFn: () => api<Schemas['PatientFileOut']>(`/clinic/patients/${id}`, { clinicId }) })
  if (file.isLoading) return <Loader />
  if (!file.data) return <Alert>Patient not found.</Alert>
  return <Form key={file.data.active_plan?.id ?? 'new'} patient={file.data} clinicId={clinicId} />
}

function Form({ patient, clinicId }: { patient: Schemas['PatientFileOut']; clinicId: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const plan = patient.active_plan
  const [f, setF] = useState({
    condition: plan?.condition ?? '',
    condition_detail: plan?.condition_detail ?? '',
    goal: plan?.goal ?? '',
    stage: plan?.stage ?? '',
    sessions_planned: plan?.sessions_planned?.toString() ?? '',
    notes: plan?.notes ?? '',
  })
  const save = useMutation({
    mutationFn: () => {
      const json = {
        condition: f.condition,
        condition_detail: f.condition_detail || null,
        goal: f.goal || null,
        stage: f.stage || null,
        sessions_planned: f.sessions_planned ? Number(f.sessions_planned) : null,
        notes: f.notes || null,
      }
      return plan
        ? api<Plan>(`/clinic/care-plans/${plan.id}`, { method: 'PUT', clinicId, json })
        : api<Plan>(`/clinic/patients/${patient.id}/care-plans`, { method: 'POST', clinicId, json })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patient-file', patient.id] })
      navigate(plan ? `/clinic/patients/${patient.id}` : `/clinic/patients/${patient.id}/exercises`)
    },
  })
  const complete = useMutation({
    mutationFn: () => api<Plan>(`/clinic/care-plans/${plan!.id}/complete`, { method: 'POST', clinicId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patient-file', patient.id] })
      navigate(`/clinic/patients/${patient.id}`)
    },
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <div className="max-w-2xl">
      <Link to={`/clinic/patients/${patient.id}`} className="eyebrow hover:underline">← {patient.full_name}</Link>
      <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">{plan ? 'Edit care plan' : 'Start care plan'}</h1>
      <p className="text-[13.5px] text-muted">The patient sees the diagnosis, goal, stage and your advice in their app.</p>
      <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="Diagnosis"><Input value={f.condition} onChange={set('condition')} required minLength={2} placeholder="Grade II MCL sprain" /></Field>
        <Field label="Detail"><Input value={f.condition_detail} onChange={set('condition_detail')} placeholder="Right knee" /></Field>
        <Field label="Goal"><Input value={f.goal} onChange={set('goal')} placeholder="Pain-free stairs in 6 weeks" /></Field>
        <Field label="Stage"><Input value={f.stage} onChange={set('stage')} placeholder="Week 2 of 6" /></Field>
        <Field label="Sessions planned"><Input type="number" min={1} max={200} value={f.sessions_planned} onChange={set('sessions_planned')} /></Field>
        <div className="sm:col-span-2">
          <Field label="Advice to patient" hint="Shown on the care plan and printed on the prescription.">
            <Textarea rows={4} value={f.notes} onChange={set('notes')} placeholder="Avoid deep squats and pivoting for 2 weeks. Ice after exercises." />
          </Field>
        </div>
        {save.error && <div className="sm:col-span-2"><Alert>{(save.error as Error).message}</Alert></div>}
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button type="submit" loading={save.isPending}>{plan ? 'Save plan' : 'Create & prescribe exercises'}</Button>
          {plan && (
            <Button type="button" variant="secondary" loading={complete.isPending} onClick={() => window.confirm('Mark this plan as completed? It will leave the patient app.') && complete.mutate()}>
              Mark plan completed
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
