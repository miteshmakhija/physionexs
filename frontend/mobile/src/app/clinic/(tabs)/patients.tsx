import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useDeferredValue, useState } from 'react'
import { FlatList, Pressable, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Avatar, Divider, Loading, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { useClinic } from '@/lib/useClinic'
import { colors, font, radius } from '@shared/tokens'

export default function PatientsTab() {
  const { clinicId } = useClinic()
  const [q, setQ] = useState('')
  const search = useDeferredValue(q.trim())
  const list = useQuery({
    queryKey: ['clinic-patients', search],
    queryFn: () => api<Schemas['PatientListItem'][]>('/clinic/patients', { clinicId, query: { q: search, limit: 100 } }),
  })

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <View style={{ padding: 20, gap: 12 }}>
        <Text variant="title">Patients</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search patients…"
          placeholderTextColor={colors.subtle}
          style={{ height: 46, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 14, fontFamily: font.medium, fontSize: 15, color: colors.ink }}
        />
      </View>
      <Divider />
      <FlatList
        data={list.data ?? []}
        keyExtractor={(p) => p.id}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={list.isLoading ? <Loading /> : <Text style={{ padding: 20 }}>No patients found.</Text>}
        renderItem={({ item: p }) => (
          <Pressable onPress={() => router.push({ pathname: '/clinic/patient/[id]', params: { id: p.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
            <Avatar name={p.full_name} size={40} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">{p.full_name}{p.age != null ? ` · ${p.age}${p.sex ?? ''}` : ''}</Text>
              <Text variant="caption">{p.condition ?? 'No active plan'}</Text>
            </View>
            <Text style={{ fontFamily: font.semibold, color: p.adherence_7d == null ? colors.subtle : colors.ink }}>{p.adherence_7d == null ? '—' : `${p.adherence_7d}%`}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  )
}
