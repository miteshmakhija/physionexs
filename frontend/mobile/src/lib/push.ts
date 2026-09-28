// Push notifications: register this phone with the API after sign-in, and remove it on sign-out.
// Needs a development/EAS build (not Expo Go) and an EAS project id (run `eas init`); until then this is a no-op.
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { api } from '@/lib/api'

const TOKEN_KEY = 'pnx_push_token'

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
}

/** Ask permission (once) and register the Expo push token. Returns the token, or null if unavailable. */
export async function registerForPush(): Promise<string | null> {
  const id = projectId()
  if (!Device.isDevice || !id) return null
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Updates', importance: Notifications.AndroidImportance.DEFAULT })
  }
  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return null
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data
    await api('/me/devices', { method: 'POST', json: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } })
    await SecureStore.setItemAsync(TOKEN_KEY, token)
    return token
  } catch {
    return null // no network or push not configured: try again next launch
  }
}

/** Call before signing out so this phone stops getting the user's notifications. */
export async function unregisterPush(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY)
  if (!token) return
  try {
    await api('/me/devices', { method: 'DELETE', json: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } })
  } catch {
    // signed out anyway; the server drops tokens Expo reports as unregistered
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

/** Where a tapped notification should take the user. */
export function routeFor(data: Record<string, unknown> | undefined, role: string | undefined): string | null {
  const kind = data?.kind
  if (role === 'patient') {
    if (kind === 'plan_updated') return '/patient/plan'
    if (kind === 'checkin_reminder') return '/patient'
    if (kind === 'appointment_reminder' && typeof data?.appointment_id === 'string') return `/patient/appointment/${data.appointment_id}`
    return '/patient'
  }
  return role === 'physio' || role === 'staff' ? '/clinic' : null
}
