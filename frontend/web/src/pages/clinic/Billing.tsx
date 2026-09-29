import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { InvoiceDocument } from '@/components/clinical'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Button, cx, Field, Input, Loader, Select, Stat, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { rupees, shortDate } from '@shared/format'

type Status = '' | 'due' | 'paid' | 'void'
const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'netbanking', label: 'Net banking' },
  { value: 'other', label: 'Other' },
] as const

export function BillingList() {
  const { clinicId } = useClinic()
  const [status, setStatus] = useState<Status>('')
  const [q, setQ] = useState('')
  const search = useDeferredValue(q.trim())
  const page = useQuery({
    queryKey: ['invoices', status, search],
    queryFn: () => api<Schemas['InvoicePage']>('/clinic/invoices', { clinicId, query: { status, q: search, limit: 100 } }),
    placeholderData: (p) => p,
  })
  const s = page.data?.summary
  const delta = s && s.prev_month_paise ? Math.round((100 * (s.month_paise - s.prev_month_paise)) / s.prev_month_paise) : null

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Billing & invoices"
        subtitle="Payments, dues and receipts"
        actions={<Link to="/clinic/billing/new" className="flex h-11 items-center bg-ink px-5 text-[12.5px] font-semibold uppercase tracking-[0.09em] text-white hover:bg-ink-2">Create invoice</Link>}
      />
      {s && (
        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          <Stat label="Collected today" value={rupees(s.collected_today_paise)} sub={`${s.collected_today_count} paid invoice${s.collected_today_count === 1 ? '' : 's'}`} />
          <Stat label="Outstanding" value={rupees(s.outstanding_paise)} sub={`${s.outstanding_count} invoice${s.outstanding_count === 1 ? '' : 's'} due`} />
          <Stat label="This month" value={rupees(s.month_paise)} sub={delta == null ? 'collected' : `${delta >= 0 ? '+' : ''}${delta}% vs last month`} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-4 border-b border-line">
        {(['', 'due', 'paid', 'void'] as Status[]).map((v) => (
          <button key={v || 'all'} onClick={() => setStatus(v)} className={cx('-mb-px border-b-2 pb-2 text-[13px] font-semibold capitalize', status === v ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {v || 'All'}
          </button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient or invoice no." className="!mb-2 ml-auto !h-9 !w-72" aria-label="Search invoices" />
      </div>
      {page.isLoading ? <Loader /> : page.data?.items.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-muted">No invoices yet. Paid app bookings are invoiced automatically.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line">
                {['Invoice', 'Patient', 'Service', 'Date', 'Amount', 'Status'].map((h) => <th key={h} className="eyebrow py-2.5 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {page.data?.items.map((v) => (
                <tr key={v.id} className="hover:bg-surface-2">
                  <td className="py-3"><Link to={`/clinic/billing/${v.id}`} className="font-semibold hover:underline">{v.number}</Link></td>
                  <td>{v.patient_name}</td>
                  <td className="text-ink-2">{v.service}{v.from_app && <span className="eyebrow ml-2 !text-brand">App</span>}</td>
                  <td className="text-muted">{shortDate(v.issued_on)}</td>
                  <td className="tabular-nums">{rupees(v.total_paise)}</td>
                  <td className={cx('eyebrow', v.status === 'paid' ? '!text-leaf-dark' : v.status === 'due' ? '!text-amber' : '')}>{v.status}{v.paid_via ? ` · ${v.paid_via}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type Line = { description: string; detail: string; quantity: number; rate: string }

export function NewInvoice() {
  const { clinicId } = useClinic()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [patientQ, setPatientQ] = useState('')
  const [patient, setPatient] = useState<Schemas['PatientListItem'] | null>(null)
  const [lines, setLines] = useState<Line[]>([{ description: 'Physiotherapy session', detail: '', quantity: 1, rate: '800' }])
  const [dueOn, setDueOn] = useState('')
  const [notes, setNotes] = useState('')
  const [paidVia, setPaidVia] = useState('')
  const search = useDeferredValue(patientQ.trim())
  const patients = useQuery({
    queryKey: ['clinic-patients', search],
    queryFn: () => api<Schemas['PatientListItem'][]>('/clinic/patients', { clinicId, query: { q: search, limit: 8 } }),
    enabled: !patient,
  })
  const total = lines.reduce((n, l) => n + Math.round(Number(l.rate || 0) * 100) * l.quantity, 0)
  const create = useMutation({
    mutationFn: () =>
      api<Schemas['InvoiceOut']>('/clinic/invoices', {
        method: 'POST',
        clinicId,
        json: {
          clinic_patient_id: patient!.id,
          items: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, detail: l.detail || null, quantity: l.quantity, rate_paise: Math.round(Number(l.rate || 0) * 100) })),
          due_on: dueOn || null,
          notes: notes || null,
          paid_via: paidVia || null,
        },
      }),
    onSuccess: (inv) => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      navigate(`/clinic/billing/${inv.id}`, { replace: true })
    },
  })
  const update = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <div className="max-w-3xl">
      <Link to="/clinic/billing" className="eyebrow hover:underline">← Billing</Link>
      <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Create invoice</h1>

      <section className="mt-6">
        <h2 className="eyebrow mb-2">Patient</h2>
        {patient ? (
          <div className="flex items-center justify-between border border-ink p-3 text-[14px]">
            <span><span className="font-semibold">{patient.full_name}</span> <span className="text-muted">{patient.phone}</span></span>
            <button className="eyebrow !text-ink hover:underline" onClick={() => setPatient(null)}>Change</button>
          </div>
        ) : (
          <>
            <Input value={patientQ} onChange={(e) => setPatientQ(e.target.value)} placeholder="Search by name or phone…" autoFocus aria-label="Search patient" />
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {patients.data?.map((p) => (
                <li key={p.id}><button onClick={() => setPatient(p)} className="w-full py-2.5 text-left text-[14px] hover:bg-surface-2">{p.full_name} <span className="text-muted">· {p.phone ?? 'no phone'}</span></button></li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="eyebrow mb-2">Items</h2>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1.4fr_70px_110px_auto]">
              <Input value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Description" className="!h-10" aria-label="Description" />
              <Input value={l.detail} onChange={(e) => update(i, { detail: e.target.value })} placeholder="Detail (optional)" className="!h-10" aria-label="Detail" />
              <Input type="number" min={1} value={l.quantity} onChange={(e) => update(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} className="!h-10" aria-label="Quantity" />
              <Input type="number" min={0} step={50} value={l.rate} onChange={(e) => update(i, { rate: e.target.value })} placeholder="₹ rate" className="!h-10" aria-label="Rate" />
              <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="px-2 text-muted hover:text-danger" aria-label="Remove">✕</button>
            </div>
          ))}
        </div>
        <button onClick={() => setLines([...lines, { description: '', detail: '', quantity: 1, rate: '' }])} className="eyebrow mt-3 !text-ink hover:underline">+ Add item</button>
        <p className="mt-4 text-right text-[18px] font-bold tabular-nums">Total {rupees(total)}</p>
        <p className="text-right text-[12px] text-muted">GST exempt · healthcare services</p>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Due date"><Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field>
        <Field label="Already paid?">
          <Select value={paidVia} onChange={(e) => setPaidVia(e.target.value)}>
            <option value="">No — mark as due</option>
            {METHODS.map((m) => <option key={m.value} value={m.value}>Paid · {m.label}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      </section>
      {create.error && <div className="mt-4"><Alert>{(create.error as Error).message}</Alert></div>}
      <Button className="mt-6" onClick={() => create.mutate()} loading={create.isPending} disabled={!patient || total <= 0}>Create invoice</Button>
    </div>
  )
}

export function InvoiceView() {
  const { id } = useParams()
  const { clinicId, isOwner } = useClinic()
  const qc = useQueryClient()
  const [method, setMethod] = useState('cash')
  const inv = useQuery({ queryKey: ['invoice', id], queryFn: () => api<Schemas['InvoiceOut']>(`/clinic/invoices/${id}`, { clinicId }) })
  const act = useMutation({
    mutationFn: (action: 'pay' | 'void') => api<Schemas['InvoiceOut']>(`/clinic/invoices/${id}/${action}`, { method: 'POST', clinicId, json: action === 'pay' ? { method } : undefined }),
    onSuccess: (data) => {
      qc.setQueryData(['invoice', id], data)
      void qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
  if (inv.isLoading) return <Loader />
  if (!inv.data) return <Alert>Invoice not found.</Alert>
  const v = inv.data
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        {isOwner
          ? <Link to="/clinic/billing" className="eyebrow hover:underline">← Billing</Link>
          : <Link to={`/clinic/patients/${v.clinic_patient_id}`} className="eyebrow hover:underline">← Patient file</Link>}
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && v.status === 'due' && (
            <>
              <Select value={method} onChange={(e) => setMethod(e.target.value)} className="!h-11 !w-36" aria-label="Payment method">
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
              <Button onClick={() => act.mutate('pay')} loading={act.isPending && act.variables === 'pay'}>Mark paid</Button>
            </>
          )}
          {isOwner && v.status !== 'void' && !v.from_app && (
            <Button variant="ghost" onClick={() => window.confirm(`Void ${v.number}? This can't be undone.`) && act.mutate('void')}>Void</Button>
          )}
          <Button variant="secondary" onClick={() => window.print()}>Print / PDF</Button>
        </div>
      </div>
      {act.error && <div className="mb-4 print:hidden"><Alert>{(act.error as Error).message}</Alert></div>}
      <InvoiceDocument inv={v} />
    </div>
  )
}
