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
  const balance = points.data?.balance ?? 0

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">{greeting()}</p>
        <h1 className="mt-1 text-[28px] font-bold tracking-[-0.02em]">{firstName}</h1>
      </div>

      <Card className="border-ink bg-ink p-6 text-white">
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

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Visiting a clinic directly?</h2>
        <p className="mt-1 text-[13.5px] text-muted">
          Complete registration at the reception desk to receive your live token number.
        </p>
      </Card>
    </div>
  )
}
