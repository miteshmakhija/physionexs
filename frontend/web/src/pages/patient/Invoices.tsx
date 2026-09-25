import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { InvoiceDocument } from '@/components/clinical'
import { PageHeader } from '@/components/ConsoleLayout'
import { Alert, Button, Card, Loader } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { rupees, shortDate } from '@shared/format'

export function MyInvoices() {
  const q = useQuery({ queryKey: ['my-invoices'], queryFn: () => api<Schemas['InvoiceListItem'][]>('/me/invoices') })
  return (
    <div className="max-w-3xl">
      <PageHeader title="Payment history" subtitle="Invoices from your clinics and app bookings." />
      {q.isLoading ? <Loader /> : !q.data?.length ? <Card className="p-6 text-[14px] text-muted">No payments yet.</Card> : (
        <ul className="divide-y divide-line border-y border-line">
          {q.data.map((v) => (
            <li key={v.id}>
              <Link to={`/app/invoices/${v.id}`} className="flex items-center gap-4 py-4 text-[14px] hover:bg-surface-2 sm:px-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{v.service}</span>
                  <span className="block text-[12.5px] text-muted">{v.number} · {shortDate(v.issued_on)}{v.paid_via ? ` · ${v.paid_via.toUpperCase()}` : ''}</span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">{rupees(v.total_paise)}</span>
                  <span className="eyebrow">{v.status === 'paid' ? 'Paid' : 'Due'}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MyInvoice() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['my-invoice', id], queryFn: () => api<Schemas['InvoiceOut']>(`/me/invoices/${id}`) })
  if (q.isLoading) return <Loader />
  if (!q.data) return <Alert>Invoice not found.</Alert>
  return (
    <div>
      <div className="mb-5 flex items-center justify-between print:hidden">
        <Link to="/app/invoices" className="eyebrow hover:underline">← Payment history</Link>
        <Button variant="secondary" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
      <InvoiceDocument inv={q.data} />
    </div>
  )
}
