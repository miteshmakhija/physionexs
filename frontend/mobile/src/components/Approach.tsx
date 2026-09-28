import { Linking, Pressable, View } from 'react-native'

import { Divider, Text } from '@/components/ui'
import { approach } from '@shared/approach'
import { colors, font, radius } from '@shared/tokens'

/** Compact "Our approach: digital twin" block for the sign-in screen (web shows the full version). */
export function Approach() {
  return (
    <View style={{ gap: 16, marginTop: 16 }}>
      <Divider />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Text variant="eyebrow">{approach.eyebrow}</Text>
        <Text
          variant="eyebrow"
          style={{ color: colors.ink, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}
        >
          {approach.status}
        </Text>
      </View>
      <View>
        <Text variant="title">{approach.headline}</Text>
        <Text style={{ marginTop: 6 }}>{approach.intro}</Text>
      </View>

      {approach.steps.map((s) => (
        <View key={s.n} style={{ flexDirection: 'row', gap: 12 }}>
          <Text variant="eyebrow" style={{ width: 20, marginTop: 2 }}>{s.n}</Text>
          <View style={{ flex: 1 }}>
            <Text variant="heading">
              {s.title}
              <Text variant="caption" style={{ color: colors.subtle }}>{'  ·  '}{s.trait}</Text>
            </Text>
            <Text style={{ marginTop: 2 }}>{s.body}</Text>
          </View>
        </View>
      ))}

      <Text variant="caption" style={{ lineHeight: 18 }}>{approach.criteriaNote}</Text>

      <View style={{ gap: 10, backgroundColor: colors.surface2, borderRadius: radius.lg, padding: 14 }}>
        {approach.principles.map((p) => (
          <Text key={p.title} style={{ fontSize: 13, lineHeight: 19 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: colors.ink }}>{p.title}. </Text>
            {p.body}
          </Text>
        ))}
      </View>

      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(approach.citation.url)}>
        <Text variant="caption" style={{ textDecorationLine: 'underline', lineHeight: 18 }}>
          {approach.citation.label}
        </Text>
      </Pressable>
    </View>
  )
}
