import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router, type Href } from 'expo-router'
import { Stack } from 'expo-router/stack'
import * as Notifications from 'expo-notifications'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'

import { SessionProvider, useSession } from '@/auth/session'
import { registerForPush, routeFor } from '@/lib/push'
import { colors } from '@shared/tokens'

SplashScreen.preventAutoHideAsync()

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  })

  if (!fontsLoaded && !fontError) return null

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </SessionProvider>
    </QueryClientProvider>
  )
}

/** One app, screens by role: each group is reachable only when its guard is true. */
function RootNavigator() {
  const { status, me } = useSession()

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync()
  }, [status])

  // Push: register this phone once signed in; open the right screen when a notification is tapped.
  const role = me?.role
  useEffect(() => {
    if (!me) return
    void registerForPush()
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const to = routeFor(r.notification.request.content.data as Record<string, unknown>, me.role)
      if (to) router.push(to as Href)
    })
    return () => sub.remove()
  }, [me])

  if (status === 'loading') return null

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Protected guard={!me}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="physio-sign-in" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'patient'}>
        <Stack.Screen name="patient" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'physio' || role === 'staff'}>
        <Stack.Screen name="clinic" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'super_admin'}>
        <Stack.Screen name="admin" />
      </Stack.Protected>
      <Stack.Screen name="index" />
    </Stack>
  )
}
