import { Redirect } from 'expo-router'

import { useSession } from '@/auth/session'

export default function Index() {
  const { me } = useSession()
  if (!me) return <Redirect href="/sign-in" />
  if (me.role === 'patient') return <Redirect href="/patient" />
  if (me.role === 'super_admin') return <Redirect href="/admin" />
  return <Redirect href="/clinic" />
}
