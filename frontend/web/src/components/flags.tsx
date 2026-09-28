import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import { cx } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'

type Flag = Schemas['FlagOut']

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
