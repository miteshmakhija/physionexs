import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { View } from 'react-native'

import { Card, Divider, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'
import { colors, font } from '@shared/tokens'

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
    <View style={{ gap: 10 }}>
      <Text variant="eyebrow">Updates from your physio{unread ? ` · ${unread} new` : ''}</Text>
      <Card style={{ padding: 0 }}>
        {q.data.items.map((n, i) => (
          <View key={n.id}>
            {i > 0 && <Divider />}
            <View style={{ flexDirection: 'row', gap: 10, padding: 14 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: n.read_at ? 'transparent' : colors.brand }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontFamily: n.read_at ? font.medium : font.bold }}>{n.title}</Text>
                {n.body ? <Text style={{ marginTop: 2 }}>{n.body}</Text> : null}
                <Text variant="caption" style={{ marginTop: 4 }}>{dayLabel(n.created_at)}</Text>
              </View>
            </View>
          </View>
        ))}
      </Card>
    </View>
  )
}
