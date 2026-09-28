import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Alert, Button, Card, cx } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { EXERCISES, SLEEP, SWELLING, labelOf, type Exercises, type Sleep, type Swelling } from '@shared/checkin'
import { isoDay } from '@shared/format'

type State = Schemas['CheckinStateOut']
type Advice = Schemas['AdviceOut']

/** Patient home: the 30-second daily recovery check-in (only for plans that use it, e.g. knee replacement). */
export function CheckinCard() {
  const day = isoDay()
  const q = useQuery({ queryKey: ['checkin', day], queryFn: () => api<State>('/me/checkin', { query: { day } }) })
  const [editing, setEditing] = useState(false)
  const [advice, setAdvice] = useState<Advice | null>(null)
  const s = q.data
  if (!s?.eligible) return null
  const shown = advice ?? s.advice

  return (
    <div className="space-y-3">
      {shown && <AdviceBox advice={shown} />}
      {!s.consent.granted ? (
        <ConsentCard state={s} />
      ) : s.today && !editing ? (
        <Summary state={s} onEdit={() => setEditing(true)} />
      ) : (
        <CheckinForm state={s} day={day} onDone={(a) => { setAdvice(a); setEditing(false) }} onCancel={s.today ? () => setEditing(false) : undefined} />
      )}
    </div>
  )
}

function AdviceBox({ advice }: { advice: Advice }) {
  return (
    <div role="alert" className={cx('rounded-md border-2 p-5', advice.level === 'emergency' ? 'border-danger bg-danger text-white' : 'border-danger bg-danger-tint text-ink')}>
      <p className="text-[18px] font-bold">{advice.title}</p>
      <p className={cx('mt-1 text-[14px] leading-relaxed', advice.level === 'emergency' ? 'text-white' : 'text-ink-2')}>{advice.body}</p>
      {advice.call_number && (
        <a href={`tel:${advice.call_number}`} className={cx('mt-4 inline-flex h-11 items-center rounded-md px-5 text-[12.5px] font-semibold uppercase tracking-[0.09em]', advice.level === 'emergency' ? 'bg-white text-danger' : 'bg-danger text-white')}>
          {advice.call_label}
        </a>
      )}
    </div>
  )
}

