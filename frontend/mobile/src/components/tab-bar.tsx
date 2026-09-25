import Ionicons from '@expo/vector-icons/Ionicons'
import type { ComponentProps } from 'react'
import type { ColorValue } from 'react-native'

import { colors, font } from '@shared/tokens'

export type IconName = ComponentProps<typeof Ionicons>['name']

export const tabScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.ink,
  tabBarInactiveTintColor: colors.subtle,
  tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 11 },
  tabBarStyle: { borderTopColor: colors.line, backgroundColor: colors.surface },
  sceneStyle: { backgroundColor: colors.canvas },
}

export function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size - 2} />
  }
}
