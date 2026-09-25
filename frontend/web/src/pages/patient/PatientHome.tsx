import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { useAuth } from '@/auth/AuthProvider'
import { Avatar, Card } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { MODE_LABEL, rupees, when } from '@shared/format'

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function PatientHome() {
  const { me } = useAuth()
  const firstName = me?.full_name.split(' ')[0]
  const upcoming = useQuery({
    queryKey: ['my-appointments', 'upcoming'],
    queryFn: () => api<Schemas['AppointmentOut'][]>('/me/appointments', { query: { scope: 'upcoming' } }),
  })
  const points = useQuery({ queryKey: ['points'], queryFn: () => api<Schemas['PointsOut']>('/me/points') })
  const tokens = useQuery({ queryKey: ['my-tokens'], queryFn: () => api<Schemas['MyTokenOut'][]>('/me/tokens'), refetchInterval: 20_000 })
  const balance = points.data?.balance ?? 0

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">{greeting()}</p>
        <h1 className="mt-1 text-[28px] font-bold tracking-[-0.02em]">{firstName}</h1>
      </div>

      {tokens.data?.map((t) => (
        <Card key={t.label} className="p-6">
          <p className="eyebrow">Your live token · {t.clinic_name}</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <p className="text-[44px] font-bold leading-none">{t.label}</p>
            <p className="text-right text-[14px]">
              {t.status === 'serving' ? <span className="font-semibold">It's your turn — please go in</span> : (
                <>
                  <span className="block font-semibold">{t.ahead === 0 ? "You're next" : `${t.ahead} patient${t.ahead === 1 ? '' : 's'} ahead`}</span>
                  <span className="text-muted">Est. wait ~{t.est_wait_minutes} min{t.now_serving ? ` · now serving ${t.now_serving}` : ''}</span>
                </>
              )}
            </p>
          </div>
        </Card>
      ))}

      <Card inverse className="p-6">
        <p className="eyebrow !text-white/60">Physionexs Health Points</p>
        <p className="mt-3 text-[36px] font-bold">
          {balance} <span className="text-[14px] font-semibold text-white/70">points</span>
        </p>
        <p className="mt-1 text-[13px] text-white/80">
          {balance > 0
            ? `≈ ${rupees(balance * (points.data?.paise_per_point ?? 100))} off your next booking.`
            : 'Log your exercises daily to build a streak and earn points off your next booking.'}
        </p>
      </Card>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="eyebrow">Upcoming appointments</h2>
          <Link to="/app/find" className="eyebrow !text-ink hover:underline">Book →</Link>
        </div>
        {upcoming.data && upcoming.data.length > 0 ? (
          <ul className="divide-y divide-line border-y border-line">
            {upcoming.data.map((a) => (
              <li key={a.id}>
                <Link to={`/app/appointments/${a.id}`} className="flex items-center gap-4 py-4 hover:bg-surface-2 sm:px-3">
                  <Avatar name={a.physio.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold">{a.physio.full_name}</p>
                    <p className="text-[13px] text-muted">
                      {when(a.starts_at)} · {MODE_LABEL[a.mode]}
                    </p>
                  </div>
                  <span className="text-[12px] text-muted">Reminder on</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="p-5">
            <h3 className="text-[15px] font-semibold">No upcoming appointments</h3>
            <p className="mt-1 text-[13.5px] text-muted">Find a physiotherapist near you and book in-clinic or online.</p>
            <Link to="/app/find" className="eyebrow mt-5 inline-block !text-ink underline underline-offset-4">
              Find a physio →
            </Link>
          </Card>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { to: '/app/plan', label: 'My care plan' },
          { to: '/app/exercises', label: "Today's exercises" },
          { to: '/app/progress', label: 'My progress' },
        ].map((l) => (
          <Link key={l.to} to={l.to} className="border border-line p-5 text-[14.5px] font-semibold hover:border-ink">{l.label} →</Link>
        ))}
      </div>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Visiting a clinic directly?</h2>
        <p className="mt-1 text-[13.5px] text-muted">
          Complete registration at the reception desk to receive your live token number.
        </p>
      </Card>
    </div>
  )
}
