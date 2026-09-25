import { Stack } from 'expo-router/stack'

import { colors, font } from '@shared/tokens'

export default function PatientStack() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: font.semibold, fontSize: 15 },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="find" options={{ title: 'Find a physio' }} />
      <Stack.Screen name="physio/[id]" options={{ title: '' }} />
      <Stack.Screen name="book/[id]" options={{ title: 'Book appointment' }} />
      <Stack.Screen name="pay" options={{ title: 'Payment', presentation: 'modal' }} />
      <Stack.Screen name="appointment/[id]" options={{ title: 'Appointment' }} />
      <Stack.Screen name="exercise/[id]" options={{ title: 'Exercise' }} />
    </Stack>
  )
}
