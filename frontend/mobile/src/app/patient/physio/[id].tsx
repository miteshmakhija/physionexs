import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Avatar, Button, Divider, Loading, Row, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { rupees, when } from '@shared/format'
import { colors } from '@shared/tokens'

export default function PhysioProfile() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const q = useQuery({ queryKey: ['physio', id], queryFn: () => api<Schemas['PhysioDetail']>(`/physios/${id}`) })
  if (q.isLoading) return <Loading />
  if (!q.data) return <Text style={{ padding: 20 }}>Physiotherapist not found.</Text>
  const p = q.data

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Avatar name={p.full_name} size={64} />
          <View style={{ flex: 1 }}>
            <Text variant="title">{p.full_name}</Text>
            <Text>{p.qualification}</Text>
            <Text variant="caption">{p.reviews_count > 0 ? `★ ${p.rating_avg.toFixed(1)} · ${p.reviews_count} reviews` : 'New on Physionexs'}</Text>
          </View>
        </View>

        {p.bio && <Section title="About"><Text>{p.bio}</Text></Section>}
        <Section title="Details">
          {p.college && <Row label="Educated at" value={p.college} />}
          {p.experience_years != null && <Row label="Experience" value={`${p.experience_years} years`} />}
          {p.specializations.length > 0 && <Row label="Specializations" value={p.specializations.join(', ')} />}
          {p.languages.length > 0 && <Row label="Languages" value={p.languages.join(', ')} />}
        </Section>
        <Section title="Consultation charges">
          {p.offers_in_clinic && <Row label="In-clinic visit" value={rupees(p.fee_in_clinic_paise)} />}
          {p.offers_online && <Row label="Online video" value={rupees(p.fee_online_paise)} />}
        </Section>
        <Section title="Clinic">
          {p.branches.map((b) => (
            <Text key={b.id}>
              {p.clinic_name} — {[b.area, b.city].filter(Boolean).join(', ')}
            </Text>
          ))}
        </Section>
        {p.reviews.length > 0 && (
          <Section title="Reviews">
            {p.reviews.map((r, i) => (
              <View key={i} style={{ gap: 2, paddingVertical: 6 }}>
                <Text style={{ color: colors.ink }}>{'★'.repeat(r.rating)} · {r.patient_name}</Text>
                {r.comment && <Text>{r.comment}</Text>}
              </View>
            ))}
          </Section>
        )}
      </ScrollView>
      <View style={{ padding: 16, gap: 6, borderTopWidth: 1, borderTopColor: colors.line }}>
        {p.next_slot_at && <Text variant="caption" style={{ textAlign: 'center' }}>Next available: {when(p.next_slot_at)}</Text>}
        <Button title="Book appointment" onPress={() => router.push({ pathname: '/patient/book/[id]', params: { id: p.id } })} />
      </View>
    </SafeAreaView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Divider />
      <Text variant="eyebrow" style={{ marginTop: 8 }}>{title}</Text>
      {children}
    </View>
  )
}
