import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Avatar, Button, Spinner } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

type Item = Schemas['VerificationItem']

export default function Verification() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['verifications'], queryFn: () => api<Item[]>('/admin/verifications') })
  const decide = useMutation({
    mutationFn: ({ id, approve, reason }: { id: string; approve: boolean; reason?: string }) =>
      api<Item>(`/admin/verifications/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', json: approve ? undefined : { reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verifications'] }),
  })

  const reject = (item: Item) => {
    const reason = window.prompt(`Reason for rejecting ${item.full_name} (sent to them):`)
    if (reason && reason.trim().length >= 3) decide.mutate({ id: item.user_id, approve: false, reason: reason.trim() })
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Physiotherapist verification" subtitle="Confirm council registration before a profile goes live on the platform." />
      {decide.error && <div className="mb-4"><Alert>{(decide.error as Error).message}</Alert></div>}
      {list.isLoading ? (
        <div className="grid place-items-center py-16 text-muted"><Spinner /></div>
      ) : list.data?.length === 0 ? (
        <div className="border-y border-line py-14 text-center">
          <p className="text-[16px] font-semibold">All caught up</p>
          <p className="mt-1 text-[13.5px] text-muted">No physiotherapists awaiting verification.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.data?.map((d) => (
            <li key={d.user_id} className="flex flex-wrap items-center gap-4 py-5">
              <Avatar name={d.full_name} className="size-11" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{d.full_name}</p>
                <p className="text-[13px] text-muted">
                  {[d.qualification, d.clinic_name, d.city].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-1 text-[13px]">
                  Reg. No. <span className="font-semibold">{d.registration_no}</span>
                  {d.council && <span className="text-muted"> · {d.council}</span>}
                  <span className="text-muted"> · {[d.email, d.phone].filter(Boolean).join(' · ')}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => reject(d)} disabled={decide.isPending}>Reject</Button>
                <Button onClick={() => decide.mutate({ id: d.user_id, approve: true })} disabled={decide.isPending}>Approve & publish</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
