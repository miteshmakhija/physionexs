import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Card, Divider, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'
import { colors, font } from '@shared/tokens'

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
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text variant="eyebrow">Updates from your physio{unread ? ` · ${unread} new` : ''}</Text>
        {q.data.items.length > 3 && (
          <Pressable onPress={() => setAll(!all)} hitSlop={8}>
            <Text variant="eyebrow" style={{ color: colors.ink }}>{all ? 'Show less' : `Show all (${q.data.items.length})`}</Text>
          </Pressable>
        )}
      </View>
      <Card style={{ padding: 0 }}>
        {items.map((n, i) => (
          <View key={n.id}>
            {i > 0 && <Divider />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: n.read_at ? colors.line : colors.brand }} />
              <Text numberOfLines={1} style={{ flex: 1, color: colors.ink, fontFamily: n.read_at ? font.medium : font.bold }}>
                {n.title}
                {n.body ? <Text style={{ color: colors.muted, fontFamily: font.regular }}> · {n.body}</Text> : null}
              </Text>
              <Text variant="caption">{dayLabel(n.created_at)}</Text>
            </View>
          </View>
        ))}
      </Card>
    </View>
  )
}
