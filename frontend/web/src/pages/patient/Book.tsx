import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { Alert, Avatar, Button, cx, Spinner } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { payWithRazorpay } from '@/lib/razorpay'
import { dayParts, hourIn, MODE_LABEL, REFERRAL_OPTIONS, rupees, time, when } from '@shared/format'

type Mode = 'in_clinic' | 'online'

export default function Book() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const physio = useQuery({ queryKey: ['physio', id], queryFn: () => api<Schemas['PhysioDetail']>(`/physios/${id}`) })
  const days = useQuery({
    queryKey: ['slots', id],
    queryFn: () => api<Schemas['DayOut'][]>(`/physios/${id}/slots`, { query: { days: 7 } }),
  })
  const points = useQuery({ queryKey: ['points'], queryFn: () => api<Schemas['PointsOut']>('/me/points') })

  const [dayIdx, setDayIdx] = useState<number | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [referral, setReferral] = useState<string | null>(null)
  const [redeem, setRedeem] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const p = physio.data
  const effectiveMode: Mode = mode ?? (p?.offers_in_clinic ? 'in_clinic' : 'online')
  const firstOpenDay = days.data?.findIndex((d) => d.slots.some((s) => s.available)) ?? -1
  const activeDay = dayIdx ?? (firstOpenDay >= 0 ? firstOpenDay : 0)

  const fee = p ? (effectiveMode === 'online' ? p.fee_online_paise : p.fee_in_clinic_paise) ?? 0 : 0
  // Same rule as the API: whole points only, never more than the fee.
  const ppp = points.data?.paise_per_point ?? 100
  const pointsValue = Math.min(points.data?.balance ?? 0, Math.floor(fee / ppp)) * ppp
  const payable = fee - (redeem ? pointsValue : 0)

  const groups = useMemo(() => {
    const g: Record<string, Schemas['SlotOut'][]> = { Morning: [], Afternoon: [], Evening: [] }
    for (const s of days.data?.[activeDay]?.slots ?? []) {
      const h = hourIn(s.starts_at)
      g[h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'].push(s)
    }
    return Object.entries(g).filter(([, v]) => v.length)
  }, [days.data, activeDay])

  if (physio.isLoading || days.isLoading) return <div className="grid place-items-center py-20 text-muted"><Spinner /></div>
  if (!p) return <p className="py-10 text-danger">Physiotherapist not found.</p>

  const confirm = async () => {
    if (!slot) return
    setBusy(true)
    setError(null)
    try {
      const checkout = await api<Schemas['CheckoutOut']>('/bookings', {
        method: 'POST',
        json: { physio_id: p.id, starts_at: slot, mode: effectiveMode, referral_source: referral, redeem_points: redeem },
      })
      if (checkout.razorpay) {
        const result = await payWithRazorpay(checkout.razorpay)
        if (!result) {
          setError('Payment was not completed. Your slot is held for 15 minutes — try again to confirm it.')
          return
        }
        await api(`/bookings/${checkout.appointment_id}/verify`, { method: 'POST', json: result })
      }
      await Promise.all(['my-appointments', 'points', 'slots'].map((key) => qc.invalidateQueries({ queryKey: [key] })))
      navigate(`/app/appointments/${checkout.appointment_id}?booked=1`, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      void days.refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <div>
        <Link to={`/app/physios/${p.id}`} className="eyebrow hover:underline">← {p.full_name}</Link>
        <h1 className="mt-4 text-[28px] font-bold tracking-[-0.02em]">Book appointment</h1>

        <Step n={1} title="Select date">
          <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {days.data!.map((d, i) => {
              const open = d.slots.some((s) => s.available)
              const parts = dayParts(d.date)
              return (
                <button
                  key={d.date}
                  disabled={!open}
                  onClick={() => {
                    setDayIdx(i)
                    setSlot(null)
                  }}
                  className={cx(
                    'mx-1 w-16 shrink-0 border py-2.5 text-center transition',
                    i === activeDay ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink',
                    !open && 'cursor-not-allowed opacity-35',
                  )}
                >
                  <span className="eyebrow block !text-inherit opacity-70">{parts.weekday}</span>
                  <span className="text-[18px] font-semibold">{parts.date}</span>
                </button>
              )
            })}
          </div>
        </Step>

        <Step n={2} title="Available slots">
          {groups.length === 0 ? (
            <p className="text-[14px] text-muted">No slots on this day.</p>
          ) : (
            groups.map(([label, slots]) => (
              <div key={label} className="mb-4">
                <p className="mb-2 text-[12.5px] text-muted">{label}</p>
                <div className="flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.starts_at}
                      disabled={!s.available}
                      onClick={() => setSlot(s.starts_at)}
                      className={cx(
                        'h-9 min-w-[88px] border px-3 text-[13px] transition',
                        slot === s.starts_at ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink',
                        !s.available && 'cursor-not-allowed text-subtle line-through opacity-50 hover:border-line-strong',
                      )}
                    >
                      {time(s.starts_at)}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </Step>

        <Step n={3} title="How would you like to consult?">
          <p className="mb-3 text-[13px] text-muted">Same slot — visit the clinic in person or meet online over video.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['in_clinic', 'online'] as const).map((m) => {
              const offered = m === 'online' ? p.offers_online : p.offers_in_clinic
              const price = m === 'online' ? p.fee_online_paise : p.fee_in_clinic_paise
              return (
                <button
                  key={m}
                  disabled={!offered}
                  onClick={() => setMode(m)}
                  className={cx(
                    'flex items-center justify-between border p-4 text-left transition',
                    effectiveMode === m ? 'border-ink' : 'border-line-strong hover:border-ink',
                    !offered && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <span className="text-[14px] font-semibold">{MODE_LABEL[m]}</span>
                  <span className="text-[13px] text-muted">{offered ? rupees(price) : 'Not offered'}</span>
                </button>
              )
            })}
          </div>
        </Step>

        <Step n={4} title={`How did you find ${p.full_name}?`}>
          <p className="mb-3 text-[13px] text-muted">Helps your physio and clinic understand what's working.</p>
          <div className="flex flex-wrap gap-2">
            {REFERRAL_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setReferral(referral === o.value ? null : o.value)}
                className={cx(
                  'h-8 border px-3 text-[12.5px] transition',
                  referral === o.value ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Step>

        <p className="mt-8 text-[13px] text-muted">
          Prefer to walk in? You can also visit the clinic directly and collect a live token from reception.
        </p>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="border border-line p-6">
          <div className="flex items-center gap-3">
            <Avatar name={p.full_name} />
            <div>
              <p className="text-[14px] font-semibold">{p.full_name}</p>
              <p className="text-[12.5px] text-muted">{p.qualification}</p>
            </div>
          </div>
          <dl className="mt-5 space-y-3 border-t border-line pt-5 text-[14px]">
            <Row label="Date & time" value={slot ? when(slot) : '—'} />
            <Row label="Mode" value={MODE_LABEL[effectiveMode]} />
            <Row label="Consultation fee" value={rupees(fee)} />
            {redeem && pointsValue > 0 && <Row label="Points redeemed" value={`− ${rupees(fee - payable)}`} />}
          </dl>
          {points.data && points.data.balance > 0 && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 border-t border-line pt-4 text-[13px]">
              <input type="checkbox" checked={redeem} onChange={(e) => setRedeem(e.target.checked)} className="mt-0.5 accent-ink" />
              <span>
                Redeem {rupees(pointsValue)} in points
                <span className="block text-muted">Use your {points.data.balance} Health Points on this booking</span>
              </span>
            </label>
          )}
          <div className="mt-5 flex items-baseline justify-between border-t border-line pt-5">
            <span className="eyebrow">Total payable</span>
            <span className="text-[22px] font-bold">{rupees(payable)}</span>
          </div>
          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          <Button className="mt-5 w-full" disabled={!slot} loading={busy} onClick={confirm}>
            {payable === 0 ? 'Confirm booking' : `Confirm & pay ${rupees(payable)}`}
          </Button>
          <p className="mt-3 text-center text-[11.5px] text-muted">Secure payments by Razorpay · UPI, cards, net banking</p>
        </div>
      </aside>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="mb-4 text-[15px] font-semibold">
        <span className="mr-2 text-muted">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}
