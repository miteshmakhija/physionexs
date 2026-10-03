import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useClinic } from '@/auth/useClinic'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Button, Field, Input, Spinner } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { WEEKDAYS } from '@shared/format'

type Profile = Schemas['PhysioProfileOut']
type Block = { weekday: number; start_time: string; end_time: string; branch_id?: string }

const DEFAULT_BLOCKS: Block[] = [0, 1, 2, 3, 4, 5].flatMap((d) => [
  { weekday: d, start_time: '09:00', end_time: '13:00' },
  { weekday: d, start_time: '15:00', end_time: '19:00' },
])

export default function ProfileHours() {
  const { clinicId } = useClinic()
  const profile = useQuery({ queryKey: ['physio-profile'], queryFn: () => api<Profile>('/clinic/physio-profile', { clinicId }) })
  const hours = useQuery({ queryKey: ['availability'], queryFn: () => api<Schemas['AvailabilityItem'][]>('/clinic/availability', { clinicId }) })
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Schemas['BranchOut'][]>('/clinic/branches', { clinicId }) })

  if (profile.isLoading || hours.isLoading || branches.isLoading) return <div className="grid place-items-center py-20 text-muted"><Spinner /></div>
  if (profile.isError) return <Alert>{(profile.error as Error).message}</Alert>

  return (
    <div className="max-w-3xl">
      <PageHeader title="Profile & hours" subtitle="What patients see on Physionexs, and when they can book you." />
      <ProfileForm initial={profile.data!} clinicId={clinicId} />
      <HoursForm initial={hours.data ?? []} branches={branches.data ?? []} clinicId={clinicId} />
    </div>
  )
}

function ProfileForm({ initial, clinicId }: { initial: Profile; clinicId: string }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    qualification: initial.qualification ?? '',
    bio: initial.bio ?? '',
    college: initial.college ?? '',
    experience_years: initial.experience_years?.toString() ?? '',
    specializations: (initial.specializations ?? []).join(', '),
    languages: (initial.languages ?? []).join(', '),
    offers_in_clinic: initial.offers_in_clinic ?? true,
    offers_online: initial.offers_online ?? false,
    fee_in_clinic: initial.fee_in_clinic_paise ? String(initial.fee_in_clinic_paise / 100) : '',
    fee_online: initial.fee_online_paise ? String(initial.fee_online_paise / 100) : '',
  })
  const save = useMutation({
    mutationFn: () =>
      api<Profile>('/clinic/physio-profile', {
        method: 'PUT',
        clinicId,
        json: {
          qualification: form.qualification || null,
          bio: form.bio || null,
          college: form.college || null,
          experience_years: form.experience_years ? Number(form.experience_years) : null,
          specializations: split(form.specializations),
          languages: split(form.languages),
          offers_in_clinic: form.offers_in_clinic,
          offers_online: form.offers_online,
          fee_in_clinic_paise: form.fee_in_clinic ? Math.round(Number(form.fee_in_clinic) * 100) : null,
          fee_online_paise: form.fee_online ? Math.round(Number(form.fee_online) * 100) : null,
        },
      }),
    onSuccess: (p) => qc.setQueryData(['physio-profile'], p),
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <section className="border-t border-line pt-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="eyebrow">Public profile</h2>
        <span className="text-[12.5px] text-muted">
          Reg. No. {initial.registration_no} · {initial.verification_status === 'approved' ? 'Verified ✓' : initial.verification_status === 'pending' ? 'Verification pending' : 'Not verified'}
        </span>
      </div>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Field label="Qualification"><Input value={form.qualification} onChange={set('qualification')} placeholder="MPT (Ortho)" /></Field>
        <Field label="Years of experience"><Input type="number" min={0} max={70} value={form.experience_years} onChange={set('experience_years')} /></Field>
        <div className="sm:col-span-2">
          <Field label="About you">
            <textarea
              value={form.bio}
              onChange={set('bio')}
              rows={4}
              maxLength={2000}
              className="w-full rounded-md border border-line-strong p-3.5 text-[14px] focus:border-ink focus:outline-none"
              placeholder="What you treat and how you work."
            />
          </Field>
        </div>
        <Field label="Educated at"><Input value={form.college} onChange={set('college')} /></Field>
        <Field label="Languages" hint="Comma separated"><Input value={form.languages} onChange={set('languages')} placeholder="English, Hindi" /></Field>
        <div className="sm:col-span-2">
          <Field label="Specializations" hint="Comma separated — patients can search for these">
            <Input value={form.specializations} onChange={set('specializations')} placeholder="Knee, Sports injury, Post-surgical" />
          </Field>
        </div>
        <FeeToggle
          label="In-clinic visit"
          checked={form.offers_in_clinic}
          onToggle={(v) => setForm({ ...form, offers_in_clinic: v })}
          value={form.fee_in_clinic}
          onChange={set('fee_in_clinic')}
        />
        <FeeToggle
          label="Online video"
          checked={form.offers_online}
          onToggle={(v) => setForm({ ...form, offers_online: v })}
          value={form.fee_online}
          onChange={set('fee_online')}
        />
        <div className="flex items-center gap-4 sm:col-span-2">
          <Button type="submit" loading={save.isPending}>Save profile</Button>
          {save.isSuccess && <span className="text-[13px] text-leaf-dark">Saved</span>}
          {save.error && <span className="text-[13px] text-danger">{(save.error as Error).message}</span>}
        </div>
      </form>
    </section>
  )
}

