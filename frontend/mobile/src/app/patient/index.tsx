import { Pressable, View } from 'react-native'

import { useSession } from '@/auth/session'
import { Avatar, Card, Screen, Text } from '@/components/ui'
import { colors, font } from '@shared/tokens'

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function PatientHome() {
  const { me, logout } = useSession()
  if (!me) return null

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

      <Card style={{ backgroundColor: colors.ink, borderColor: colors.ink, padding: 22 }}>
        <Text variant="eyebrow" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Physionexs Health Points
        </Text>
        <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 36, marginTop: 8 }}>0</Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)' }}>
          Log your exercises daily to build a streak and earn points off your next booking.
        </Text>
      </Card>

      <Card style={{ gap: 4 }}>
        <Text variant="heading">No upcoming appointments</Text>
        <Text>Find a physiotherapist near you and book in-clinic or online.</Text>
      </Card>

      <Card style={{ gap: 4 }}>
        <Text variant="heading">Visiting a clinic directly?</Text>
        <Text>Complete registration at the reception desk to receive your live token number.</Text>
      </Card>
    </Screen>
  )
}
