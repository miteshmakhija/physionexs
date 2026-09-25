import { useSession } from '@/auth/session'

/** The clinic the signed-in physio/staff member works at (first membership for now). */
export function useClinic() {
  const { me } = useSession()
  const membership = me?.memberships[0] ?? null
  return {
    clinicId: membership?.clinic_id ?? '',
    clinicName: membership?.clinic_name ?? '',
    isOwner: membership?.role === 'owner',
    // Clinical notes and prescribing are for physiotherapists; staff can view and run the queue.
    isClinician: membership?.role === 'owner' || membership?.role === 'physio',
  }
}
