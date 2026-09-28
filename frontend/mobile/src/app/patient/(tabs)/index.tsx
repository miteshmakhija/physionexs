import { useQuery } from '@tanstack/react-query'
import { Link, router } from 'expo-router'
import { Pressable, View } from 'react-native'

import { useSession } from '@/auth/session'
import { CheckinCard } from '@/components/CheckinCard'
import { SupportCard } from '@/components/Support'
import { Avatar, Button, Card, Divider, Screen, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { MODE_LABEL, rupees, when } from '@shared/format'
import { colors, font } from '@shared/tokens'

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function PatientHome() {
  const { me, logout } = useSession()
  const upcoming = useQuery({
    queryKey: ['my-appointments', 'upcoming'],
    queryFn: () => api<Schemas['AppointmentOut'][]>('/me/appointments', { query: { scope: 'upcoming' } }),
  })
  const points = useQuery({ queryKey: ['points'], queryFn: () => api<Schemas['PointsOut']>('/me/points') })
  const tokens = useQuery({ queryKey: ['my-tokens'], queryFn: () => api<Schemas['MyTokenOut'][]>('/me/tokens'), refetchInterval: 20_000 })
  if (!me) return null
  const balance = points.data?.balance ?? 0

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text variant="eyebrow">{greeting()}</Text>
          <Text variant="display">{me.full_name.split(' ')[0]}</Text>
        </View>
        <Pressable onLongPress={() => void logout()} accessibilityHint="Long-press to log out">
          <Avatar name={me.full_name} size={44} />
        </Pressable>
      </View>

      <CheckinCard />

      {tokens.data?.map((t) => (
        <Card key={t.label} style={{ gap: 4 }}>
          <Text variant="eyebrow">Your live token · {t.clinic_name}</Text>
          <Text style={{ fontFamily: font.bold, fontSize: 40, color: colors.ink }}>{t.label}</Text>
          <Text style={{ color: colors.ink, fontFamily: font.semibold }}>
            {t.status === 'serving' ? 'It’s your turn — please go in' : t.ahead === 0 ? 'You’re next' : `${t.ahead} patient${t.ahead === 1 ? '' : 's'} ahead`}
          </Text>
          {t.status !== 'serving' && <Text variant="caption">Est. wait ~{t.est_wait_minutes} min{t.now_serving ? ` · now serving ${t.now_serving}` : ''}</Text>}
        </Card>
      ))}

      <Card style={{ backgroundColor: colors.ink, borderColor: colors.ink, padding: 22 }}>
        <Text variant="eyebrow" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Physionexs Health Points
        </Text>
        <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 36, marginTop: 8 }}>{balance}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)' }}>
          {balance > 0
            ? `≈ ${rupees(balance * (points.data?.paise_per_point ?? 100))} off your next booking.`
            : 'Log your exercises daily to build a streak and earn points off your next booking.'}
        </Text>
      </Card>

      <View style={{ gap: 10 }}>
        <Text variant="eyebrow">Upcoming appointments</Text>
        {upcoming.data && upcoming.data.length > 0 ? (
          <Card style={{ padding: 0 }}>
            {upcoming.data.map((a, i) => (
              <View key={a.id}>
                {i > 0 && <Divider />}
                <Link href={{ pathname: '/patient/appointment/[id]', params: { id: a.id } }} asChild>
                  <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                    <Avatar name={a.physio.full_name} />
                    <View style={{ flex: 1 }}>
                      <Text variant="heading">{a.physio.full_name}</Text>
                      <Text variant="caption">
                        {when(a.starts_at)} · {MODE_LABEL[a.mode]}
                      </Text>
                    </View>
                  </Pressable>
                </Link>
              </View>
            ))}
          </Card>
        ) : (
          <Card style={{ gap: 4 }}>
            <Text variant="heading">No upcoming appointments</Text>
            <Text>Find a physiotherapist near you and book in-clinic or online.</Text>
          </Card>
        )}
        <Button title="Find a physio" onPress={() => router.push('/patient/find')} />
      </View>

      <Card style={{ gap: 4 }}>
        <Text variant="heading">Visiting a clinic directly?</Text>
        <Text>Complete registration at the reception desk to receive your live token number.</Text>
      </Card>

      <SupportCard />
    </Screen>
  )
}
