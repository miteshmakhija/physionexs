import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useClinic } from '@/auth/useClinic'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Avatar, Button, cx, Field, Input, Loader, Select, Stat, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { isoDay, rupees, shortDate } from '@shared/format'

type Tab = 'payroll' | 'attendance' | 'leave' | 'team'
const ATT = [
  { value: 'present', label: 'Present' },
  { value: 'half_day', label: 'Half-day' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'absent', label: 'Absent' },
] as const
const LEAVE_TYPES = [
  { value: 'casual', label: 'Casual' },
  { value: 'sick', label: 'Sick' },
  { value: 'earned', label: 'Earned' },
  { value: 'unpaid', label: 'Unpaid' },
] as const

export default function Staff() {
  const { clinicId } = useClinic()
  const [tab, setTab] = useState<Tab>('payroll')
  const today = useQuery({ queryKey: ['attendance', isoDay()], queryFn: () => api<Schemas['AttendanceDay']>('/clinic/attendance', { clinicId }) })
  const pending = useQuery({ queryKey: ['leave', 'pending'], queryFn: () => api<Schemas['LeaveOut'][]>('/clinic/leave', { clinicId, query: { status: 'pending' } }) })
  const payroll = useQuery({ queryKey: ['payroll', ''], queryFn: () => api<Schemas['PayrollOut']>('/clinic/payroll', { clinicId }) })
  const t = today.data
  const team = t?.rows.length ?? 0

  return (
    <div className="max-w-6xl">
      <PageHeader title="Staff management" subtitle="Payroll, attendance and leave for your clinic team" actions={<Button onClick={() => setTab('team')}>Add staff</Button>} />
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Team size" value={team} sub="active employees" />
        <Stat label="Present today" value={t ? t.present + t.half_day : '—'} sub={t && team ? `${Math.round((100 * (t.present + t.half_day)) / team)}% attendance` : undefined} />
        <Stat label="On leave" value={t?.on_leave ?? '—'} sub={`${pending.data?.length ?? 0} request(s) pending`} />
        <Stat label={`Payroll · ${payroll.data ? new Date(`${payroll.data.period}T00:00:00`).toLocaleString('en-IN', { month: 'long' }) : ''}`} value={rupees(payroll.data?.total_net_paise ?? 0)} sub={`${rupees(payroll.data?.pending_net_paise ?? 0)} pending`} />
      </div>
      <div className="mb-5 flex gap-5 border-b border-line">
        {(['payroll', 'attendance', 'leave', 'team'] as Tab[]).map((x) => (
          <button key={x} onClick={() => setTab(x)} className={cx('-mb-px border-b-2 pb-2 text-[13px] font-semibold capitalize', tab === x ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {x}{x === 'leave' && pending.data?.length ? ` · ${pending.data.length}` : ''}
          </button>
        ))}
      </div>
      {tab === 'payroll' && <Payroll clinicId={clinicId} />}
      {tab === 'attendance' && <Attendance clinicId={clinicId} />}
      {tab === 'leave' && <Leave clinicId={clinicId} />}
      {tab === 'team' && <Team clinicId={clinicId} />}
    </div>
  )
}

function Payroll({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => isoDay().slice(0, 7))
  const q = useQuery({ queryKey: ['payroll', month], queryFn: () => api<Schemas['PayrollOut']>('/clinic/payroll', { clinicId, query: { month } }) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['payroll'] })
  const run = useMutation({ mutationFn: () => api<Schemas['PayrollOut']>('/clinic/payroll/run', { method: 'POST', clinicId, query: { month } }), onSuccess: refresh })
  const pay = useMutation({ mutationFn: (id: string) => api(`/clinic/payroll/${id}/pay`, { method: 'POST', clinicId }), onSuccess: refresh })
  const p = q.data
  const ungenerated = p?.rows.filter((r) => !r.id).length ?? 0
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="!h-10 !w-44" aria-label="Month" />
          <span className="text-[13px] text-muted">Deductions: absent days, half-days and approved unpaid leave, pro rata.</span>
        </div>
        <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!p?.rows.length}>{ungenerated ? `Run payroll (${ungenerated})` : 'Recalculate unpaid'}</Button>
      </div>
      {!p ? <Loader /> : p.rows.length === 0 ? <p className="py-8 text-[14px] text-muted">No salaried team members. Add a monthly salary in the Team tab.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead><tr className="border-b border-line">{['Employee', 'Role', 'Gross', 'Deductions', 'Net pay', 'Status', ''].map((h) => <th key={h} className="eyebrow py-2.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line tabular-nums">
              {p.rows.map((r) => (
                <tr key={r.member_id}>
                  <td className="py-3"><span className="flex items-center gap-3"><Avatar name={r.name} /><span><span className="block font-semibold">{r.name}</span><span className="block text-[12px] text-muted">{r.employee_code}</span></span></span></td>
                  <td className="text-ink-2">{r.role}{r.department ? ` · ${r.department}` : ''}</td>
                  <td>{rupees(r.gross_paise)}</td>
                  <td className="text-muted">{r.deductions_paise ? `− ${rupees(r.deductions_paise)}` : '—'}{r.unpaid_days ? <span className="block text-[12px]">{r.unpaid_days} unpaid day(s)</span> : null}</td>
                  <td className="font-semibold">{rupees(r.net_paise)}</td>
                  <td className={cx('eyebrow', r.status === 'paid' ? '!text-leaf-dark' : '')}>{r.status ?? 'Not generated'}</td>
                  <td>{r.id && r.status !== 'paid' && <button className="eyebrow !text-ink hover:underline" onClick={() => pay.mutate(r.id!)} disabled={pay.isPending}>Mark paid</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Attendance({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient()
  const [day, setDay] = useState(isoDay())
  const q = useQuery({ queryKey: ['attendance', day], queryFn: () => api<Schemas['AttendanceDay']>('/clinic/attendance', { clinicId, query: { day } }) })
  const mark = useMutation({
    mutationFn: ({ member_id, status }: { member_id: string; status: string }) => api('/clinic/attendance', { method: 'PUT', clinicId, json: { member_id, day, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  })
  const a = q.data
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Input type="date" value={day} max={isoDay()} onChange={(e) => e.target.value && setDay(e.target.value)} className="!h-10 !w-44" aria-label="Day" />
        {a && <p className="text-[13px] text-muted">{a.present} present · {a.half_day} half-day · {a.on_leave} on leave · {a.absent} absent{a.unmarked ? ` · ${a.unmarked} not marked` : ''}</p>}
      </div>
      {mark.error && <div className="mb-3"><Alert>{(mark.error as Error).message}</Alert></div>}
      {!a ? <Loader /> : (
        <ul className="divide-y divide-line border-y border-line">
          {a.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-4 py-3 text-[14px]">
              <Avatar name={r.full_name} />
              <span className="min-w-0 flex-1"><span className="block font-semibold">{r.full_name}</span><span className="block text-[12.5px] text-muted">{r.job_title ?? r.role}{r.check_in ? ` · checked in ${r.check_in.slice(0, 5)}` : ''}</span></span>
              <div className="flex">
                {ATT.map((o) => (
                  <button key={o.value} onClick={() => mark.mutate({ member_id: r.id, status: o.value })} className={cx('-ml-px h-8 border px-3 text-[12.5px] first:ml-0', r.today === o.value ? 'relative z-10 border-ink bg-ink text-white' : 'border-line-strong hover:bg-surface-2')}>
                    {o.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Leave({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['leave', 'all'], queryFn: () => api<Schemas['LeaveOut'][]>('/clinic/leave', { clinicId }) })
  const decide = useMutation({
    mutationFn: ({ id, d }: { id: string; d: 'approve' | 'reject' }) => api(`/clinic/leave/${id}/${d}`, { method: 'POST', clinicId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leave'] })
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
  return !q.data ? <Loader /> : q.data.length === 0 ? <p className="py-8 text-[14px] text-muted">No leave requests. Team members request leave from “My leave”.</p> : (
    <ul className="divide-y divide-line border-y border-line">
      {q.data.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-4 py-3 text-[14px]">
          <Avatar name={l.name} />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{l.name} <span className="font-normal text-muted">· {l.leave_type} · {l.days} day{l.days === 1 ? '' : 's'}</span></span>
            <span className="block text-[12.5px] text-muted">{shortDate(l.from_date)} – {shortDate(l.to_date)}{l.reason ? ` · ${l.reason}` : ''}</span>
          </span>
          {l.status === 'pending' ? (
            <span className="flex gap-2">
              <Button variant="secondary" className="!h-9" onClick={() => decide.mutate({ id: l.id, d: 'reject' })} disabled={decide.isPending}>Reject</Button>
              <Button className="!h-9" onClick={() => decide.mutate({ id: l.id, d: 'approve' })} disabled={decide.isPending}>Approve</Button>
            </span>
          ) : <span className={cx('eyebrow', l.status === 'approved' ? '!text-leaf-dark' : '!text-danger')}>{l.status}</span>}
        </li>
      ))}
    </ul>
  )
}

function Team({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['staff'], queryFn: () => api<Schemas['StaffOut'][]>('/clinic/staff', { clinicId }) })
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Schemas['BranchOut'][]>('/clinic/branches', { clinicId }) })
  const empty = { full_name: '', phone: '', role: 'staff', job_title: '', department: '', salary: '', branch_id: '', registration_no: '' }
  const [f, setF] = useState(empty)
  const add = useMutation({
    mutationFn: () => api<Schemas['StaffOut']>('/clinic/staff', {
      method: 'POST', clinicId,
      json: { full_name: f.full_name, phone: f.phone, role: f.role, job_title: f.job_title || null, department: f.department || null, monthly_salary_paise: f.salary ? Math.round(Number(f.salary) * 100) : null, branch_id: f.branch_id || null, registration_no: f.registration_no || null },
    }),
    onSuccess: () => {
      setF(empty)
      void qc.invalidateQueries({ queryKey: ['staff'] })
      void qc.invalidateQueries({ queryKey: ['attendance'] })
      void qc.invalidateQueries({ queryKey: ['payroll'] })
    },
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <ul className="h-fit divide-y divide-line border-y border-line">
        {list.data?.map((m) => (
          <li key={m.id} className="flex items-center gap-4 py-3 text-[14px]">
            <Avatar name={m.full_name} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{m.full_name} <span className="eyebrow ml-1">{m.role === 'owner' ? 'Doctor-Admin' : m.role}</span></span>
              <span className="block text-[12.5px] text-muted">{[m.employee_code, m.job_title, m.department, m.branch_name, m.phone].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="tabular-nums text-muted">{m.monthly_salary_paise ? `${rupees(m.monthly_salary_paise)}/mo` : ''}</span>
          </li>
        ))}
      </ul>
      <form className="h-fit space-y-3 border border-line p-5" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
        <h2 className="text-[16px] font-semibold">Add team member</h2>
        <p className="text-[12.5px] text-muted">They sign in to Physionexs with a one-time code sent to this mobile number.</p>
        <Field label="Full name"><Input value={f.full_name} onChange={set('full_name')} required minLength={2} /></Field>
        <Field label="Mobile"><Input type="tel" value={f.phone} onChange={set('phone')} required /></Field>
        <Field label="Access">
          <Select value={f.role} onChange={set('role')}>
            <option value="staff">Staff — no billing or analytics, no clinical notes</option>
            <option value="physio">Physiotherapist — clinical notes & prescribing</option>
          </Select>
        </Field>
        {f.role === 'physio' && <Field label="Council registration no." hint="Printed on their prescriptions."><Input value={f.registration_no} onChange={set('registration_no')} /></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Job title"><Input value={f.job_title} onChange={set('job_title')} placeholder="Receptionist" /></Field>
          <Field label="Department"><Input value={f.department} onChange={set('department')} placeholder="Front desk" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly salary (₹)"><Input type="number" min={0} step={500} value={f.salary} onChange={set('salary')} /></Field>
          <Field label="Branch">
            <Select value={f.branch_id} onChange={set('branch_id')}><option value="">—</option>{branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          </Field>
        </div>
        {add.error && <Alert>{(add.error as Error).message}</Alert>}
        <Button type="submit" className="w-full" loading={add.isPending}>Add to team</Button>
      </form>
    </div>
  )
}

/** Every team member: request leave and see its status. */
export function MyLeave() {
  const { clinicId } = useClinic()
  const qc = useQueryClient()
  const mine = useQuery({ queryKey: ['leave', 'mine'], queryFn: () => api<Schemas['LeaveOut'][]>('/clinic/leave/mine', { clinicId }) })
  const [f, setF] = useState({ leave_type: 'casual', from_date: isoDay(), to_date: isoDay(), reason: '', half_day: false })
  const req = useMutation({
    mutationFn: () => api('/clinic/leave', { method: 'POST', clinicId, json: { ...f, to_date: f.half_day ? f.from_date : f.to_date, reason: f.reason || null } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave'] }),
  })
  return (
    <div className="max-w-3xl">
      <PageHeader title="My leave" subtitle="Requests go to your clinic owner for approval." />
      <form className="grid gap-3 border border-line p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); req.mutate() }}>
        <Field label="Type"><Select value={f.leave_type} onChange={(e) => setF({ ...f, leave_type: e.target.value })}>{LEAVE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></Field>
        <label className="flex items-end gap-2 pb-3 text-[14px]"><input type="checkbox" checked={f.half_day} onChange={(e) => setF({ ...f, half_day: e.target.checked })} className="accent-ink" /> Half day</label>
        <Field label="From"><Input type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value })} required /></Field>
        {!f.half_day && <Field label="To"><Input type="date" value={f.to_date} min={f.from_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} required /></Field>}
        <div className="sm:col-span-2"><Field label="Reason"><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field></div>
        {req.error && <div className="sm:col-span-2"><Alert>{(req.error as Error).message}</Alert></div>}
        <div className="sm:col-span-2"><Button type="submit" loading={req.isPending}>Request leave</Button></div>
      </form>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {mine.data?.map((l) => (
          <li key={l.id} className="flex justify-between gap-4 py-3 text-[14px]">
            <span>{l.leave_type} · {shortDate(l.from_date)} – {shortDate(l.to_date)} <span className="text-muted">({l.days} day{l.days === 1 ? '' : 's'})</span></span>
            <span className={cx('eyebrow', l.status === 'approved' ? '!text-leaf-dark' : l.status === 'rejected' ? '!text-danger' : '')}>{l.status}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
