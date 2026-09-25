import { useQuery } from '@tanstack/react-query'
import { Link } from 'expo-router'
import { useState } from 'react'
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native'

import { Avatar, Chip, Divider, Loading, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { rupees, when } from '@shared/format'
import { colors, font, radius } from '@shared/tokens'

type Mode = '' | 'online' | 'in_clinic'

export default function Find() {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [mode, setMode] = useState<Mode>('')
  const [minRating, setMinRating] = useState('')

  const results = useQuery({
    queryKey: ['physios', q, city, mode, minRating],
    queryFn: () => api<Schemas['DirectoryPage']>('/physios', { query: { q, city, mode, min_rating: minRating } }),
  })

  return (
    <FlatList
      style={{ backgroundColor: colors.canvas }}
      data={results.data?.items ?? []}
      keyExtractor={(p) => p.id}
      ItemSeparatorComponent={Divider}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ padding: 20, gap: 12 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => setQ(text)}
            returnKeyType="search"
            placeholder="Knee, back pain, sports injury…"
            placeholderTextColor={colors.subtle}
            style={inputStyle}
          />
          <TextInput value={city} onChangeText={setCity} placeholder="City (e.g. Pune)" placeholderTextColor={colors.subtle} style={inputStyle} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {(
              [
                ['', 'All'],
                ['online', 'Online'],
                ['in_clinic', 'In-clinic'],
              ] as const
            ).map(([v, l]) => (
              <Chip key={v || 'all'} label={l} selected={mode === v} onPress={() => setMode(v)} />
            ))}
            <View style={{ width: 8 }} />
            {(
              [
                ['', 'Any rating'],
                ['4.5', '★ 4.5+'],
                ['4.8', '★ 4.8+'],
              ] as const
            ).map(([v, l]) => (
              <Chip key={v || 'any'} label={l} selected={minRating === v} onPress={() => setMinRating(v)} />
            ))}
          </ScrollView>
          {results.data && (
            <Text variant="eyebrow">
              {results.data.total} physio{results.data.total === 1 ? '' : 's'}
              {city ? ` in ${city}` : ''}
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={
        results.isLoading ? <Loading /> : <Text style={{ padding: 20 }}>No physiotherapists match. Try a different city or fewer filters.</Text>
      }
      renderItem={({ item }) => <PhysioRow p={item} />}
    />
  )
}

function PhysioRow({ p }: { p: Schemas['PhysioCard'] }) {
  const fee = p.offers_in_clinic ? p.fee_in_clinic_paise : p.fee_online_paise
  return (
    <Link href={{ pathname: '/patient/physio/[id]', params: { id: p.id } }} asChild>
      <Pressable style={({ pressed }) => ({ flexDirection: 'row', gap: 14, padding: 20, backgroundColor: pressed ? colors.surface2 : colors.canvas })}>
        <Avatar name={p.full_name} size={46} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="heading">{p.full_name}</Text>
            <Text style={{ color: colors.ink, fontSize: 13 }}>{p.reviews_count > 0 ? `★ ${p.rating_avg.toFixed(1)}` : 'New'}</Text>
          </View>
          <Text variant="caption">{[p.qualification, p.experience_years ? `${p.experience_years} yrs` : null, p.clinic_name].filter(Boolean).join(' · ')}</Text>
          <Text style={{ fontSize: 13, color: colors.ink2 }}>{p.specializations.join(' · ')}</Text>
          <Text variant="caption">
            {[p.branch.area, p.branch.city].filter(Boolean).join(', ')} · From {rupees(fee)}
          </Text>
          {p.next_slot_at && <Text style={{ fontSize: 12.5, color: colors.leafDark, fontFamily: font.medium }}>Next: {when(p.next_slot_at)}</Text>}
        </View>
      </Pressable>
    </Link>
  )
}

const inputStyle = {
  height: 48,
  borderWidth: 1,
  borderColor: colors.lineStrong,
  borderRadius: radius.md,
  paddingHorizontal: 14,
  fontFamily: font.medium,
  fontSize: 15,
  color: colors.ink,
  backgroundColor: colors.surface,
} as const
