import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { homePathFor, useAuth } from '@/auth/AuthProvider'
import { RequireRole } from '@/auth/RequireRole'
import { FullPageSpinner } from '@/components/ui'
import AdminShell from '@/pages/admin/AdminShell'
import { AdminExerciseEditor, AdminExerciseList } from '@/pages/admin/Exercises'
import { AuditLogPage, RecordsPage, SettingsPage } from '@/pages/admin/Manage'
import { AdminAnalytics, AdminDashboard, AdminSubscriptions } from '@/pages/admin/Platform'
import Security from '@/pages/Security'
import Analytics from '@/pages/clinic/Analytics'
import { BillingList, InvoiceView, NewInvoice } from '@/pages/clinic/Billing'
import CameraMeasure from '@/pages/clinic/CameraMeasure'
import CarePlanForm from '@/pages/clinic/CarePlanForm'
import ClinicProfile from '@/pages/clinic/ClinicProfile'
import Dashboard from '@/pages/clinic/Dashboard'
import Flags from '@/pages/clinic/Flags'
import Consultation from '@/pages/clinic/Consultation'
import PatientFile from '@/pages/clinic/PatientFile'
import Patients from '@/pages/clinic/Patients'
import PrescribeExercises from '@/pages/clinic/PrescribeExercises'
import PrescribeMedicines from '@/pages/clinic/PrescribeMedicines'
import PrescriptionView from '@/pages/clinic/PrescriptionView'
import QueuePage from '@/pages/clinic/Queue'
import Validation, { AdminValidation } from '@/pages/clinic/Validation'
import Staff, { MyLeave } from '@/pages/clinic/Staff'
import CarePlan from '@/pages/patient/CarePlan'
import Exercises from '@/pages/patient/Exercises'
import { MyInvoice, MyInvoices } from '@/pages/patient/Invoices'
import PrescriptionPage from '@/pages/patient/PrescriptionPage'
import Progress from '@/pages/patient/Progress'
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
import GoogleCallback from '@/pages/public/GoogleCallback'
import SignIn from '@/pages/public/SignIn'

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { status, me } = useAuth()
  if (status === 'loading') return <FullPageSpinner />
  if (me) return <Navigate to={homePathFor(me)} replace />
  return children
}


const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/signin', element: <PublicOnly><SignIn /></PublicOnly> },
  { path: '/auth/google/callback', element: <GoogleCallback /> },
  {
    path: '/app',
    element: <RequireRole roles={['patient']}><PatientShell /></RequireRole>,
    children: [
      { index: true, element: <PatientHome /> },
      { path: 'find', element: <FindPhysio /> },
      { path: 'physios/:id', element: <PhysioProfile /> },
      { path: 'book/:id', element: <Book /> },
      { path: 'appointments/:id', element: <AppointmentDetail /> },
      { path: 'plan', element: <CarePlan /> },
      { path: 'prescriptions/:id', element: <PrescriptionPage /> },
      { path: 'invoices', element: <MyInvoices /> },
      { path: 'invoices/:id', element: <MyInvoice /> },
      { path: 'exercises', element: <Exercises /> },
      { path: 'progress', element: <Progress /> },
    ],
  },
  {
    path: '/clinic',
    element: <RequireRole roles={['physio', 'staff']}><ClinicShell /></RequireRole>,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'queue', element: <QueuePage /> },
      { path: 'schedule', element: <Schedule /> },
      { path: 'hours', element: <ProfileHours /> },
      { path: 'patients', element: <Patients /> },
      { path: 'flags', element: <Flags /> },
      { path: 'validation', element: <Validation /> },
      { path: 'patients/:id', element: <PatientFile /> },
      { path: 'patients/:id/consult', element: <Consultation /> },
      { path: 'patients/:id/plan', element: <CarePlanForm /> },
      { path: 'patients/:id/camera', element: <CameraMeasure /> },
      { path: 'patients/:id/exercises', element: <PrescribeExercises /> },
      { path: 'patients/:id/medicines', element: <PrescribeMedicines /> },
      { path: 'prescriptions/:id', element: <PrescriptionView /> },
      { path: 'billing', element: <BillingList /> },
      { path: 'billing/new', element: <NewInvoice /> },
      { path: 'billing/:id', element: <InvoiceView /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'profile', element: <ClinicProfile /> },
      { path: 'staff', element: <Staff /> },
      { path: 'leave', element: <MyLeave /> },
      { path: 'security', element: <Security /> },
    ],
  },
  {
    path: '/admin',
    element: <RequireRole roles={['super_admin']}><AdminShell /></RequireRole>,
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: 'verification', element: <Verification /> },
      { path: 'subscriptions', element: <AdminSubscriptions /> },
      { path: 'exercises', element: <AdminExerciseList /> },
      { path: 'exercises/:id', element: <AdminExerciseEditor /> },
      { path: 'analytics', element: <AdminAnalytics /> },
      { path: 'records', element: <RecordsPage /> },
      { path: 'security', element: <Security /> },
      { path: 'audit', element: <AuditLogPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'validation', element: <AdminValidation /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
