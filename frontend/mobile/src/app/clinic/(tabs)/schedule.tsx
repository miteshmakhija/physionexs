import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Avatar, Chip, Divider, ErrorText, Loading, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { useClinic } from '@/lib/useClinic'
import { addDays, dayParts, isoDay, MODE_LABEL, STATUS_LABEL, time } from '@shared/format'
import { colors, font } from '@shared/tokens'

type Appt = Schemas['ClinicAppointmentOut']
type Status = Appt['status']

const ACTIONS: Partial<Record<Status, { to: Status; label: string }[]>> = {
  confirmed: [
    { to: 'checked_in', label: 'Check in' },
    { to: 'no_show', label: 'No-show' },
    { to: 'cancelled', label: 'Cancel' },
  ],
  checked_in: [{ to: 'completed', label: 'Complete' }],
}

export default function Schedule() {
  const { clinicId, clinicName } = useClinic()
  const qc = useQueryClient()
  const [day, setDay] = useState(() => isoDay())
  const list = useQuery({
    queryKey: ['clinic-appointments', day],
    queryFn: () => api<Appt[]>('/clinic/appointments', { clinicId, query: { day } }),
  })
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: Status }) => api<Appt>(`/clinic/appointments/${id}`, { method: 'PATCH', clinicId, json: { status: to } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic-appointments', day] }),
  })

  const act = (a: Appt, to: Status) => {
    if (to !== 'cancelled') return move.mutate({ id: a.id, to })
    Alert.alert('Cancel appointment?', 'Paid bookings will be refunded.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: () => move.mutate({ id: a.id, to }) },
    ])
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <View style={{ padding: 20, gap: 12 }}>
        <Text variant="title">Schedule</Text>
        <Text variant="caption">{clinicName}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Chip label="←" onPress={() => setDay(addDays(day, -1))} />
          <Chip label="Today" selected={day === isoDay()} onPress={() => setDay(isoDay())} />
          <Chip label="→" onPress={() => setDay(addDays(day, 1))} />
          <Text variant="eyebrow" style={{ marginLeft: 6 }}>{dayParts(day).long}</Text>
        </View>
        {move.error && <ErrorText>{(move.error as Error).message}</ErrorText>}
      </View>
      <Divider />
      <FlatList
        data={list.data ?? []}
        keyExtractor={(a) => a.id}
        ItemSeparatorComponent={Divider}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
        ListEmptyComponent={list.isLoading ? <Loading /> : <Text style={{ padding: 20 }}>No appointments on this day.</Text>}
        renderItem={({ item: a }) => (
          <View style={{ padding: 20, gap: 10, opacity: a.status === 'cancelled' ? 0.5 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ width: 70, fontFamily: font.semibold, color: colors.ink }}>{time(a.starts_at)}</Text>
              <Avatar name={a.patient_name} size={36} />
              <View style={{ flex: 1 }}>
                <Text variant="heading">{a.patient_name}</Text>
                <Text variant="caption">
                  {a.kind === 'initial' ? 'Initial' : 'Follow-up'} · {MODE_LABEL[a.mode]}
                  {a.source === 'patient_app' ? ' · App' : ''}
                </Text>
              </View>
              <Text variant="eyebrow">{STATUS_LABEL[a.status]}</Text>
            </View>
            {(ACTIONS[a.status] ?? []).length > 0 && (
              <View style={{ flexDirection: 'row', gap: 8, paddingLeft: 82 }}>
                {ACTIONS[a.status]!.map((x) => (
                  <Pressable key={x.to} disabled={move.isPending} onPress={() => act(a, x.to)}>
                    <Text variant="eyebrow" style={{ color: x.to === 'cancelled' ? colors.danger : colors.ink, paddingVertical: 4, paddingRight: 12 }}>
                      {x.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  )
}
