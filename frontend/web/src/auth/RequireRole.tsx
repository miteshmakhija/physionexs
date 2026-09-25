import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { homePathFor, useAuth } from '@/auth/AuthProvider'
import type { Me } from '@/lib/api'
import { FullPageSpinner } from '@/components/ui'

export function RequireRole({ roles, children }: { roles: Me['role'][]; children: ReactNode }) {
  const { status, me } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner />
  if (!me) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />
  if (!roles.includes(me.role)) return <Navigate to={homePathFor(me)} replace />
  return children
}
