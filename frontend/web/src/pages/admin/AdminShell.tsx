import { ConsoleLayout } from '@/components/ConsoleLayout'

export default function AdminShell() {
  return (
    <ConsoleLayout
      badge="SUPER ADMIN"
      subtitle="Super Admin"
      sections={[
        { items: [{ to: '/admin', label: 'Dashboard', end: true }] },
        {
          title: 'PLATFORM',
          items: [
            { to: '/admin/verification', label: 'Verification' },
            { to: '/admin/subscriptions', label: 'Subscriptions' },
            { to: '/admin/exercises', label: 'Exercise library' },
            { to: '/admin/analytics', label: 'Analytics' },
            { to: '/admin/audit', label: 'Audit log' },
            { to: '/admin/settings', label: 'Settings' },
          ],
        },
      ]}
    />
  )
}
