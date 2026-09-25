import { Pressable, View } from 'react-native'

import { useSession } from '@/auth/session'
import { Avatar, Card, Screen, Text } from '@/components/ui'
import { colors } from '@shared/tokens'

export default function ClinicHome() {
  const { me, logout } = useSession()
  if (!me) return null
  const membership = me.memberships[0]

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onLongPress={() => void logout()} accessibilityHint="Long-press to log out">
          <Avatar name={me.full_name} size={44} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="heading">{me.full_name}</Text>
          <Text variant="caption">
            {membership ? `${membership.clinic_name} · ${membership.role === 'owner' ? 'Doctor-Admin' : 'Staff'}` : 'No clinic'}
          </Text>
        </View>
      </View>

      {me.physio_verification === 'pending' && (
        <Card style={{ backgroundColor: colors.amberTint, borderColor: colors.amberTint }}>
          <Text style={{ color: colors.amber }}>
            Your council registration is being verified. Your public profile goes live once it’s approved.
          </Text>
        </Card>
      )}

      <Card style={{ gap: 4 }}>
        <Text variant="heading">Now serving</Text>
        <Text>No walk-ins in the queue yet. Tokens registered at reception appear here.</Text>
      </Card>
    </Screen>
  )
}
