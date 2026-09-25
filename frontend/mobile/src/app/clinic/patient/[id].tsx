import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { ScrollView, View } from 'react-native'

import { Avatar, Button, Card, Divider, Loading, Row, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { useClinic } from '@/lib/useClinic'
import { dayLabel } from '@shared/format'
import { colors, font } from '@shared/tokens'

export default function PatientFile() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { clinicId, isClinician } = useClinic()
  const q = useQuery({ queryKey: ['patient-file', id], queryFn: () => api<Schemas['PatientFileOut']>(`/clinic/patients/${id}`, { clinicId }) })
  if (q.isLoading) return <Loading />
  if (!q.data) return <Text style={{ padding: 20 }}>Patient not found.</Text>
  const p = q.data
  const plan = p.active_plan
  const bg = p.background

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={p.full_name} size={52} />
        <View style={{ flex: 1 }}>
          <Text variant="title">{p.full_name}</Text>
          <Text variant="caption">{[p.age != null ? `${p.age} yrs` : null, p.sex, plan?.condition].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <MiniStat label="Adherence" value={p.adherence_7d == null ? '—' : `${p.adherence_7d}%`} />
        <MiniStat label="Pain (VAS)" value={p.latest_pain == null ? '—' : `${p.latest_pain}/10`} />
        <MiniStat label="Sessions" value={plan?.sessions_planned ? `${p.sessions_done}/${plan.sessions_planned}` : String(p.sessions_done)} />
      </View>

      {isClinician && <Button title="Start consultation" onPress={() => router.push({ pathname: '/clinic/patient/consult', params: { id: p.id } })} />}

      <Card style={{ gap: 6 }}>
        <Text variant="eyebrow">Current plan</Text>
        {plan ? (
          <>
            <Text variant="heading">{plan.condition}{plan.stage ? ` · ${plan.stage}` : ''}</Text>
            {plan.exercises.map((e) => <Row key={e.id} label={e.name} value={`${e.sets}×${e.reps ?? `${e.hold_seconds}s`}`} />)}
            {plan.medications.map((m) => <Row key={m.id} label={m.name} value={m.frequency} />)}
          </>
        ) : <Text>No active plan. Prescribe from the web console.</Text>}
      </Card>

      <Card style={{ gap: 8 }}>
        <Text variant="eyebrow">Medical background</Text>
        {bg ? (
          <>
            {bg.past_history && <Text>{bg.past_history}</Text>}
            {!!bg.conditions?.length && <Row label="Conditions" value={bg.conditions.join(', ')} />}
            {!!bg.prior_medicines?.length && <Row label="Prior medicines" value={bg.prior_medicines.map((m) => m.name).join(', ')} />}
            {bg.core_strengths && <Row label="Core strengths" value={bg.core_strengths} />}
            {bg.weaknesses && <Row label="Weaknesses" value={bg.weaknesses} />}
          </>
        ) : <Text>Not recorded.</Text>}
      </Card>

      <Card style={{ gap: 8 }}>
        <Text variant="eyebrow">Visit history</Text>
        {p.consultations.length === 0 ? <Text>No notes yet.</Text> : p.consultations.map((c, i) => (
          <View key={c.id} style={{ gap: 2 }}>
            {i > 0 && <Divider />}
            <Text style={{ fontFamily: font.semibold, color: colors.ink, marginTop: i > 0 ? 8 : 0 }}>{c.title} · {dayLabel(c.created_at)}{c.signed_at ? '' : ' · Draft'}</Text>
            {c.assessment && <Text>A: {c.assessment}</Text>}
            {c.plan && <Text>P: {c.plan}</Text>}
          </View>
        ))}
      </Card>
    </ScrollView>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 4 }}>
      <Text variant="eyebrow">{label}</Text>
      <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.ink }}>{value}</Text>
    </View>
  )
}
