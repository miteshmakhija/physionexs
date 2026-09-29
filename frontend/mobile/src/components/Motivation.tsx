import { router } from 'expo-router'
import { Pressable, View } from 'react-native'

import { Card, Text } from '@/components/ui'
import type { Schemas } from '@/lib/api'
import { rupees } from '@shared/format'
import { MOTIVATION_LABEL, motivationFor } from '@shared/motivation'
import { colors, font } from '@shared/tokens'

/** One encouraging message a day, with the matching next step. */
export function DailyMotivation() {
  const m = motivationFor()
  const action =
    m.kind === 'medicine' ? { to: '/patient/plan', label: 'Log today’s medicines →' }
      : m.kind === 'recovery' ? { to: '/patient/progress', label: 'See my progress →' }
        : { to: '/patient/exercises', label: 'Log today’s exercises →' }
  return (
    <Card style={{ gap: 8, borderLeftWidth: 4, borderLeftColor: colors.leaf }}>
      <Text variant="eyebrow" style={{ color: colors.leafDark }}>Today’s motivation · {MOTIVATION_LABEL[m.kind]}</Text>
      <Text style={{ color: colors.ink, fontFamily: font.semibold, fontSize: 17, lineHeight: 24 }}>{m.text}</Text>
      <Pressable onPress={() => router.push(action.to as never)} accessibilityRole="link">
        <Text variant="eyebrow" style={{ color: colors.ink, textDecorationLine: 'underline' }}>{action.label}</Text>
      </Pressable>
      <Text variant="caption">General wellness tips. Follow your physio’s and doctor’s advice for your condition.</Text>
    </Card>
  )
}

/** Points balance, the current exercise streak and how far the next reward is. */
export function PointsCard({ points }: { points?: Schemas['PointsOut'] }) {
  const balance = points?.balance ?? 0
  const ppp = points?.paise_per_point ?? 100
  const streak = points?.streak_days ?? 0
  const goal = points?.next_reward_days
  const reward = points?.next_reward_points
  const pct = goal ? Math.min(100, Math.round((streak / goal) * 100)) : 100
  const muted = 'rgba(255,255,255,0.7)'
  return (
    <Card style={{ backgroundColor: colors.ink, borderColor: colors.ink, padding: 22, gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text variant="eyebrow" style={{ color: 'rgba(255,255,255,0.6)' }}>Health Points</Text>
          <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 34, marginTop: 6 }}>{balance}</Text>
          <Text style={{ color: muted, fontSize: 13 }}>{balance > 0 ? `Worth ${rupees(balance * ppp)} off` : 'Money off your next visit'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="eyebrow" style={{ color: 'rgba(255,255,255,0.6)' }}>Streak</Text>
          <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 34, marginTop: 6 }}>{streak}</Text>
          <Text style={{ color: muted, fontSize: 13 }}>day{streak === 1 ? '' : 's'}{points?.best_streak_days ? ` · best ${points.best_streak_days}` : ''}</Text>
        </View>
      </View>
      {goal && reward ? (
        <View style={{ gap: 8 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)' }} accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: goal, now: streak }}>
            <View style={{ height: 8, borderRadius: 4, width: `${pct}%`, backgroundColor: colors.leaf }} />
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
            {goal - streak} more day{goal - streak === 1 ? '' : 's'} of logged exercise to earn {reward} points ({rupees(reward * ppp)} off).
          </Text>
        </View>
      ) : (
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>You’ve reached every streak reward. Keep logging daily to hold your streak.</Text>
      )}
    </Card>
  )
}
