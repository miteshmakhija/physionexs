import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { Alert, Button, Field, Input, Loader, Select, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

type Plan = Schemas['CarePlanOut']

// Measures tracked for a knee replacement (TKA) plan; targets are optional.
const TKA_TARGETS = [
  { code: 'knee_flexion', label: 'Knee flexion', placeholder: '120' },
  { code: 'knee_extension_lag', label: 'Extension lag', placeholder: '0' },
]

function sidesOf(affected: string): ('left' | 'right')[] {
  return affected === 'both' ? ['right', 'left'] : affected === 'left' || affected === 'right' ? [affected] : []
}

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
    protocol: plan?.protocol ?? '',
    surgery_date: plan?.surgery_date ?? '',
    affected_side: plan?.affected_side ?? '',
  })
  const [targets, setTargets] = useState<Record<string, { value: string; by_week: string }>>(
    Object.fromEntries((plan?.targets ?? []).map((t) => [`${t.code}:${t.side}`, { value: String(t.target_value), by_week: t.by_week?.toString() ?? '' }])),
  )
  const target = (key: string) => targets[key] ?? { value: '', by_week: '' }
  const targetRows = f.protocol === 'tka' ? sidesOf(f.affected_side).flatMap((side) => TKA_TARGETS.map((t) => ({ ...t, side, key: `${t.code}:${side}` }))) : []
  const save = useMutation({
    mutationFn: async () => {
      const json = {
        condition: f.condition,
        condition_detail: f.condition_detail || null,
        goal: f.goal || null,
        stage: f.stage || null,
        sessions_planned: f.sessions_planned ? Number(f.sessions_planned) : null,
        notes: f.notes || null,
        protocol: f.protocol || null,
        surgery_date: f.surgery_date || null,
        affected_side: f.affected_side || null,
      }
      const saved = await (plan
        ? api<Plan>(`/clinic/care-plans/${plan.id}`, { method: 'PUT', clinicId, json })
        : api<Plan>(`/clinic/patients/${patient.id}/care-plans`, { method: 'POST', clinicId, json }))
      const wanted = targetRows
        .filter((r) => target(r.key).value.trim())
        .map((r) => ({ code: r.code, side: r.side, target_value: Number(targets[r.key].value), by_week: targets[r.key].by_week ? Number(targets[r.key].by_week) : null }))
      if (wanted.length || saved.targets?.length) await api(`/clinic/care-plans/${saved.id}/targets`, { method: 'PUT', clinicId, json: wanted })
      return saved
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patient-file', patient.id] })
      void qc.invalidateQueries({ queryKey: ['twin', patient.id] })
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

        <div className="border-t border-line pt-5 sm:col-span-2">
          <p className="eyebrow">Recovery tracking</p>
          <p className="mt-1 text-[13px] text-muted">For a knee replacement, record surgery date and side to track knee measurements against targets.</p>
        </div>
        <Field label="Protocol">
          <Select value={f.protocol} onChange={set('protocol')}>
            <option value="">None</option>
            <option value="tka">Knee replacement (TKA)</option>
          </Select>
        </Field>
        {f.protocol === 'tka' && (
          <>
            <Field label="Affected side">
              <Select value={f.affected_side} onChange={set('affected_side')} required>
                <option value="">Choose…</option>
                <option value="right">Right</option>
                <option value="left">Left</option>
                <option value="both">Both</option>
              </Select>
            </Field>
            <Field label="Surgery date"><Input type="date" value={f.surgery_date} onChange={set('surgery_date')} /></Field>
          </>
        )}
        {targetRows.length > 0 && (
          <div className="sm:col-span-2">
            <p className="mb-2 text-[13px] font-semibold">Targets <span className="font-normal text-muted">(optional)</span></p>
            <div className="grid gap-3 sm:grid-cols-2">
              {targetRows.map((r) => (
                <div key={r.key} className="flex items-end gap-2">
                  <Field label={`${r.side === 'right' ? 'Right' : 'Left'} ${r.label.toLowerCase()} (°)`}>
                    <Input type="number" min={0} max={160} step="1" placeholder={r.placeholder} value={target(r.key).value}
                      onChange={(e) => setTargets({ ...targets, [r.key]: { ...target(r.key), value: e.target.value } })} />
                  </Field>
                  <Field label="By week">
                    <Input type="number" min={1} max={104} value={target(r.key).by_week} className="!w-24"
                      onChange={(e) => setTargets({ ...targets, [r.key]: { ...target(r.key), by_week: e.target.value } })} />
                  </Field>
                </div>
              ))}
            </div>
          </div>
        )}

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
