import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Card, Chip, Divider, ErrorText, Loading, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { isoDay } from '@shared/format'
import { colors, font } from '@shared/tokens'

const FEELS = [
  { value: 'easy', label: '😀 Easy' },
  { value: 'ok', label: '🙂 OK' },
  { value: 'hard', label: '😣 Hard' },
] as const

export default function ExerciseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const today = useQuery({ queryKey: ['today'], queryFn: () => api<Schemas['TodayOut']>('/me/today', { query: { day: isoDay() } }) })
  const [feel, setFeel] = useState<string | null>(null)
  const [pain, setPain] = useState<number | null>(null)
  const [reward, setReward] = useState(0)
  const log = useMutation({
    mutationFn: () => api<Schemas['ExerciseLogOut']>('/me/exercise-logs', { method: 'POST', json: { plan_exercise_id: id, logged_on: today.data!.day, feel, pain } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['today'] })
      void qc.invalidateQueries({ queryKey: ['progress'] })
      if (r.points_awarded) {
        setReward(r.points_awarded)
        void qc.invalidateQueries({ queryKey: ['points'] })
      } else router.back()
    },
  })

  if (today.isLoading) return <Loading />
  const list = today.data?.exercises ?? []
  const ex = list.find((e) => e.plan_exercise_id === id)
  if (!ex) return <Text style={{ padding: 20 }}>Exercise not found in today’s plan.</Text>
  const image = ex.media.find((m) => m.kind === 'image') ?? ex.media.find((m) => m.thumbnail_url)
  const complete = ex.done >= ex.scheduled

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text variant="eyebrow">Exercise {list.indexOf(ex) + 1} of {list.length} · {ex.body_region}</Text>
          <Text variant="title">{ex.name}</Text>
        </View>
        {image && <Image source={{ uri: image.thumbnail_url ?? image.url }} style={{ width: '100%', aspectRatio: 4 / 3 }} contentFit="cover" />}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 12 }}>
          <Big value={String(ex.sets)} label="sets" />
          <Big value={String(ex.reps ?? ex.hold_seconds)} label={ex.reps ? 'reps' : 'sec hold'} />
          <Big value={`${ex.rest_seconds}s`} label="rest" />
        </View>
        {ex.notes && <Text><Text style={{ color: colors.muted }}>From your physio: </Text>{ex.notes}</Text>}
        <Text variant="eyebrow">How to do it</Text>
        {ex.steps.map((s, i) => <Text key={i}>{i + 1}. {s}</Text>)}
        {ex.cues && <Text><Text style={{ fontFamily: font.semibold, color: colors.ink }}>Tip: </Text>{ex.cues}</Text>}
        {ex.precautions && <Card style={{ backgroundColor: colors.amberTint, borderColor: colors.amberTint }}><Text style={{ color: colors.amber }}>{ex.precautions}</Text></Card>}
        <Divider />
        {reward > 0 ? (
          <Card style={{ alignItems: 'center', gap: 6, borderColor: colors.ink }}>
            <Text variant="title">+{reward} Health Points</Text>
            <Text style={{ textAlign: 'center' }}>Streak reward — redeem at checkout on your next booking.</Text>
            <Button title="Continue" onPress={() => router.back()} />
          </Card>
        ) : complete ? (
          <Text style={{ textAlign: 'center', fontFamily: font.semibold, color: colors.ink }}>✓ Done for today</Text>
        ) : (
          <>
            <Text variant="eyebrow">How did it feel?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {FEELS.map((f) => <Chip key={f.value} label={f.label} selected={feel === f.value} onPress={() => setFeel(f.value)} />)}
            </View>
            <Text variant="eyebrow">Pain during exercise (0–10)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {Array.from({ length: 11 }, (_, n) => <Chip key={n} label={String(n)} selected={pain === n} onPress={() => setPain(n)} />)}
            </View>
            {log.error && <ErrorText>{(log.error as Error).message}</ErrorText>}
          </>
        )}
      </ScrollView>
      {!complete && reward === 0 && (
        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Button title="Mark as done & log" onPress={() => log.mutate()} loading={log.isPending} />
        </View>
      )}
    </SafeAreaView>
  )
}

function Big({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontFamily: font.bold, fontSize: 22, color: colors.ink }}>{value}</Text>
      <Text variant="caption">{label}</Text>
    </View>
  )
}
