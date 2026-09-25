import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { homePathFor, useAuth } from '@/auth/AuthProvider'
import { RequireRole } from '@/auth/RequireRole'
import { ComingSoon } from '@/components/ConsoleLayout'
import { FullPageSpinner } from '@/components/ui'
import AdminShell from '@/pages/admin/AdminShell'
import Verification from '@/pages/admin/Verification'
import ClinicShell from '@/pages/clinic/ClinicShell'
import ProfileHours from '@/pages/clinic/ProfileHours'
import Schedule from '@/pages/clinic/Schedule'
import AppointmentDetail from '@/pages/patient/AppointmentDetail'
import Book from '@/pages/patient/Book'
import FindPhysio from '@/pages/patient/FindPhysio'
import PatientHome from '@/pages/patient/PatientHome'
import PatientShell from '@/pages/patient/PatientShell'
import PhysioProfile from '@/pages/patient/PhysioProfile'
import Landing from '@/pages/public/Landing'
import SignIn from '@/pages/public/SignIn'

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { status, me } = useAuth()
  if (status === 'loading') return <FullPageSpinner />
  if (me) return <Navigate to={homePathFor(me)} replace />
  return children
}

const soon = (title: string, items: string[], subtitle?: string) => <ComingSoon title={title} subtitle={subtitle} items={items} />

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/signin', element: <PublicOnly><SignIn /></PublicOnly> },
  {
    path: '/app',
    element: <RequireRole roles={['patient']}><PatientShell /></RequireRole>,
    children: [
      { index: true, element: <PatientHome /> },
      { path: 'find', element: <FindPhysio /> },
      { path: 'physios/:id', element: <PhysioProfile /> },
      { path: 'book/:id', element: <Book /> },
      { path: 'appointments/:id', element: <AppointmentDetail /> },
      { path: 'plan', element: soon('My care plan', ['Diagnosis, goal and stage', 'Physio’s notes', 'Test results', 'Prescriptions']) },
      { path: 'exercises', element: soon('Exercises', ['Today’s exercises', 'Step-by-step guidance with video', 'Log sets and how it felt']) },
      { path: 'progress', element: soon('Progress', ['Adherence and streaks', 'Pain trend', 'Exercise completion']) },
    ],
  },
  {
    path: '/clinic',
    element: <RequireRole roles={['physio', 'staff']}><ClinicShell /></RequireRole>,
    children: [
      { index: true, element: soon('Dashboard', ['Appointments today, tokens waiting, active patients', 'Branch breakdown', 'Today’s schedule', 'Patients needing attention'], 'Here’s how your clinic is doing today.') },
      { path: 'queue', element: soon('Token queue', ['Register walk-ins', 'Now serving / call next', 'Live wait estimates on the patient app']) },
      { path: 'schedule', element: <Schedule /> },
      { path: 'hours', element: <ProfileHours /> },
      { path: 'patients', element: soon('Patients', ['Patient files', 'SOAP consultation notes', 'Medical background & functional analysis', 'Prescribe exercises, medicines & tests']) },
      { path: 'billing', element: soon('Billing & invoices', ['Invoices on your letterhead', 'Collections and dues', 'PDF / print']) },
      { path: 'analytics', element: soon('Analytics', ['Revenue, appointments, adherence, no-shows', 'Conditions treated', 'Online vs in-clinic']) },
      { path: 'profile', element: soon('Clinic profile', ['Logo & letterhead', 'Contact details & GSTIN', 'Branches', 'PMS subscription']) },
      { path: 'staff', element: soon('Staff management', ['Payroll', 'Attendance', 'Leave approvals']) },
    ],
  },
  {
    path: '/admin',
    element: <RequireRole roles={['super_admin']}><AdminShell /></RequireRole>,
    children: [
      { index: true, element: soon('Platform overview', ['Pending verifications', 'Onboarding & bookings', 'Revenue split — patients & doctors']) },
      { path: 'verification', element: <Verification /> },
      { path: 'subscriptions', element: soon('PMS subscriptions', ['MRR / ARR', 'Per-clinic price & plan', 'Overdue reminders']) },
      { path: 'exercises', element: soon('Exercise library', ['Author & publish platform exercises', 'Review clinic submissions', 'Video & photo uploads']) },
      { path: 'analytics', element: soon('Analytics', ['Growth', 'Bookings by treatment', 'Revenue']) },
      { path: 'audit', element: soon('Audit log', ['Every create, update and delete across the platform']) },
      { path: 'settings', element: soon('Platform settings', ['Rewards & points', 'Support contacts', 'Reminders', 'Pricing & platform fee']) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
