import { useAuth } from '@/auth/AuthProvider'

/** The clinic the signed-in physio/staff member works at (first membership for now). */
export function useClinic() {
  const { me } = useAuth()
  const membership = me?.memberships[0] ?? null
  return {
    clinicId: membership?.clinic_id ?? '',
    clinicName: membership?.clinic_name ?? '',
    role: membership?.role ?? null,
    isOwner: membership?.role === 'owner',
    isClinician: membership?.role === 'owner' || membership?.role === 'physio',
    // Recovery-twin pilot (knee tracking, check-ins, flags, camera), switched on per clinic by the Super Admin.
    twinPilot: membership?.twin_pilot ?? false,
    // AI assist (OpenAI drafts for physios): switched on per clinic and configured on the server.
    aiAssist: (membership?.twin_pilot && membership?.ai_assist) ?? false,
  }
}
