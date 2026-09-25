import { useMutation, useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useSession } from '@/auth/session'
import { Avatar, Button, Card, Divider, Loading, Text } from '@/components/ui'
import { api, ApiError, type Schemas } from '@/lib/api'
import { useClinic } from '@/lib/useClinic'
import { dayLabel, rupees, time } from '@shared/format'
import { colors, font } from '@shared/tokens'

export default function ClinicHome() {
  const { me, logout } = useSession()
  const { clinicId, clinicName, isOwner } = useClinic()
  const q = useQuery({ queryKey: ['dashboard', ''], queryFn: () => api<Schemas['DashboardOut']>('/clinic/dashboard', { clinicId }), refetchInterval: 60_000 })
  const [checkedIn, setCheckedIn] = useState<string | null>(null)
  const checkIn = useMutation({
    mutationFn: () => api<Schemas['StaffOut']>('/clinic/attendance/check-in', { method: 'POST', clinicId }),
    onSuccess: (s) => setCheckedIn(s.check_in?.slice(0, 5) ?? 'now'),
    onError: (e) => {
      const m = e instanceof ApiError ? /at (\d{2}:\d{2})/.exec(e.message) : null
      if (m) setCheckedIn(m[1])
    },
  })
  if (!me) return null
  const d = q.data

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onLongPress={() => void logout()} accessibilityHint="Long-press to log out">
            <Avatar name={me.full_name} size={44} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text variant="heading">{me.full_name}</Text>
            <Text variant="caption">{clinicName} · {isOwner ? 'Doctor-Admin' : 'Team'}</Text>
          </View>
          {checkedIn ? <Text variant="caption">In · {checkedIn}</Text> : <Button variant="ghost" title="Check in" onPress={() => checkIn.mutate()} loading={checkIn.isPending} />}
        </View>

        {me.physio_verification === 'pending' && (
          <Card style={{ backgroundColor: colors.amberTint, borderColor: colors.amberTint }}>
            <Text style={{ color: colors.amber }}>Your council registration is being verified. Your public profile goes live once it’s approved.</Text>
          </Card>
        )}

        {!d ? <Loading /> : (
          <>
            {isOwner && d.subscription?.due_soon && (
              <Card style={{ borderColor: d.subscription.status === 'overdue' ? colors.danger : colors.line, gap: 4 }}>
                <Text variant="heading">PMS subscription · {rupees(d.subscription.price_paise)}{d.subscription.plan === 'yearly' ? '/yr' : '/mo'}</Text>
                <Text>
                  {d.subscription.status === 'overdue' ? 'Overdue — ' : d.subscription.status === 'trial' ? 'Free trial — ' : 'Due '}
                  {d.subscription.current_period_end ? dayLabel(d.subscription.current_period_end) : ''}. Pay from Clinic profile on physionexs.com.
                </Text>
              </Card>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Tile label="Today" value={String(d.appointments_today)} />
              <Tile label="Waiting" value={String(d.tokens_waiting)} onPress={() => router.push('/clinic/queue')} />
              <Tile label="Patients" value={String(d.active_patients)} onPress={() => router.push('/clinic/patients')} />
            </View>
            {isOwner && d.revenue_week_paise != null && (
              <Card style={{ backgroundColor: colors.ink, borderColor: colors.ink }}>
                <Text variant="eyebrow" style={{ color: 'rgba(255,255,255,0.6)' }}>Revenue · this week</Text>
                <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 28, marginTop: 4 }}>{rupees(d.revenue_week_paise)}</Text>
              </Card>
            )}

            <Text variant="eyebrow">Today’s schedule</Text>
            {d.schedule.length === 0 ? <Text>No booked appointments today.</Text> : (
              <Card style={{ padding: 0 }}>
                {d.schedule.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                      <Text style={{ width: 64, fontFamily: font.semibold, color: colors.ink }}>{time(a.starts_at)}</Text>
                      <View style={{ flex: 1 }}>
                        <Text variant="heading">{a.patient_name}</Text>
                        <Text variant="caption">{a.mode === 'online' ? 'Online' : 'In-clinic'}{a.reason ? ` · ${a.reason}` : ''}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </Card>
            )}

            {d.attention.length > 0 && (
              <>
                <Text variant="eyebrow">Needs attention</Text>
                <Card style={{ padding: 0 }}>
                  {d.attention.map((p, i) => (
                    <View key={p.clinic_patient_id}>
                      {i > 0 && <Divider />}
                      <Pressable onPress={() => router.push({ pathname: '/clinic/patient/[id]', params: { id: p.clinic_patient_id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                        <Avatar name={p.name} size={34} />
                        <View style={{ flex: 1 }}>
                          <Text variant="heading">{p.name}</Text>
                          <Text variant="caption">{p.note}</Text>
                        </View>
                        <Text style={{ fontFamily: font.semibold, color: colors.danger }}>{p.adherence}%</Text>
                      </Pressable>
                    </View>
                  ))}
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Tile({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flex: 1, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 2 }}>
      <Text variant="eyebrow">{label}</Text>
      <Text style={{ fontFamily: font.bold, fontSize: 24, color: colors.ink }}>{value}</Text>
    </Pressable>
  )
}
