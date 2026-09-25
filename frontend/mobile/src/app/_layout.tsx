import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router/stack'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'

import { SessionProvider, useSession } from '@/auth/session'
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

  if (status === 'loading') return null

  const role = me?.role
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
