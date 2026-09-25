import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'

import { RateVisit } from '@/components/RateVisit'
import { Alert, Avatar, Button, Spinner } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { MODE_LABEL, rupees, STATUS_LABEL, when } from '@shared/format'

export default function AppointmentDetail() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['appointment', id], queryFn: () => api<Schemas['AppointmentOut']>(`/me/appointments/${id}`) })
  const cancel = useMutation({
    mutationFn: () => api<Schemas['AppointmentOut']>(`/me/appointments/${id}/cancel`, { method: 'POST' }),
    onSuccess: (a) => {
      qc.setQueryData(['appointment', id], a)
      void qc.invalidateQueries({ queryKey: ['my-appointments'] })
    },
  })

  if (q.isLoading) return <div className="grid place-items-center py-20 text-muted"><Spinner /></div>
  if (!q.data) return <p className="py-10 text-danger">Appointment not found.</p>
  const a = q.data
  const justBooked = params.get('booked') === '1' && a.status === 'confirmed'

  return (
    <div className="mx-auto max-w-xl">
      {justBooked ? (
        <div className="py-6 text-center">
          <p className="eyebrow">Booking complete</p>
          <h1 className="mt-2 text-[30px] font-bold tracking-[-0.02em]">Appointment confirmed</h1>
          <p className="mt-2 text-[14px] text-muted">We've sent the details and a reminder to your phone.</p>
        </div>
      ) : (
        <>
          <Link to="/app" className="eyebrow hover:underline">← Home</Link>
          <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Appointment</h1>
        </>
      )}

      <div className="mt-6 border border-line p-6">
        <div className="flex items-center gap-3">
          <Avatar name={a.physio.full_name} />
          <div>
            <p className="text-[15px] font-semibold">{a.physio.full_name}</p>
            <p className="text-[12.5px] text-muted">{a.physio.qualification}</p>
          </div>
          <span className="eyebrow ml-auto !text-ink">{STATUS_LABEL[a.status]}</span>
        </div>
        <dl className="mt-5 space-y-3 border-t border-line pt-5 text-[14px]">
          <Row label="Date & time" value={when(a.starts_at)} />
          <Row label="Mode" value={MODE_LABEL[a.mode]} />
          <Row label="Where" value={a.mode === 'online' ? 'Video link shared before the session' : `${a.clinic_name}, ${[a.branch.area, a.branch.city].filter(Boolean).join(', ')}`} />
          <Row label={a.paid ? 'Paid' : 'Fee'} value={a.paid ? rupees(a.amount_paid_paise) + (a.points_redeemed ? ` + ${a.points_redeemed} pts` : '') : rupees(a.fee_paise)} />
        </dl>
      </div>

      {a.status === 'completed' && <div className="mt-6"><RateVisit appointment={a} /></div>}
      {cancel.error && <div className="mt-4"><Alert>{(cancel.error as Error).message}</Alert></div>}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link to="/app" className="flex h-11 flex-1 items-center justify-center rounded-md bg-ink text-[12.5px] font-semibold uppercase tracking-[0.09em] text-white hover:bg-ink-2">
          Back to home
        </Link>
        {(a.status === 'confirmed' || a.status === 'pending') && (
          <Button
            variant="secondary"
            className="flex-1"
            loading={cancel.isPending}
            onClick={() => window.confirm('Cancel this appointment? Paid bookings are refunded in 5–7 days.') && cancel.mutate()}
          >
            Cancel appointment
          </Button>
        )}
      </div>
      <p className="mt-4 text-center text-[12px] text-muted">Free cancellation up to 4 hours before your appointment.</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}
