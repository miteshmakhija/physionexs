import { useQuery } from '@tanstack/react-query'
import { Linking, Pressable, View } from 'react-native'

import { Card, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { colors, font } from '@shared/tokens'

/** "Need help?" card with tap-to-call and tap-to-email. */
export function SupportCard() {
  const q = useQuery({ queryKey: ['support'], queryFn: () => api<Schemas['SupportOut']>('/platform/support'), staleTime: 60 * 60_000 })
  const s = q.data
  if (!s) return null
  return (
    <Card style={{ gap: 10 }}>
      <View>
        <Text variant="heading">Need help?</Text>
        <Text variant="caption">Our care team is here for any query · {s.hours}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Contact label="Helpline" value={s.phone} onPress={() => void Linking.openURL(`tel:${s.phone.replace(/[^\d+]/g, '')}`)} />
        <Contact label="Email" value={s.email} onPress={() => void Linking.openURL(`mailto:${s.email}`)} />
      </View>
    </Card>
  )
}

function Contact({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 2 }} accessibilityRole="link">
      <Text variant="eyebrow">{label}</Text>
      <Text style={{ fontFamily: font.semibold, color: colors.ink, fontSize: 13 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </Pressable>
  )
}
