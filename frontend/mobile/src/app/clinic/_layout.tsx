import { Tabs } from 'expo-router/js-tabs'

import { tabIcon, tabScreenOptions } from '@/components/tab-bar'

export default function ClinicTabs() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home-outline') }} />
      <Tabs.Screen name="queue" options={{ title: 'Queue', tabBarIcon: tabIcon('people-outline') }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: tabIcon('calendar-outline') }} />
      <Tabs.Screen name="patients" options={{ title: 'Patients', tabBarIcon: tabIcon('folder-open-outline') }} />
    </Tabs>
  )
}
