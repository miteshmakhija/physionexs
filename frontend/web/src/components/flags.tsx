import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { Alert, Button, Input, Textarea, cx } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'

type Flag = Schemas['FlagOut']
type Suggestion = Schemas['SuggestionOut']
type Change = Schemas['PlanChangeOut']

const SEVERITY: Record<Flag['severity'], { label: string; cls: string }> = {
  act: { label: 'Act', cls: 'bg-danger text-white' },
  watch: { label: 'Watch', cls: 'bg-amber-tint text-amber' },
  info: { label: 'Info', cls: 'bg-surface-2 text-muted' },
}

const CLOSED: Record<string, string> = { resolved: 'Resolved', dismissed: 'Dismissed' }

/** Flags raised by the twin rules, with acknowledge / resolve / dismiss. Used by the inbox, dashboard and patient file. */
export function FlagList({ flags, clinicId, canWrite, showPatient = true }: { flags: Flag[]; clinicId: string; canWrite: boolean; showPatient?: boolean }) {
  const qc = useQueryClient()
  const act = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'acknowledge' | 'resolve' | 'dismiss'; note?: string | null }) =>
      api<Flag>(`/clinic/flags/${id}/${action}`, { method: 'POST', clinicId, json: action === 'acknowledge' ? undefined : { note: note ?? null } }),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ['flags'] })
      void qc.invalidateQueries({ queryKey: ['twin', f.clinic_patient_id] })
    },
  })

  return (
    <ul className="divide-y divide-line border-y border-line">
      {flags.map((f) => {
        const open = f.status === 'open' || f.status === 'acknowledged'
        return (
          <li key={f.id} className={cx('flex flex-wrap items-start gap-x-4 gap-y-2 py-3 text-[14px]', !open && 'text-muted')}>
            <span className={cx('mt-0.5 w-14 shrink-0 rounded-sm px-1.5 py-0.5 text-center text-[11px] font-semibold uppercase tracking-[0.06em]', open ? SEVERITY[f.severity].cls : 'bg-surface-2 text-subtle')}>
              {SEVERITY[f.severity].label}
            </span>
            <div className="min-w-0 flex-1">
              <p>
                {showPatient && <Link to={`/clinic/patients/${f.clinic_patient_id}`} className="font-semibold text-ink hover:underline">{f.patient_name}</Link>}
                {showPatient && ' · '}
                <span className={cx(open && 'font-semibold text-ink')}>{f.rule_label}</span>
                {f.status === 'acknowledged' && <span className="text-[12.5px] text-muted"> · seen</span>}
              </p>
              <p className="text-ink-2">{f.summary}</p>
              {open && f.suggestion && <SuggestionBox s={f.suggestion} cpId={f.clinic_patient_id} clinicId={clinicId} canWrite={canWrite} />}
              <p className="text-[12.5px] text-muted">
                {open
                  ? `Since ${dayLabel(f.opened_at)}${f.last_seen_at.slice(0, 10) !== f.opened_at.slice(0, 10) ? ` · last seen ${dayLabel(f.last_seen_at)}` : ''}`
                  : `${CLOSED[f.status] ?? f.status} ${f.resolved_at ? dayLabel(f.resolved_at) : ''}${f.resolved_by_name ? ` by ${f.resolved_by_name}` : ''}${f.resolution_note ? ` — ${f.resolution_note}` : ''}`}
              </p>
            </div>
            {open && canWrite && (
              <div className="flex shrink-0 gap-3 text-[12.5px] font-semibold">
                {f.status === 'open' && <button className="underline" onClick={() => act.mutate({ id: f.id, action: 'acknowledge' })}>Seen</button>}
                <button className="underline" onClick={() => {
                  const note = window.prompt('What did you do? (optional, e.g. “Called patient, reduced sets”)')
                  if (note !== null) act.mutate({ id: f.id, action: 'resolve', note: note.trim() || null })
                }}>Resolve</button>
                <button className="underline" onClick={() => {
                  const note = window.prompt('Why isn’t this a concern? (required)')
                  if (note && note.trim().length >= 3) act.mutate({ id: f.id, action: 'dismiss', note: note.trim() })
                }}>Dismiss</button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const UNIT: Record<string, string> = { sets: 'sets', reps: 'reps', hold_seconds: 's hold' }

function changeText(c: Change) {
  if (c.field === 'is_active') return `${c.exercise_name}: ${c.after === false ? 'pause' : 'resume'}`
  return `${c.exercise_name}: ${c.before} → ${c.after} ${UNIT[c.field]}`
}

/** A rule's proposed plan change. Nothing reaches the patient until a physio approves it (as is, or edited). */
function SuggestionBox({ s, cpId, clinicId, canWrite }: { s: Suggestion; cpId: string; clinicId: string; canWrite: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Change[]>(s.changes)
  const [note, setNote] = useState('')
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['flags'] })
    void qc.invalidateQueries({ queryKey: ['twin', cpId] })
    void qc.invalidateQueries({ queryKey: ['patient-file', cpId] })
  }
  const approve = useMutation({
    mutationFn: (edited: boolean) => api<Suggestion>(`/clinic/suggestions/${s.id}/approve`, {
      method: 'POST', clinicId,
      json: { note: note.trim() || null, changes: edited ? draft.map(({ plan_exercise_id, field, before, after }) => ({ plan_exercise_id, field, before, after })) : null },
    }),
    onSuccess: refresh,
    onError: refresh, // a 409 means it expired; refetch so it disappears
  })
  const reject = useMutation({
    mutationFn: () => api<Suggestion>(`/clinic/suggestions/${s.id}/reject`, { method: 'POST', clinicId, json: { note: null } }),
    onSuccess: refresh,
  })
  const setAfter = (i: number, after: number | boolean) => setDraft(draft.map((c, k) => (k === i ? { ...c, after } : c)))

  return (
    <div className="mt-2 rounded-md border border-line-strong bg-surface-2 p-3 text-[13.5px]">
      <p className="eyebrow">Suggested change{s.author === 'rules' ? ' · automatic' : ''}</p>
      <p className="mt-1 font-semibold text-ink">{s.title}</p>
      {!editing ? (
        <ul className="mt-1 list-disc pl-5 text-ink-2">{s.changes.map((c) => <li key={`${c.plan_exercise_id}-${c.field}`}>{changeText(c)}</li>)}</ul>
      ) : (
        <div className="mt-2 space-y-2">
          {draft.map((c, i) => (
            <label key={`${c.plan_exercise_id}-${c.field}`} className="flex flex-wrap items-center gap-2">
              <span className="min-w-40">{c.exercise_name}</span>
              {c.field === 'is_active' ? (
                <span className="flex items-center gap-2"><input type="checkbox" checked={c.after === false} onChange={(e) => setAfter(i, !e.target.checked)} className="accent-ink" /> Pause</span>
              ) : (
                <span className="flex items-center gap-2 text-muted">{c.before} →
                  <Input type="number" min={1} max={c.field === 'sets' ? 20 : c.field === 'reps' ? 200 : 600} value={String(c.after)} className="!h-9 !w-20"
                    onChange={(e) => setAfter(i, Number(e.target.value))} /> {UNIT[c.field]}
                </span>
              )}
            </label>
          ))}
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Message to the patient (optional), e.g. “Ice after exercises”" />
        </div>
      )}
      <p className="mt-2 text-[12.5px] text-muted">{s.rationale}</p>
      {s.stale && <div className="mt-2"><Alert tone="warning">The plan changed since this was suggested, so it can’t be applied. Reject it or edit the plan directly.</Alert></div>}
      {(approve.error || reject.error) && <div className="mt-2"><Alert>{((approve.error ?? reject.error) as Error).message}</Alert></div>}
      {canWrite && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!s.stale && (editing
            ? <Button className="!h-9" loading={approve.isPending} onClick={() => approve.mutate(true)}>Approve edited</Button>
            : <Button className="!h-9" loading={approve.isPending} onClick={() => approve.mutate(false)}>Approve</Button>)}
          {!s.stale && <Button variant="secondary" className="!h-9" onClick={() => { setEditing(!editing); setDraft(s.changes) }}>{editing ? 'Cancel edit' : 'Edit'}</Button>}
          <Button variant="ghost" className="!h-9" loading={reject.isPending} onClick={() => reject.mutate()}>Reject</Button>
        </div>
      )}
      {!s.stale && <p className="mt-2 text-[11.5px] text-muted">Approving updates the patient’s exercise program and closes this flag.</p>}
    </div>
  )
}
