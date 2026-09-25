import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Pressable, View } from 'react-native'

import { Card, Divider, Loading, Screen, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { isoDay } from '@shared/format'
import { colors, font } from '@shared/tokens'

export default function ExercisesTab() {
  const today = useQuery({ queryKey: ['today'], queryFn: () => api<Schemas['TodayOut']>('/me/today', { query: { day: isoDay() } }) })
  if (today.isLoading) return <Loading />
  const t = today.data
  const done = t?.exercises.reduce((n, e) => n + e.done, 0) ?? 0
  const total = t?.exercises.reduce((n, e) => n + e.scheduled, 0) ?? 0

  return (
    <Screen>
      <View>
        <Text variant="title">Today’s exercises</Text>
        <Text variant="caption">Log each one as you finish.</Text>
      </View>
      {!t || t.exercises.length === 0 ? (
        <Card><Text>No exercises scheduled today.</Text></Card>
      ) : (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 32, color: colors.ink }}>{t.exercise_pct ?? 0}%</Text>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ fontFamily: font.semibold, color: colors.ink }}>{done} of {total} completed</Text>
              <View style={{ height: 6, backgroundColor: colors.line }}>
                <View style={{ height: 6, width: `${t.exercise_pct ?? 0}%`, backgroundColor: colors.ink }} />
              </View>
              {t.streak_days > 0 && <Text variant="caption">{t.streak_days}-day streak</Text>}
            </View>
          </Card>
          <Card style={{ padding: 0 }}>
            {t.exercises.map((e, i) => {
              const complete = e.done >= e.scheduled
              return (
                <View key={e.plan_exercise_id}>
                  {i > 0 && <Divider />}
                  <Pressable onPress={() => router.push({ pathname: '/patient/exercise/[id]', params: { id: e.plan_exercise_id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: complete ? colors.ink : colors.lineStrong, backgroundColor: complete ? colors.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 12, color: complete ? '#fff' : colors.muted }}>{complete ? '✓' : i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: font.semibold, color: complete ? colors.muted : colors.ink, textDecorationLine: complete ? 'line-through' : 'none' }}>{e.name}</Text>
                      <Text variant="caption">{e.sets} sets × {e.reps ? `${e.reps} reps` : `${e.hold_seconds}s hold`}</Text>
                    </View>
                    <Text variant="caption">›</Text>
                  </Pressable>
                </View>
              )
            })}
          </Card>
        </>
      )}
    </Screen>
  )
}
