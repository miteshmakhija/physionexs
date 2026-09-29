import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { cx } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'

/** Patient home: messages from the clinic (plan changes, results, appointment reminders). Marked read when viewed. */
export function Updates() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<Schemas['NotificationsOut']>('/me/notifications', { query: { limit: 10 } }) })
  const read = useMutation({
    mutationFn: () => api('/me/notifications/read', { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const [all, setAll] = useState(false)
  const unread = q.data?.unread ?? 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (unread > 0) {
      const t = setTimeout(() => read.mutate(), 4000) // seen for a few seconds → read
      return () => clearTimeout(t)
    }
  }, [unread])
  if (!q.data?.items.length) return null
  const items = all ? q.data.items : q.data.items.slice(0, 3)

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="eyebrow">Updates from your physio{unread ? ` · ${unread} new` : ''}</h2>
        {q.data.items.length > 3 && (
          <button type="button" onClick={() => setAll(!all)} className="eyebrow !text-ink hover:underline">
            {all ? 'Show less' : `Show all (${q.data.items.length})`}
          </button>
        )}
      </div>
      {/* Compact rows; the full list scrolls inside its own box instead of pushing the page down. */}
      <ul className={cx('divide-y divide-line border-y border-line', all && 'max-h-[240px] overflow-y-auto')}>
        {items.map((n) => (
          <li key={n.id} className="flex items-baseline gap-3 py-2 sm:px-3">
            <span className={cx('size-2 shrink-0 translate-y-[-1px] rounded-full', n.read_at ? 'bg-line-strong' : 'bg-brand')} aria-label={n.read_at ? undefined : 'New'} />
            <span className="min-w-0 flex-1 truncate text-[14px]">
              <span className={n.read_at ? 'font-medium' : 'font-semibold'}>{n.title}</span>
              {n.body && <span className="text-muted"> · {n.body}</span>}
            </span>
            <span className="shrink-0 text-[12px] text-muted">{dayLabel(n.created_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
