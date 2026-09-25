import { useSession } from '@/auth/session'
import { Button, Card, Screen, Text } from '@/components/ui'

export default function AdminNotice() {
  const { logout } = useSession()
  return (
    <Screen>
      <Card style={{ gap: 12, marginTop: 40 }}>
        <Text variant="title">Super Admin</Text>
        <Text>Platform administration is available on the web at physionexs.com/admin.</Text>
        <Button title="Log out" onPress={() => void logout()} />
      </Card>
    </Screen>
  )
}
