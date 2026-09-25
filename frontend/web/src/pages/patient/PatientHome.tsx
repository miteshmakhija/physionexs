import { Link } from 'react-router'

import { useAuth } from '@/auth/AuthProvider'
import { Card } from '@/components/ui'

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function PatientHome() {
  const { me } = useAuth()
  const firstName = me?.full_name.split(' ')[0]

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">{greeting()}</p>
        <h1 className="mt-1 text-[28px] font-bold tracking-[-0.02em]">{firstName}</h1>
      </div>

      <Card className="border-ink bg-ink p-6 text-white">
        <p className="eyebrow !text-white/60">Physionexs Health Points</p>
        <p className="mt-3 text-[36px] font-bold">0 <span className="text-[14px] font-semibold text-white/70">points</span></p>
        <p className="mt-1 text-[13px] text-white/80">Log your exercises daily to build a streak and earn points off your next booking.</p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[15px] font-bold">No upcoming appointments</h2>
          <p className="mt-1 text-[13.5px] text-muted">Find a physiotherapist near you and book in-clinic or online.</p>
          <Link to="/app/find" className="eyebrow mt-5 inline-block !text-ink underline underline-offset-4">
            Find a physio →
          </Link>
        </Card>
        <Card className="p-5">
          <h2 className="text-[15px] font-bold">Visiting a clinic directly?</h2>
          <p className="mt-1 text-[13.5px] text-muted">
            Complete registration at the reception desk to receive your live token number.
          </p>
        </Card>
      </div>
    </div>
  )
}
