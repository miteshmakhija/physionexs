import { Link } from 'react-router'

import { Card } from '@/components/ui'
import type { Schemas } from '@/lib/api'
import { rupees } from '@shared/format'
import { MOTIVATION_LABEL, motivationFor } from '@shared/motivation'

/** One encouraging message a day, with the matching next step. */
export function DailyMotivation() {
  const m = motivationFor()
  const action =
    m.kind === 'medicine' ? { to: '/app/plan', label: 'Log today’s medicines →' }
      : m.kind === 'recovery' ? { to: '/app/progress', label: 'See my progress →' }
        : { to: '/app/exercises', label: 'Log today’s exercises →' }
  return (
    <Card className="border-l-4 !border-l-leaf p-6">
      <p className="eyebrow !text-leaf-dark">Today’s motivation · {MOTIVATION_LABEL[m.kind]}</p>
      <p className="mt-2 text-[18px] font-semibold leading-snug">{m.text}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Link to={action.to} className="eyebrow !text-ink underline underline-offset-4">{action.label}</Link>
        <span className="text-[12px] text-muted">General wellness tips. Follow your physio’s and doctor’s advice for your condition.</span>
      </div>
    </Card>
  )
}

/** Points balance, the current exercise streak and how far the next reward is. */
export function PointsCard({ points }: { points?: Schemas['PointsOut'] }) {
  const balance = points?.balance ?? 0
  const ppp = points?.paise_per_point ?? 100
  const streak = points?.streak_days ?? 0
  const goal = points?.next_reward_days
  const reward = points?.next_reward_points
  const pct = goal ? Math.min(100, Math.round((streak / goal) * 100)) : 100
  return (
    <Card inverse className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="eyebrow !text-white/60">Physionexs Health Points</p>
          <p className="mt-3 text-[36px] font-bold leading-none">
            {balance} <span className="text-[14px] font-semibold text-white/70">points</span>
          </p>
          <p className="mt-2 text-[13px] text-white/80">
            {balance > 0 ? `Worth ${rupees(balance * ppp)} off your next booking.` : 'Points take money off your next booking.'}
          </p>
        </div>
        <div className="text-right">
          <p className="eyebrow !text-white/60">Exercise streak</p>
          <p className="mt-3 text-[36px] font-bold leading-none">
            {streak} <span className="text-[14px] font-semibold text-white/70">day{streak === 1 ? '' : 's'}</span>
          </p>
          {!!points?.best_streak_days && <p className="mt-2 text-[13px] text-white/80">Best: {points.best_streak_days} days</p>}
        </div>
      </div>
      {goal && reward ? (
        <div className="mt-5">
          <div className="h-2 w-full rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={streak} aria-label="Progress to the next reward">
            <div className="h-full rounded-full bg-leaf" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[13px] text-white/85">
            {goal - streak} more day{goal - streak === 1 ? '' : 's'} of logged exercise to earn <b className="text-white">{reward} points</b> ({rupees(reward * ppp)} off).
          </p>
        </div>
      ) : (
        <p className="mt-5 text-[13px] text-white/85">You’ve reached every streak reward. Keep logging daily to hold your streak.</p>
      )}
    </Card>
  )
}
