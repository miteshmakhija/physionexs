import { Tabs } from 'expo-router/js-tabs'

import { tabIcon, tabScreenOptions } from '@/components/tab-bar'

export default function PatientTabs() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home-outline') }} />
      <Tabs.Screen name="plan" options={{ title: 'Care plan', tabBarIcon: tabIcon('clipboard-outline') }} />
      <Tabs.Screen name="exercises" options={{ title: 'Exercises', tabBarIcon: tabIcon('barbell-outline') }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress', tabBarIcon: tabIcon('stats-chart-outline') }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: tabIcon('chatbubble-ellipses-outline') }} />
    </Tabs>
  )
}
