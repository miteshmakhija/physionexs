import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { cx } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'

/** Patient home: messages from the clinic (plan changes, results, appointment reminders). Marked read when viewed. */
export function Updates() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<Schemas['NotificationsOut']>('/me/notifications', { query: { limit: 5 } }) })
  const read = useMutation({
    mutationFn: () => api('/me/notifications/read', { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const unread = q.data?.unread ?? 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (unread > 0) {
      const t = setTimeout(() => read.mutate(), 4000) // seen for a few seconds → read
      return () => clearTimeout(t)
    }
  }, [unread])
  if (!q.data?.items.length) return null

  return (
    <section>
      <h2 className="eyebrow mb-3">Updates from your physio{unread ? ` · ${unread} new` : ''}</h2>
      <ul className="divide-y divide-line border-y border-line">
        {q.data.items.map((n) => (
          <li key={n.id} className="flex gap-3 py-3 sm:px-3">
            <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand')} aria-label={n.read_at ? undefined : 'New'} />
            <span className="min-w-0 flex-1">
              <span className={cx('block text-[14.5px]', n.read_at ? 'font-medium' : 'font-semibold')}>{n.title}</span>
              {n.body && <span className="block text-[13.5px] text-muted">{n.body}</span>}
              <span className="block text-[12px] text-muted">{dayLabel(n.created_at)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
