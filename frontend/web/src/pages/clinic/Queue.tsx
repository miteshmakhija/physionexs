import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Avatar, Button, Field, Input, Loader, Select, Stat } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayParts, time } from '@shared/format'

type Queue = Schemas['QueueOut']
type Token = Schemas['QueueTokenOut']

export default function QueuePage() {
  const { clinicId } = useClinic()
  const qc = useQueryClient()
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Schemas['BranchBrief'][]>('/clinic/branches', { clinicId }) })
  const [picked, setPicked] = useState('')
  const branchId = picked || branches.data?.[0]?.id || ''

  const queue = useQuery({
    queryKey: ['queue', branchId],
    queryFn: () => api<Queue>('/clinic/queue', { clinicId, query: { branch_id: branchId } }),
    enabled: !!branchId,
    refetchInterval: 10_000,
  })
  const setQueue = (q: Queue) => qc.setQueryData(['queue', branchId], q)
  const callNext = useMutation({
    mutationFn: () => api<Queue>('/clinic/queue/call-next', { method: 'POST', clinicId, query: { branch_id: branchId } }),
    onSuccess: setQueue,
  })
  const skip = useMutation({
    mutationFn: (id: string) => api<Token>(`/clinic/queue/${id}`, { method: 'PATCH', clinicId, json: { status: 'skipped' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue', branchId] }),
  })

  const q = queue.data
  const next = q?.waiting[0]

  return (
    <div>
      <PageHeader
        title="Token queue"
        subtitle={`Walk-in patients registered at reception${q ? ` · ${dayParts(q.service_date).long}` : ''}`}
        actions={
          (branches.data?.length ?? 0) > 1 && (
            <Select value={branchId} onChange={(e) => setPicked(e.target.value)} className="!w-56" aria-label="Branch">
              {branches.data!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )
        }
      />
      {!q ? (
        <Loader />
      ) : (
        <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
          <div>
            <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
              <div className="border border-ink bg-ink p-5 text-white">
                <p className="eyebrow !text-white/60">Now serving</p>
                {q.now_serving ? (
                  <>
                    <p className="mt-2 text-[34px] font-bold">{q.now_serving.label}</p>
                    <p className="text-[14px]">{q.now_serving.patient_name}</p>
                    <p className="text-[12.5px] text-white/70">{q.now_serving.reason ?? 'Walk-in'}</p>
                  </>
                ) : (
                  <p className="mt-3 text-[14px] text-white/70">Nobody yet</p>
                )}
                <Button variant="secondary" className="mt-4 w-full !border-white" onClick={() => callNext.mutate()} loading={callNext.isPending} disabled={!next && !q.now_serving}>
                  {next ? `Call next · ${next.label}` : 'Finish current'}
                </Button>
              </div>
              <Stat label="Waiting" value={q.waiting.length} sub={next ? `Up next · ${next.label} ${next.patient_name}` : 'Queue is clear'} />
              <Stat label="Avg. wait today" value={q.avg_wait_minutes != null ? `${q.avg_wait_minutes} min` : '—'} sub={`${q.done.length} seen`} />
            </div>

            <h2 className="eyebrow mb-2 mt-8">Waiting</h2>
            {q.waiting.length === 0 ? (
              <p className="border-y border-line py-8 text-center text-[14px] text-muted">No one waiting.</p>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {q.waiting.map((t) => <TokenRow key={t.id} t={t} onSkip={() => skip.mutate(t.id)} />)}
              </ul>
            )}
            {q.done.length > 0 && (
              <>
                <h2 className="eyebrow mb-2 mt-8">Seen today</h2>
                <ul className="divide-y divide-line border-y border-line opacity-60">
                  {q.done.map((t) => <TokenRow key={t.id} t={t} />)}
                </ul>
              </>
            )}
          </div>
          <RegisterWalkIn branchId={branchId} clinicId={clinicId} onDone={() => qc.invalidateQueries({ queryKey: ['queue', branchId] })} />
        </div>
      )}
    </div>
  )
}

function TokenRow({ t, onSkip }: { t: Token; onSkip?: () => void }) {
  return (
    <li className="flex items-center gap-4 py-3">
      <span className="w-14 text-[15px] font-bold tabular-nums">{t.label}</span>
      <Avatar name={t.patient_name} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">
          {t.clinic_patient_id ? <Link to={`/clinic/patients/${t.clinic_patient_id}`} className="hover:underline">{t.patient_name}</Link> : t.patient_name}
          {t.patient_age != null && <span className="font-normal text-muted"> · {t.patient_age} yrs{t.patient_sex ? ` ${t.patient_sex}` : ''}</span>}
        </p>
        <p className="text-[12.5px] text-muted">{[t.reason, t.physio_name].filter(Boolean).join(' · ') || 'Walk-in'}</p>
      </div>
      <span className="text-[12.5px] text-muted">{time(t.created_at)}</span>
      {onSkip && (
        <button onClick={onSkip} className="eyebrow hover:!text-danger">Skip</button>
      )}
    </li>
  )
}

function RegisterWalkIn({ branchId, clinicId, onDone }: { branchId: string; clinicId: string; onDone: () => void }) {
  const empty = { phone: '', full_name: '', age: '', sex: '', reason: '' }
  const [f, setF] = useState(empty)
  const [issued, setIssued] = useState<Token | null>(null)
  const register = useMutation({
    mutationFn: () =>
      api<Token>('/clinic/queue', {
        method: 'POST',
        clinicId,
        json: {
          branch_id: branchId,
          phone: f.phone || null,
          full_name: f.full_name,
          age: f.age ? Number(f.age) : null,
          sex: f.sex || null,
          reason: f.reason || null,
        },
      }),
    onSuccess: (t) => {
      setIssued(t)
      setF(empty)
      onDone()
    },
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    register.mutate()
  }

  return (
    <form onSubmit={submit} className="h-fit space-y-4 border border-line p-5">
      <h2 className="text-[16px] font-semibold">Register walk-in</h2>
      {issued && (
        <div className="border border-ink p-4 text-center">
          <p className="eyebrow">Token issued</p>
          <p className="text-[36px] font-bold">{issued.label}</p>
          <p className="text-[13px] text-muted">{issued.patient_name}</p>
        </div>
      )}
      {register.error && <Alert>{(register.error as Error).message}</Alert>}
      <Field label="Mobile" hint="Existing patients are matched by number.">
        <Input type="tel" value={f.phone} onChange={set('phone')} placeholder="98123 45678" />
      </Field>
      <Field label="Full name"><Input value={f.full_name} onChange={set('full_name')} required minLength={2} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Age"><Input type="number" min={0} max={120} value={f.age} onChange={set('age')} /></Field>
        <Field label="Sex">
          <Select value={f.sex} onChange={set('sex')}>
            <option value="">—</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="O">Other</option>
          </Select>
        </Field>
      </div>
      <Field label="Reason for visit"><Input value={f.reason} onChange={set('reason')} placeholder="Knee pain, follow-up…" /></Field>
      <Button type="submit" className="w-full" loading={register.isPending} disabled={!branchId}>Issue token</Button>
    </form>
  )
}
