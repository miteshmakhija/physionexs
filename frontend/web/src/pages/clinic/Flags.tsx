import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useClinic } from '@/auth/useClinic'
import { PageHeader } from '@/components/ConsoleLayout'
import { FlagList } from '@/components/flags'
import { Loader, Segmented } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

/** Flags inbox: what the recovery-twin rules want a physio to look at. */
export default function Flags() {
  const { clinicId, isOwner, role } = useClinic()
  const [state, setState] = useState<'active' | 'closed'>('active')
  const q = useQuery({
    queryKey: ['flags', state],
    queryFn: () => api<Schemas['FlagOut'][]>('/clinic/flags', { clinicId, query: { state } }),
    refetchInterval: 60_000,
  })

  return (
    <div className="max-w-4xl">
      <PageHeader title="Flags" subtitle="Raised automatically from check-ins, knee readings and exercise logs. Nothing changes a patient’s plan on its own." />
      <div className="mb-4 max-w-xs">
        <Segmented value={state} onChange={setState} options={[{ value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }]} />
      </div>
      {!q.data ? <Loader /> : q.data.length === 0 ? (
        <p className="border-y border-line py-10 text-center text-[14px] text-muted">{state === 'active' ? 'Nothing needs attention right now.' : 'No closed flags yet.'}</p>
      ) : (
        <FlagList flags={q.data} clinicId={clinicId} canWrite={isOwner || role === 'physio'} />
      )}
    </div>
  )
}
