import { Stack } from 'expo-router/stack'

import { colors, font } from '@shared/tokens'

export default function ClinicStack() {
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
      <Stack.Screen name="patient/[id]" options={{ title: 'Patient file' }} />
      <Stack.Screen name="patient/consult" options={{ title: 'Consultation', presentation: 'modal' }} />
    </Stack>
  )
}
