import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import { PageHeader } from '@/components/ConsoleLayout'
import { Card, cx, Loader, Stat } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel, isoDay } from '@shared/format'

export default function CarePlan() {
  const plans = useQuery({ queryKey: ['my-plans'], queryFn: () => api<Schemas['CarePlanOut'][]>('/me/care-plans') })
  const today = useQuery({ queryKey: ['today'], queryFn: () => api<Schemas['TodayOut']>('/me/today', { query: { day: isoDay() } }) })
  const rx = useQuery({ queryKey: ['my-rx'], queryFn: () => api<Schemas['PrescriptionOut'][]>('/me/prescriptions') })

  if (plans.isLoading) return <Loader />
  const plan = plans.data?.[0]
  if (!plan) {
    return (
      <div>
        <PageHeader title="My care plan" />
        <Card className="p-6">
          <p className="text-[15px] font-semibold">No care plan yet</p>
          <p className="mt-1 text-[14px] text-muted">After your first session, your physiotherapist's diagnosis, exercises and medicines appear here.</p>
          <Link to="/app/find" className="eyebrow mt-4 inline-block !text-ink underline">Book a physio →</Link>
        </Card>
      </div>
    )
  }
  const t = today.data
  const exDone = t?.exercises.reduce((n, e) => n + e.done, 0) ?? 0
  const exTotal = t?.exercises.reduce((n, e) => n + e.scheduled, 0) ?? 0

  return (
    <div className="space-y-8">
      <PageHeader title="My care plan" subtitle={`${plan.stage ? `${plan.stage} · ` : ''}supervised by ${plan.physio_name}, ${plan.clinic_name}`} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Diagnosis" value={<span className="text-[17px]">{plan.condition}</span>} sub={plan.condition_detail} />
        <Stat label="Goal" value={<span className="text-[17px]">{plan.goal ?? '—'}</span>} />
        <Stat label="Stage" value={<span className="text-[17px]">{plan.stage ?? '—'}</span>} />
      </div>

      <section>
        <h2 className="eyebrow mb-3">Today's plan</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link to="/app/exercises" className="border border-line p-5 hover:border-ink">
            <p className="text-[28px] font-bold">{exDone}/{exTotal}</p>
            <p className="text-[13.5px] text-muted">Exercises done</p>
          </Link>
          <div className="border border-line p-5">
            <p className="text-[28px] font-bold">{t ? `${t.doses.filter((d) => d.taken).length}/${t.doses.length}` : '—'}</p>
            <p className="text-[13.5px] text-muted">Medicine doses taken</p>
          </div>
        </div>
      </section>

      {plan.notes && (
        <section className="border-t border-line pt-6">
          <h2 className="eyebrow mb-2">Physio's notes</h2>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{plan.notes}</p>
        </section>
      )}

      {t && <Medicines today={t} plan={plan} />}

      {plan.tests.length > 0 && (
        <section className="border-t border-line pt-6">
          <h2 className="eyebrow mb-3">Test results</h2>
          <ul className="divide-y divide-line border-y border-line">
            {plan.tests.map((x) => (
              <li key={x.id} className="flex justify-between gap-4 py-3 text-[14px]">
                <span className="font-semibold">{x.name}</span>
                <span className={cx(x.status === 'result_ready' ? 'text-ink' : 'text-muted')}>
                  {x.status === 'result_ready' ? `Result ready${x.result_note ? ` — ${x.result_note}` : ''}` : 'Ordered'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!rx.data?.length && (
        <section className="border-t border-line pt-6">
          <h2 className="eyebrow mb-3">Prescriptions</h2>
          <ul className="divide-y divide-line border-y border-line">
            {rx.data.map((r) => (
              <li key={r.id}>
                <Link to={`/app/prescriptions/${r.id}`} className="flex justify-between py-3 text-[14px] hover:bg-surface-2">
                  <span className="font-semibold">{r.rx_no}</span>
                  <span className="text-muted">{dayLabel(r.issued_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Medicines({ today, plan }: { today: Schemas['TodayOut']; plan: Schemas['CarePlanOut'] }) {
  const qc = useQueryClient()
  const toggle = useMutation({
    mutationFn: (d: Schemas['TodayDose']) =>
      d.taken
        ? api('/me/dose-logs', { method: 'DELETE', query: { medication_id: d.medication_id, logged_on: today.day, dose_slot: d.slot } })
        : api('/me/dose-logs', { method: 'POST', json: { medication_id: d.medication_id, logged_on: today.day, dose_slot: d.slot } }),
    // Tick immediately; roll back if the server refuses.
    onMutate: async (d) => {
      await qc.cancelQueries({ queryKey: ['today'] })
      const prev = qc.getQueryData<Schemas['TodayOut']>(['today'])
      if (prev) {
        qc.setQueryData<Schemas['TodayOut']>(['today'], {
          ...prev,
          doses: prev.doses.map((x) => (x.medication_id === d.medication_id && x.slot === d.slot ? { ...x, taken: !x.taken } : x)),
        })
      }
      return { prev }
    },
    onError: (_e, _d, ctx) => ctx?.prev && qc.setQueryData(['today'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['today'] }),
  })
  if (plan.medications.length === 0) return null
  const missed = today.doses.filter((d) => !d.taken).length

  return (
    <section className="border-t border-line pt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="eyebrow">Medicines</h2>
        {missed > 0 && <span className="text-[13px] text-muted">{missed} dose(s) not logged today — your physio sees this.</span>}
      </div>
      {today.doses.length > 0 && (
        <ul className="mb-4 divide-y divide-line border-y border-line">
          {today.doses.map((d) => (
            <li key={`${d.medication_id}-${d.slot}`}>
              <label className="flex cursor-pointer items-center gap-4 py-3 text-[14px]">
                <input type="checkbox" checked={d.taken} onChange={() => toggle.mutate(d)} className="size-4 accent-ink" />
                <span className="w-16 font-semibold tabular-nums">{d.slot}</span>
                <span className="flex-1">{d.name}{d.dose ? ` · ${d.dose}` : ''}</span>
                <span className="text-muted">{d.timing}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] text-muted">
        Prescribed: {plan.medications.map((m) => `${m.name} (${m.frequency}${m.duration_days ? `, ${m.duration_days} days` : ''})`).join(' · ')}
      </p>
    </section>
  )
}
