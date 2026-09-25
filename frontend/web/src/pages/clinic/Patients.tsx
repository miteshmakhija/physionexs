import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { PageHeader } from '@/components/ConsoleLayout'
import { Adherence } from '@/components/clinical'
import { Avatar, Input, Loader } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { shortDate } from '@shared/format'

export default function Patients() {
  const { clinicId } = useClinic()
  const [q, setQ] = useState('')
  const search = useDeferredValue(q.trim())
  const list = useQuery({
    queryKey: ['clinic-patients', search],
    queryFn: () => api<Schemas['PatientListItem'][]>('/clinic/patients', { clinicId, query: { q: search, limit: 100 } }),
  })

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle={list.data ? `${list.data.length} shown · sorted by recent activity` : undefined}
        actions={<Input placeholder="Search by name, phone or condition…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-80" aria-label="Search patients" />}
      />
      {list.isLoading ? (
        <Loader />
      ) : list.data?.length === 0 ? (
        <p className="border-y border-line py-10 text-center text-[14px] text-muted">
          {search ? 'No patients match.' : 'No patients yet. Walk-ins registered in the token queue and app bookings appear here.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-y border-line text-left text-[14px]">
            <thead>
              <tr className="border-b border-line">
                {['Patient', 'Condition', 'Last visit', 'Adherence', 'Status'].map((h) => (
                  <th key={h} className="eyebrow py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data?.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <td className="py-3">
                    <Link to={`/clinic/patients/${p.id}`} className="flex items-center gap-3">
                      <Avatar name={p.full_name} />
                      <span>
                        <span className="block font-semibold">{p.full_name}</span>
                        <span className="block text-[12.5px] text-muted">
                          {[p.age != null ? `${p.age} yrs` : null, p.sex, p.phone].filter(Boolean).join(' · ')}
                          {p.has_app && ' · App'}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="text-ink-2">{p.condition ?? <span className="text-subtle">No active plan</span>}</td>
                  <td className="text-muted">{p.last_visit_on ? shortDate(p.last_visit_on) : '—'}</td>
                  <td><Adherence pct={p.adherence_7d} /></td>
                  <td className="eyebrow">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

