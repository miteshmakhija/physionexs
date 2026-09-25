import { Link } from 'react-router'

import { useAuth } from '@/auth/AuthProvider'
import { ConsoleLayout } from '@/components/ConsoleLayout'
import { Alert } from '@/components/ui'

export default function AdminShell() {
  const { me } = useAuth()
  return (
    <ConsoleLayout
      badge="SUPER ADMIN"
      subtitle="Super Admin"
      banner={
        me && !me.totp_enabled ? (
          <div className="mb-6">
            <Alert tone="warning">
              Two-factor authentication is required for Super Admin in production. <Link to="/admin/security" className="font-semibold underline">Set it up now</Link>.
            </Alert>
          </div>
        ) : null
      }
      sections={[
        { items: [{ to: '/admin', label: 'Dashboard', end: true }, { to: '/admin/records', label: 'Records' }] },
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
        { title: 'ACCOUNT', items: [{ to: '/admin/security', label: 'Security' }] },
      ]}
    />
  )
}
