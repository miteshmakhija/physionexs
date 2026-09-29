import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Avatar, cx, Spinner } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { addDays, dayParts, isoDay, MODE_LABEL, STATUS_LABEL, time } from '@shared/format'

type Appt = Schemas['ClinicAppointmentOut']
type WalkIn = Schemas['QueueTokenOut']
const TOKEN_LABEL: Record<WalkIn['status'], string> = { waiting: 'Waiting', serving: 'With physio', done: 'Seen', skipped: 'Skipped' }
type Status = Appt['status']

const ACTIONS: Partial<Record<Status, { to: Status; label: string; danger?: boolean }[]>> = {
  confirmed: [
    { to: 'checked_in', label: 'Check in' },
    { to: 'no_show', label: 'No-show' },
    { to: 'cancelled', label: 'Cancel', danger: true },
  ],
  checked_in: [{ to: 'completed', label: 'Complete' }],
}

export default function Schedule() {
  const { clinicId } = useClinic()
  const qc = useQueryClient()
  const [day, setDay] = useState(() => isoDay(new Date()))
  const list = useQuery({
    queryKey: ['clinic-appointments', day],
    queryFn: () => api<Appt[]>('/clinic/appointments', { clinicId, query: { day } }),
    refetchInterval: 30_000,
  })
  const walkIns = useQuery({
    queryKey: ['clinic-walk-ins', day],
    queryFn: () => api<WalkIn[]>('/clinic/walk-ins', { clinicId, query: { day } }),
    refetchInterval: 30_000,
  })
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: Status }) => api<Appt>(`/clinic/appointments/${id}`, { method: 'PATCH', clinicId, json: { status: to } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic-appointments', day] }),
  })

  const shift = (days: number) => setDay(addDays(day, days))
  const label = dayParts(day).long
  const live = list.data?.filter((a) => a.status !== 'cancelled') ?? []

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle="Appointments, tele-consults & walk-ins"
        actions={
          <div className="flex items-center gap-1 text-[13px]">
            <button onClick={() => shift(-1)} className="h-9 border border-line-strong px-3 hover:border-ink" aria-label="Previous day">←</button>
            <button onClick={() => setDay(isoDay(new Date()))} className="h-9 border border-line-strong px-3 hover:border-ink">Today</button>
            <button onClick={() => shift(1)} className="h-9 border border-line-strong px-3 hover:border-ink" aria-label="Next day">→</button>
            <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="ml-2 h-9 border border-line-strong px-2" aria-label="Pick a date" />
          </div>
        }
      />
      <p className="eyebrow mb-3">
        {label} · {live.length} appointment{live.length === 1 ? '' : 's'}
        {!!walkIns.data?.length && ` · ${walkIns.data.length} walk-in${walkIns.data.length === 1 ? '' : 's'}`}
      </p>
      {move.error && <div className="mb-3"><Alert>{(move.error as Error).message}</Alert></div>}

      {list.isLoading ? (
        <div className="grid place-items-center py-16 text-muted"><Spinner /></div>
      ) : list.data?.length === 0 ? (
        <p className="border-y border-line py-10 text-center text-[14px] text-muted">No appointments on this day.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.data?.map((a) => (
            <li key={a.id} className={cx('flex flex-wrap items-center gap-4 py-4', a.status === 'cancelled' && 'opacity-50')}>
              <span className="w-20 text-[14px] font-semibold tabular-nums">{time(a.starts_at)}</span>
              <Avatar name={a.patient_name} />
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold">
                  {a.patient_name}
                  {a.source === 'patient_app' && <span className="eyebrow ml-2 !text-brand">App booking</span>}
                </p>
                <p className="text-[13px] text-muted">
                  {[a.kind === 'initial' ? 'Initial assessment' : 'Follow-up', MODE_LABEL[a.mode], a.physio_name, a.branch_name].join(' · ')}
                  {a.patient_phone && ` · ${a.patient_phone}`}
                </p>
              </div>
              <span className="eyebrow w-28 text-right">{STATUS_LABEL[a.status]}{a.paid ? ' · Paid' : ''}</span>
              <div className="flex gap-1">
                {(ACTIONS[a.status] ?? []).map((act) => (
                  <button
                    key={act.to}
                    disabled={move.isPending}
                    onClick={() => (!act.danger || window.confirm('Cancel this appointment? Paid bookings will be refunded.')) && move.mutate({ id: a.id, to: act.to })}
                    className={cx(
                      'h-8 border px-3 text-[12.5px] transition disabled:opacity-50',
                      act.danger ? 'border-line-strong text-danger hover:border-danger' : 'border-ink hover:bg-ink hover:text-white',
                    )}
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!!walkIns.data?.length && (
        <section className="mt-10">
          <p className="eyebrow mb-3">Walk-ins · token queue</p>
          <ul className="divide-y divide-line border-y border-line">
            {walkIns.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-4 py-4">
                <span className="w-20 text-[14px] font-semibold tabular-nums">{time(t.created_at)}</span>
                <Avatar name={t.patient_name} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold">
                    {t.clinic_patient_id ? <Link to={`/clinic/patients/${t.clinic_patient_id}`} className="hover:underline">{t.patient_name}</Link> : t.patient_name}
                    <span className="eyebrow ml-2">Token {t.label}</span>
                  </p>
                  <p className="text-[13px] text-muted">{['Walk-in', t.reason, t.physio_name].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="eyebrow w-28 text-right">{TOKEN_LABEL[t.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
