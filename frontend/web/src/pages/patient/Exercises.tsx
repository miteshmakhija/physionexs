import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Button, Card, cx, Loader } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { isoDay } from '@shared/format'

type Ex = Schemas['TodayExercise']
const FEELS = [
  { value: 'easy', label: '😀 Easy' },
  { value: 'ok', label: '🙂 OK' },
  { value: 'hard', label: '😣 Hard' },
] as const

export default function Exercises() {
  const today = useQuery({ queryKey: ['today'], queryFn: () => api<Schemas['TodayOut']>('/me/today', { query: { day: isoDay() } }) })
  const [open, setOpen] = useState<string | null>(null)

  if (today.isLoading) return <Loader />
  const t = today.data
  if (!t || t.exercises.length === 0) {
    return (
      <div>
        <PageHeader title="Today's exercises" />
        <Card className="p-6 text-[14px] text-muted">No exercises scheduled today. Your physiotherapist assigns your program from the clinic.</Card>
      </div>
    )
  }
  const done = t.exercises.reduce((n, e) => n + e.done, 0)
  const total = t.exercises.reduce((n, e) => n + e.scheduled, 0)
  const current = t.exercises.find((e) => e.plan_exercise_id === open)

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
      <div>
        <PageHeader title="Today's exercises" subtitle="Log each one as you finish." />
        <div className="mb-5 flex items-center gap-5 border border-line p-5">
          <p className="text-[34px] font-bold">{t.exercise_pct ?? 0}%</p>
          <div className="flex-1">
            <p className="text-[14px] font-semibold">{done} of {total} completed</p>
            <div className="mt-2 h-1.5 bg-line"><div className="h-full bg-ink transition-all" style={{ width: `${t.exercise_pct ?? 0}%` }} /></div>
            <p className="mt-2 text-[12.5px] text-muted">{t.streak_days > 0 ? `${t.streak_days}-day streak · ` : ''}Consistency keeps your recovery on track.</p>
          </div>
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {t.exercises.map((e, i) => {
            const complete = e.done >= e.scheduled
            return (
              <li key={e.plan_exercise_id}>
                <button onClick={() => setOpen(e.plan_exercise_id)} className={cx('flex w-full items-center gap-4 py-4 text-left hover:bg-surface-2 sm:px-2', open === e.plan_exercise_id && 'bg-surface-2')}>
                  <span className={cx('grid size-7 shrink-0 place-items-center rounded-full border text-[12px]', complete ? 'border-ink bg-ink text-white' : 'border-line-strong text-muted')}>{complete ? '✓' : i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-[14.5px] font-semibold', complete && 'text-muted line-through')}>{e.name}</span>
                    <span className="block text-[12.5px] text-muted">{dose(e)}{e.scheduled > 1 ? ` · ${e.done}/${e.scheduled} today` : ''}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      {current ? <ExerciseDetail key={current.plan_exercise_id} ex={current} index={t.exercises.indexOf(current) + 1} total={t.exercises.length} day={t.day} onDone={() => setOpen(null)} /> : (
        <div className="hidden place-items-center border border-dashed border-line-strong text-[14px] text-muted lg:grid">Select an exercise to see how to do it.</div>
      )}
    </div>
  )
}

function dose(e: Ex) {
  return `${e.sets} sets × ${e.reps ? `${e.reps} reps` : `${e.hold_seconds}s hold`} · rest ${e.rest_seconds}s`
}

function ExerciseDetail({ ex, index, total, day, onDone }: { ex: Ex; index: number; total: number; day: string; onDone: () => void }) {
  const qc = useQueryClient()
  const [feel, setFeel] = useState<string | null>(null)
  const [pain, setPain] = useState<number | null>(null)
  const [reward, setReward] = useState<number>(0)
  const log = useMutation({
    mutationFn: () => api<Schemas['ExerciseLogOut']>('/me/exercise-logs', { method: 'POST', json: { plan_exercise_id: ex.plan_exercise_id, logged_on: day, feel, pain } }),
    onSuccess: (r) => {
      setReward(r.points_awarded)
      void qc.invalidateQueries({ queryKey: ['today'] })
      void qc.invalidateQueries({ queryKey: ['progress'] })
      if (r.points_awarded) void qc.invalidateQueries({ queryKey: ['points'] })
      else onDone()
    },
  })
  const complete = ex.done >= ex.scheduled
  const video = ex.media.find((m) => m.kind === 'video')
  const image = ex.media.find((m) => m.kind === 'image')

  return (
    <div className="h-fit border border-line p-6 lg:sticky lg:top-24">
      <p className="eyebrow">Exercise {index} of {total} · {ex.body_region}</p>
      <h2 className="mt-1 text-[22px] font-bold tracking-[-0.02em]">{ex.name}</h2>
      {video ? <video src={video.url} poster={video.thumbnail_url ?? undefined} controls className="mt-4 w-full bg-surface-2" /> : image ? <img src={image.url} alt="" className="mt-4 w-full" /> : null}
      <div className="mt-4 grid grid-cols-3 border-y border-line py-3 text-center">
        <div><p className="text-[22px] font-bold">{ex.sets}</p><p className="text-[12px] text-muted">sets</p></div>
        <div><p className="text-[22px] font-bold">{ex.reps ?? ex.hold_seconds}</p><p className="text-[12px] text-muted">{ex.reps ? 'reps' : 'sec hold'}</p></div>
        <div><p className="text-[22px] font-bold">{ex.rest_seconds}s</p><p className="text-[12px] text-muted">rest</p></div>
      </div>
      {ex.notes && <p className="mt-4 text-[14px]"><span className="text-muted">From your physio: </span>{ex.notes}</p>}
      <h3 className="eyebrow mb-2 mt-5">How to do it</h3>
      <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink-2">
        {ex.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {ex.cues && <p className="mt-3 text-[14px] text-ink-2"><span className="font-semibold text-ink">Tip: </span>{ex.cues}</p>}
      {ex.precautions && <div className="mt-3"><Alert tone="warning">{ex.precautions}</Alert></div>}

      {reward > 0 ? (
        <div className="mt-6 border border-ink p-4 text-center">
          <p className="text-[18px] font-bold">+{reward} Health Points</p>
          <p className="text-[13px] text-muted">Streak reward — redeem at checkout on your next booking.</p>
          <Button variant="secondary" className="mt-3" onClick={onDone}>Continue</Button>
        </div>
      ) : complete ? (
        <p className="mt-6 text-center text-[14px] font-semibold">✓ Done for today</p>
      ) : (
        <>
          <h3 className="eyebrow mb-2 mt-6">How did it feel?</h3>
          <div className="grid grid-cols-3 gap-2">
            {FEELS.map((f) => (
              <button key={f.value} onClick={() => setFeel(f.value)} className={cx('h-10 border text-[13px]', feel === f.value ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink')}>{f.label}</button>
            ))}
          </div>
          <h3 className="eyebrow mb-2 mt-4">Pain during exercise <span className="normal-case tracking-normal">({pain ?? '—'}/10)</span></h3>
          <input type="range" min={0} max={10} value={pain ?? 0} onChange={(e) => setPain(Number(e.target.value))} className="w-full accent-ink" aria-label="Pain score" />
          {log.error && <div className="mt-3"><Alert>{(log.error as Error).message}</Alert></div>}
          <Button className="mt-5 w-full" onClick={() => log.mutate()} loading={log.isPending}>Mark as done & log</Button>
        </>
      )}
    </div>
  )
}