function FeeToggle(props: { label: string; checked: boolean; onToggle: (v: boolean) => void; value: string; onChange: (e: { target: { value: string } }) => void }) {
  return (
    <div className="border border-line p-4">
      <label className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold">
        <input type="checkbox" checked={props.checked} onChange={(e) => props.onToggle(e.target.checked)} className="accent-ink" />
        {props.label}
      </label>
      {props.checked && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[14px] text-muted">₹</span>
          <Input type="number" min={0} step={50} value={props.value} onChange={props.onChange} required aria-label={`${props.label} fee`} />
        </div>
      )}
    </div>
  )
}

function HoursForm({ initial, branches, clinicId }: { initial: Schemas['AvailabilityItem'][]; branches: Schemas['BranchOut'][]; clinicId: string }) {
  const qc = useQueryClient()
  // Each block of hours belongs to a branch, so a physio can work Mon–Wed at one branch and Thu–Sat at another.
  const defaultBranch = branches[0]?.id ?? ''
  const [slotMinutes, setSlotMinutes] = useState(initial[0]?.slot_minutes ?? 30)
  const [blocks, setBlocks] = useState<Block[]>(
    initial.length ? initial.map((a) => ({ weekday: a.weekday, start_time: a.start_time.slice(0, 5), end_time: a.end_time.slice(0, 5), branch_id: a.branch_id })) : [],
  )
  const save = useMutation({
    mutationFn: () =>
      api<Schemas['AvailabilityItem'][]>('/clinic/availability', {
        method: 'PUT',
        clinicId,
        json: { items: blocks.map((b) => ({ ...b, branch_id: b.branch_id || defaultBranch, slot_minutes: slotMinutes })) },
      }),
    onSuccess: (items) => qc.setQueryData(['availability'], items),
  })

  const update = (i: number, patch: Partial<Block>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)))

  return (
    <section className="mt-10 border-t border-line pt-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="eyebrow">Weekly hours</h2>
        <div className="flex items-center gap-3 text-[13px]">
          <label className="flex items-center gap-2 text-muted">
            Slot length
            <select value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))} className="h-9 rounded-sm border border-line-strong px-2 text-ink">
              {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
        </div>
      </div>

      {blocks.length === 0 && (
        <div className="mb-4 border border-dashed border-line-strong p-5 text-[14px] text-muted">
          No working hours yet — patients can't book you until you add some.{' '}
          <button className="font-semibold text-ink underline" onClick={() => setBlocks(DEFAULT_BLOCKS)}>
            Use Mon–Sat, 9–1 & 3–7
          </button>
        </div>
      )}

      <div className="divide-y divide-line border-y border-line">
        {WEEKDAYS.map((day, d) => {
          const rows = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.weekday === d)
          return (
            <div key={day} className="flex flex-wrap items-start gap-4 py-3">
              <span className="w-28 pt-2 text-[14px] font-medium">{day}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {rows.length === 0 && <span className="pt-2 text-[13px] text-subtle">Closed</span>}
                {rows.map(({ b, i }) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Input type="time" value={b.start_time} onChange={(e) => update(i, { start_time: e.target.value })} className="!h-9 !w-32" aria-label={`${day} start`} />
                    <span className="text-muted">to</span>
                    <Input type="time" value={b.end_time} onChange={(e) => update(i, { end_time: e.target.value })} className="!h-9 !w-32" aria-label={`${day} end`} />
                    {branches.length > 1 && (
                      <select value={b.branch_id || defaultBranch} onChange={(e) => update(i, { branch_id: e.target.value })} className="h-9 min-w-0 max-w-full rounded-sm border border-line-strong px-2" aria-label={`${day} branch`}>
                        {branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
                      </select>
                    )}
                    <button onClick={() => setBlocks(blocks.filter((_, j) => j !== i))} className="px-2 text-muted hover:text-danger" aria-label="Remove">✕</button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setBlocks([...blocks, { weekday: d, start_time: '09:00', end_time: '13:00', branch_id: rows.at(-1)?.b.branch_id ?? defaultBranch }])}
                className="eyebrow pt-2 !text-ink hover:underline"
              >
                + Add hours
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-5 flex items-center gap-4">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!defaultBranch}>Save hours</Button>
        {save.isSuccess && <span className="text-[13px] text-leaf-dark">Saved — patients can book these slots</span>}
        {save.error && <span className="text-[13px] text-danger">{(save.error as Error).message}</span>}
      </div>
    </section>
  )
}

function split(s: string) {
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}
