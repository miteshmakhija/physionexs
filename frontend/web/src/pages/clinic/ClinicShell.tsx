import { useAuth } from '@/auth/AuthProvider'
import { ConsoleLayout, type NavSection } from '@/components/ConsoleLayout'
import { Alert } from '@/components/ui'

export default function ClinicShell() {
  const { me } = useAuth()
  const membership = me?.memberships[0]
  const isOwner = membership?.role === 'owner'
  const isClinician = isOwner || membership?.role === 'physio'

  const sections: NavSection[] = [
    {
      items: [
        { to: '/clinic', label: 'Dashboard', end: true },
        { to: '/clinic/queue', label: 'Token queue' },
        { to: '/clinic/schedule', label: 'Schedule' },
        { to: '/clinic/patients', label: 'Patients' },
        { to: '/clinic/flags', label: 'Flags' },
        ...(isClinician ? [{ to: '/clinic/hours', label: 'Profile & hours' }] : []),
        ...(isOwner
          ? [
              { to: '/clinic/billing', label: 'Billing' },
              { to: '/clinic/analytics', label: 'Analytics' },
              { to: '/clinic/profile', label: 'Clinic profile' },
            ]
          : []),
      ],
    },
    { title: 'STAFF MANAGEMENT', items: [...(isOwner ? [{ to: '/clinic/staff', label: 'Staff' }] : []), { to: '/clinic/leave', label: 'My leave' }] },
    ...(me?.role === 'physio' ? [{ title: 'ACCOUNT', items: [{ to: '/clinic/security', label: 'Security' }] }] : []),
  ]

  const banner =
    me?.physio_verification === 'pending' ? (
      <div className="mb-6">
        <Alert tone="warning">
          Your council registration is being verified. You can set up your clinic now — your public profile goes live
          once it's approved.
        </Alert>
      </div>
    ) : me?.physio_verification === 'rejected' ? (
      <div className="mb-6">
        <Alert>We couldn't verify your council registration. Please contact support.</Alert>
      </div>
    ) : null

  return (
    <ConsoleLayout
      badge="PRACTICE CONSOLE"
      sections={sections}
      subtitle={membership ? `${membership.clinic_name} · ${isOwner ? 'Doctor-Admin' : 'Staff'}` : undefined}
      banner={banner}
    />
  )
}