function ConsentCard({ state }: { state: State }) {
  const qc = useQueryClient()
  const [later, setLater] = useState(false)
  const agree = useMutation({
    mutationFn: () => api('/me/consents', { method: 'POST', json: { purpose: 'twin_tracking', version: state.consent.version } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checkin'] }),
  })
  if (later) return null
  return (
    <Card className="p-6">
      <p className="eyebrow">Daily recovery check-in · {state.plan?.clinic_name}</p>
      <h2 className="mt-2 text-[18px] font-bold">{state.consent.title}</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{state.consent.body}</p>
      {agree.error && <div className="mt-3"><Alert>{(agree.error as Error).message}</Alert></div>}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button loading={agree.isPending} onClick={() => agree.mutate()}>I agree</Button>
        <Button variant="ghost" onClick={() => setLater(true)}>Not now</Button>
      </div>
    </Card>
  )
}

function Summary({ state, onEdit }: { state: State; onEdit: () => void }) {
  const qc = useQueryClient()
  const t = state.today!
  const stop = useMutation({
    mutationFn: () => api('/me/consents/twin_tracking', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checkin'] }),
  })
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow">Today’s check-in ✓</p>
        <button className="eyebrow !text-ink hover:underline" onClick={onEdit}>Edit</button>
      </div>
      <p className="mt-2 text-[14px]">
        Pain <b>{t.pain}/10</b> · Stiffness <b>{t.stiffness}/10</b> · Swelling {labelOf(SWELLING, t.swelling).toLowerCase()} · Slept {labelOf(SLEEP, t.sleep).toLowerCase()}
      </p>
      <p className="mt-1 text-[13px] text-muted">Your physio at {state.plan?.clinic_name} can see this. Check in again tomorrow.</p>
      <button className="mt-3 text-[12px] text-muted underline" onClick={() => window.confirm('Stop sharing daily check-ins with your physio? You can turn it back on later.') && stop.mutate()}>
        Stop sharing check-ins
      </button>
    </Card>
  )
}

function CheckinForm({ state, day, onDone, onCancel }: { state: State; day: string; onDone: (a: Advice | null) => void; onCancel?: () => void }) {
  const qc = useQueryClient()
  const t = state.today
  const [pain, setPain] = useState<number | null>(t?.pain ?? null)
  const [stiffness, setStiffness] = useState<number | null>(t?.stiffness ?? null)
  const [swelling, setSwelling] = useState<Swelling | null>((t?.swelling as Swelling) ?? null)
  const [sleep, setSleep] = useState<Sleep | null>((t?.sleep as Sleep) ?? null)
  const [exercises, setExercises] = useState<Exercises | null>((t?.exercises as Exercises) ?? null)
  const [flags, setFlags] = useState<string[]>(t?.red_flags ?? [])
  const [noFlags, setNoFlags] = useState(!!t && !t.red_flags.length)
  const ready = pain != null && stiffness != null && swelling && sleep && exercises && (noFlags || flags.length > 0)

  const save = useMutation({
    mutationFn: () => api<Schemas['CheckinResultOut']>('/me/checkins', { method: 'POST', json: { day, pain, stiffness, swelling, sleep, exercises, red_flags: noFlags ? [] : flags } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['checkin'] })
      onDone(r.advice ?? null)
    },
  })
  const toggle = (code: string) => {
    setNoFlags(false)
    setFlags(flags.includes(code) ? flags.filter((f) => f !== code) : [...flags, code])
  }

  return (
    <Card className="p-6">
      <p className="eyebrow">Daily recovery check-in · 30 seconds</p>
      <form className="mt-4 space-y-5" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate() }}>
        <Scale label="Pain right now" low="No pain" high="Worst pain" value={pain} onChange={setPain} />
        <Scale label="Stiffness" low="None" high="Very stiff" value={stiffness} onChange={setStiffness} />
        <Choice label="Swelling" options={SWELLING} value={swelling} onChange={setSwelling} />
        <Choice label="How did you sleep?" options={SLEEP} value={sleep} onChange={setSleep} />
        <Choice label="Yesterday’s exercises done" options={EXERCISES} value={exercises} onChange={setExercises} />
        <fieldset>
          <legend className="text-[14px] font-semibold">Since yesterday, have you had any of these?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {state.red_flag_options.map((o) => (
              <Pill key={o.code} selected={flags.includes(o.code)} onClick={() => toggle(o.code)} danger>{o.label}</Pill>
            ))}
            <Pill selected={noFlags} onClick={() => { setNoFlags(true); setFlags([]) }}>None of these</Pill>
          </div>
        </fieldset>
        {save.error && <Alert>{(save.error as Error).message}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!ready} loading={save.isPending}>Save check-in</Button>
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
      </form>
    </Card>
  )
}

function Scale({ label, low, high, value, onChange }: { label: string; low: string; high: string; value: number | null; onChange: (v: number) => void }) {
  return (
    <fieldset>
      <legend className="text-[14px] font-semibold">{label} {value != null && <span className="text-muted">· {value}/10</span>}</legend>
      <div className="mt-2 grid grid-cols-11 gap-1">
        {Array.from({ length: 11 }, (_, i) => (
          <button key={i} type="button" aria-pressed={value === i} aria-label={`${i} out of 10`} onClick={() => onChange(i)}
            className={cx('h-10 rounded-sm border text-[13px] font-semibold tabular-nums transition', value === i ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink')}>
            {i}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-muted"><span>{low}</span><span>{high}</span></div>
    </fieldset>
  )
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="text-[14px] font-semibold">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => <Pill key={o.value} selected={value === o.value} onClick={() => onChange(o.value)}>{o.label}</Pill>)}
      </div>
    </fieldset>
  )
}

function Pill({ selected, onClick, danger, children }: { selected: boolean; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick}
      className={cx('rounded-sm border px-3 py-2 text-[13px] font-medium transition', selected ? (danger ? 'border-danger bg-danger text-white' : 'border-ink bg-ink text-white') : 'border-line-strong hover:border-ink')}>
      {children}
    </button>
  )
}
