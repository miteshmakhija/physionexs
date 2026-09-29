import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { Alert, ScrollView, View } from 'react-native'

import { RateVisit } from '@/components/RateVisit'
import { Avatar, Button, Card, Divider, ErrorText, Loading, Row, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { MODE_LABEL, rupees, STATUS_LABEL, when } from '@shared/format'
import { colors } from '@shared/tokens'

export default function AppointmentDetail() {
  const { id, booked } = useLocalSearchParams<{ id: string; booked?: string }>()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['appointment', id], queryFn: () => api<Schemas['AppointmentOut']>(`/me/appointments/${id}`) })
  const cancel = useMutation({
    mutationFn: () => api<Schemas['AppointmentOut']>(`/me/appointments/${id}/cancel`, { method: 'POST' }),
    onSuccess: (a) => {
      qc.setQueryData(['appointment', id], a)
      void qc.invalidateQueries({ queryKey: ['my-appointments'] })
    },
  })

  if (q.isLoading) return <Loading />
  if (!q.data) return <Text style={{ padding: 20 }}>Appointment not found.</Text>
  const a = q.data

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 20, gap: 16 }}>
      {booked === '1' && a.status === 'confirmed' && (
        <View style={{ alignItems: 'center', paddingVertical: 12, gap: 6 }}>
          <Text variant="eyebrow">Booking complete</Text>
          <Text variant="title">Appointment confirmed</Text>
          <Text style={{ textAlign: 'center' }}>We’ve sent the details and a reminder to your phone.</Text>
        </View>
      )}
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={a.physio.full_name} />
          <View style={{ flex: 1 }}>
            <Text variant="heading">{a.physio.full_name}</Text>
            <Text variant="caption">{a.physio.qualification}</Text>
          </View>
          <Text variant="eyebrow" style={{ color: colors.ink }}>{STATUS_LABEL[a.status]}</Text>
        </View>
        <Divider />
        <Row label="Date & time" value={when(a.starts_at)} />
        <Row label="Mode" value={MODE_LABEL[a.mode]} />
        <Row label="Where" value={a.mode === 'online' ? 'Video link shared before the session' : `${a.clinic_name}, ${[a.branch.area, a.branch.city].filter(Boolean).join(', ')}`} />
        <Row label={a.paid ? 'Paid' : a.pay_at_clinic ? 'Pay at the clinic' : 'Fee'} value={a.paid ? rupees(a.amount_paid_paise) + (a.points_redeemed ? ` + ${a.points_redeemed} pts` : '') : rupees(a.fee_paise)} />
      </Card>
      {a.status === 'completed' && <RateVisit appointment={a} />}
      {cancel.error && <ErrorText>{(cancel.error as Error).message}</ErrorText>}
      <Button title="Back to home" onPress={() => router.dismissTo('/patient')} />
      {(a.status === 'confirmed' || a.status === 'pending') && (
        <Button
          variant="ghost"
          title="Cancel appointment"
          loading={cancel.isPending}
          onPress={() =>
            Alert.alert('Cancel appointment?', 'Paid bookings are refunded in 5–7 days.', [
              { text: 'Keep', style: 'cancel' },
              { text: 'Cancel appointment', style: 'destructive', onPress: () => cancel.mutate() },
            ])
          }
        />
      )}
      <Text variant="caption" style={{ textAlign: 'center' }}>Free cancellation up to 4 hours before your appointment.</Text>
    </ScrollView>
  )
}
