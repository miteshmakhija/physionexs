import { cx, Logo } from '@/components/ui'
import type { Schemas } from '@/lib/api'
import { dayLabel, shortDate } from '@shared/format'

export function Adherence({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="text-subtle">—</span>
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 bg-line">
        <span className={cx('block h-full', pct >= 70 ? 'bg-leaf' : pct >= 40 ? 'bg-amber' : 'bg-danger')} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums">{pct}%</span>
    </span>
  )
}

interface RxSnapshot {
  clinic: { name: string; logo_url?: string | null; phone?: string | null; email?: string | null; gstin?: string | null; address?: string | null }
  physio: { name: string; qualification?: string | null; registration_no?: string | null; council?: string | null }
  patient: { name: string; age?: number | null; sex?: string | null; phone?: string | null }
  diagnosis: { condition: string; detail?: string | null }
  medications: { name: string; dose?: string | null; frequency: string; timing?: string | null; duration?: string | null; instructions?: string | null }[]
  exercises: { name: string; detail: string; notes?: string | null }[]
  tests: string[]
  advice?: string | null
  next_review?: string | null
}

/** The clinic's own mark on its letterhead: the uploaded logo, or its initials until one is uploaded. */
export function ClinicMark({ name, logoUrl, size = 'lg' }: { name: string; logoUrl?: string | null; size?: 'lg' | 'sm' }) {
  if (logoUrl) return <img src={logoUrl} alt={name} className={size === 'lg' ? 'mb-3 h-20 w-auto max-w-[240px] object-contain' : 'mb-2 h-12 w-auto max-w-[160px] object-contain'} />
  const initials = name.split(/[\s']+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || name.slice(0, 1).toUpperCase()
  return (
    <span className={cx('mb-3 grid place-items-center bg-ink font-bold tracking-[0.04em] text-white', size === 'lg' ? 'size-16 text-[24px]' : 'size-10 text-[15px]')} aria-hidden>
      {initials}
    </span>
  )
}

/** Small "Powered by Physionexs" credit for the foot of clinic documents. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[11px] text-subtle', className)}>
      Powered by <Logo className="h-4" />
    </span>
  )
}

/** A prescription on the clinic's letterhead. Printable: the page's print CSS hides everything else. */
export function RxDocument({ rx }: { rx: Schemas['PrescriptionOut'] }) {
  const s = rx.snapshot as unknown as RxSnapshot
  return (
    <article className="rx-document mx-auto max-w-[800px] border border-line bg-white p-8 text-[13.5px] text-ink print:border-0 print:p-0 sm:p-12">
      <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-5">
        <div>
          <ClinicMark name={s.clinic.name} logoUrl={s.clinic.logo_url} />
          <p className="text-[20px] font-bold">{s.clinic.name}</p>
          <p className="text-muted">Physiotherapy &amp; Rehabilitation</p>
        </div>
        <div className="text-right">
          <p className="text-[15px] font-semibold">{s.physio.name}</p>
          {s.physio.qualification && <p>{s.physio.qualification}</p>}
          {s.physio.registration_no && <p className="text-muted">Reg. No. {s.physio.registration_no}{s.physio.council ? ` (${s.physio.council})` : ''}</p>}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 border-b border-line py-4 sm:grid-cols-4">
        <Meta label="Patient" value={s.patient.name} />
        <Meta label="Age / Sex" value={[s.patient.age != null ? `${s.patient.age} yrs` : null, s.patient.sex].filter(Boolean).join(' · ') || '—'} />
        <Meta label="Rx No." value={rx.rx_no} />
        <Meta label="Date" value={dayLabel(rx.issued_at)} />
      </section>

      <section className="py-4">
        <p className="eyebrow">Diagnosis</p>
        <p className="mt-1 text-[15px] font-semibold">
          {s.diagnosis.condition}
          {s.diagnosis.detail && <span className="font-normal text-muted"> — {s.diagnosis.detail}</span>}
        </p>
      </section>

      {s.medications.length > 0 && (
        <section className="py-4">
          <p className="mb-2 text-[22px] font-bold leading-none">℞</p>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ink">
                {['Medicine', 'Dosage', 'Frequency', 'Duration'].map((h) => <th key={h} className="eyebrow py-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.medications.map((m, i) => (
                <tr key={i}>
                  <td className="py-2 font-semibold">{m.name}{m.instructions && <span className="block text-[12px] font-normal text-muted">{m.instructions}</span>}</td>
                  <td>{m.dose ?? '—'}</td>
                  <td>{m.frequency}{m.timing ? ` · ${m.timing}` : ''}</td>
                  <td>{m.duration ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s.exercises.length > 0 && (
        <section className="py-4">
          <p className="eyebrow mb-2">Prescribed exercises</p>
          <ol className="list-decimal space-y-1 pl-5">
            {s.exercises.map((e, i) => (
              <li key={i}><span className="font-semibold">{e.name}</span> — {e.detail}{e.notes ? ` · ${e.notes}` : ''}</li>
            ))}
          </ol>
        </section>
      )}

      {s.tests.length > 0 && (
        <section className="py-4">
          <p className="eyebrow mb-1">Investigations</p>
          <p>{s.tests.join(' · ')}</p>
        </section>
      )}

      {s.advice && (
        <section className="py-4">
          <p className="eyebrow mb-1">Advice</p>
          <p className="whitespace-pre-line">{s.advice}</p>
          {s.next_review && <p className="mt-2 text-muted">Next review: {s.next_review}</p>}
        </section>
      )}

      <footer className="mt-10 flex items-end justify-between gap-6 border-t border-line pt-5 text-[12px] text-muted">
        <div>
          {s.clinic.address && <p>{s.clinic.address}</p>}
          <p>{[s.clinic.phone, s.clinic.email, s.clinic.gstin ? `GSTIN ${s.clinic.gstin}` : null].filter(Boolean).join(' · ')}</p>
          <p className="mt-2">Synced to the patient's app care plan.</p>
        </div>
        <div className="flex flex-col items-end gap-3 text-right">
          <div>
            <p className="font-serif text-[18px] italic text-ink">{s.physio.name.replace(/^Dr\.?\s*/, '')}</p>
            <p>{s.physio.name}</p>
          </div>
          <PoweredBy />
        </div>
      </footer>
    </article>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  )
}

/** An invoice on the clinic letterhead. Printable like the prescription. */
export function InvoiceDocument({ inv }: { inv: Schemas['InvoiceOut'] }) {
  const c = inv.clinic as { name: string; logo_url?: string | null; address?: string | null; phone?: string | null; email?: string | null; gstin?: string | null }
  const p = inv.patient as { name: string; phone?: string | null }
  const money = (v: number) => '₹' + (v / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
  return (
    <article className="rx-document mx-auto max-w-[800px] border border-line bg-white p-8 text-[13.5px] text-ink print:border-0 print:p-0 sm:p-12">
      <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-5">
        <div>
          <ClinicMark name={c.name} logoUrl={c.logo_url} />
          <p className="text-[20px] font-bold">{c.name}</p>
          <p className="text-muted">Physiotherapy &amp; Rehabilitation</p>
        </div>
        <div className="text-right">
          <p className="text-[22px] font-bold tracking-[0.12em]">INVOICE</p>
          <p className="font-semibold">{inv.number}</p>
          <p className="eyebrow mt-2">{inv.status === 'paid' ? 'Paid' : inv.status === 'void' ? 'Void' : 'Payment due'}</p>
        </div>
      </header>
      <section className="grid grid-cols-2 gap-4 border-b border-line py-4 sm:grid-cols-3">
        <div><p className="eyebrow">Billed to</p><p className="mt-0.5 font-semibold">{p.name}</p>{p.phone && <p className="text-muted">{p.phone}</p>}</div>
        <div><p className="eyebrow">Issue date</p><p className="mt-0.5">{shortDate(inv.issued_on)}</p></div>
        <div><p className="eyebrow">{inv.status === 'paid' ? 'Paid' : 'Due'}</p><p className="mt-0.5">{inv.status === 'paid' ? (inv.paid_at ? dayLabel(inv.paid_at) : '—') : (inv.due_on ? shortDate(inv.due_on) : 'On receipt')}</p></div>
      </section>
      <table className="mt-4 w-full text-left">
        <thead>
          <tr className="border-b border-ink">
            <th className="eyebrow py-2 font-semibold">Description</th>
            <th className="eyebrow py-2 text-right font-semibold">Qty</th>
            <th className="eyebrow py-2 text-right font-semibold">Rate</th>
            <th className="eyebrow py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums">
          {inv.items.map((it, i) => (
            <tr key={i}>
              <td className="py-2.5"><span className="font-medium">{it.description}</span>{it.detail && <span className="block text-[12px] text-muted">{it.detail}</span>}</td>
              <td className="text-right">{it.quantity}</td>
              <td className="text-right">{money(it.rate_paise)}</td>
              <td className="text-right">{money(it.amount_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto mt-4 w-full max-w-xs space-y-1.5 tabular-nums">
        <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{money(inv.subtotal_paise)}</span></div>
        <div className="flex justify-between"><span className="text-muted">GST</span><span>{inv.tax_paise ? money(inv.tax_paise) : 'Exempt · healthcare'}</span></div>
        <div className="flex justify-between border-t border-ink pt-2 text-[16px] font-bold"><span>Total</span><span>{money(inv.total_paise)}</span></div>
        {inv.paid_via && <p className="text-right text-[12px] text-muted">Paid via {inv.paid_via.toUpperCase()}</p>}
      </div>
      {inv.notes && <p className="mt-6 whitespace-pre-line text-muted">{inv.notes}</p>}
      <footer className="mt-10 flex items-end justify-between gap-6 border-t border-line pt-5 text-[12px] text-muted">
        <div>
          {c.gstin && <p>GSTIN {c.gstin}</p>}
          {c.address && <p>{c.address}</p>}
          <p>{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
          <p className="mt-2">Thank you for choosing {c.name}. This is a computer-generated invoice.</p>
        </div>
        <div className="flex flex-col items-end gap-3 text-right">
          <p>Authorised signatory</p>
          <PoweredBy />
        </div>
      </footer>
    </article>
  )
}
