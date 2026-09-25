import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pressable, View } from 'react-native'

import { Card, Divider, Loading, Row, Screen, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { isoDay } from '@shared/format'
import { colors, font } from '@shared/tokens'

export default function PlanTab() {
  const qc = useQueryClient()
  const plans = useQuery({ queryKey: ['my-plans'], queryFn: () => api<Schemas['CarePlanOut'][]>('/me/care-plans') })
  const today = useQuery({ queryKey: ['today'], queryFn: () => api<Schemas['TodayOut']>('/me/today', { query: { day: isoDay() } }) })
  const toggle = useMutation({
    mutationFn: (d: Schemas['TodayDose']) =>
      d.taken
        ? api('/me/dose-logs', { method: 'DELETE', query: { medication_id: d.medication_id, logged_on: today.data!.day, dose_slot: d.slot } })
        : api('/me/dose-logs', { method: 'POST', json: { medication_id: d.medication_id, logged_on: today.data!.day, dose_slot: d.slot } }),
    onMutate: async (d) => {
      await qc.cancelQueries({ queryKey: ['today'] })
      const prev = qc.getQueryData<Schemas['TodayOut']>(['today'])
      if (prev) qc.setQueryData(['today'], { ...prev, doses: prev.doses.map((x) => (x.medication_id === d.medication_id && x.slot === d.slot ? { ...x, taken: !x.taken } : x)) })
      return { prev }
    },
    onError: (_e, _d, ctx) => ctx?.prev && qc.setQueryData(['today'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['today'] }),
  })

  if (plans.isLoading) return <Loading />
  const plan = plans.data?.[0]
  if (!plan) {
    return (
      <Screen>
        <Text variant="title">My care plan</Text>
        <Card style={{ gap: 4 }}>
          <Text variant="heading">No care plan yet</Text>
          <Text>After your first session, your physiotherapist’s diagnosis, exercises and medicines appear here.</Text>
        </Card>
      </Screen>
    )
  }
  const t = today.data

  return (
    <Screen>
      <View>
        <Text variant="title">My care plan</Text>
        <Text variant="caption">{plan.stage ? `${plan.stage} · ` : ''}supervised by {plan.physio_name}</Text>
      </View>
      <Card style={{ gap: 6 }}>
        <Row label="Diagnosis" value={[plan.condition, plan.condition_detail].filter(Boolean).join(' — ')} />
        {plan.goal && <Row label="Goal" value={plan.goal} />}
        {plan.stage && <Row label="Stage" value={plan.stage} />}
      </Card>

      {plan.notes && (
        <Card style={{ gap: 6 }}>
          <Text variant="eyebrow">Physio’s notes</Text>
          <Text>{plan.notes}</Text>
        </Card>
      )}

      {!!t?.doses.length && (
        <View style={{ gap: 8 }}>
          <Text variant="eyebrow">Medicines today</Text>
          <Card style={{ padding: 0 }}>
            {t.doses.map((d, i) => (
              <View key={`${d.medication_id}-${d.slot}`}>
                {i > 0 && <Divider />}
                <Pressable onPress={() => toggle.mutate(d)} accessibilityRole="checkbox" accessibilityState={{ checked: d.taken }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: d.taken ? colors.ink : colors.lineStrong, backgroundColor: d.taken ? colors.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {d.taken && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
                  </View>
                  <Text style={{ width: 52, fontFamily: font.semibold, color: colors.ink }}>{d.slot}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink, fontFamily: font.medium }}>{d.name}</Text>
                    {(d.dose || d.timing) && <Text variant="caption">{[d.dose, d.timing].filter(Boolean).join(' · ')}</Text>}
                  </View>
                </Pressable>
              </View>
            ))}
          </Card>
        </View>
      )}

      {plan.tests.length > 0 && (
        <Card style={{ gap: 6 }}>
          <Text variant="eyebrow">Test results</Text>
          {plan.tests.map((x) => <Row key={x.id} label={x.name} value={x.status === 'result_ready' ? `Ready${x.result_note ? ` — ${x.result_note}` : ''}` : 'Ordered'} />)}
        </Card>
      )}
    </Screen>
  )
}
