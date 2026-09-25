import { cx, Logo } from '@/components/ui'
import type { Schemas } from '@/lib/api'
import { dayLabel } from '@shared/format'

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

/** A prescription on the clinic's letterhead. Printable: the page's print CSS hides everything else. */
export function RxDocument({ rx }: { rx: Schemas['PrescriptionOut'] }) {
  const s = rx.snapshot as unknown as RxSnapshot
  return (
    <article className="rx-document mx-auto max-w-[800px] border border-line bg-white p-8 text-[13.5px] text-ink print:border-0 print:p-0 sm:p-12">
      <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-5">
        <div>
          {s.clinic.logo_url ? <img src={s.clinic.logo_url} alt="" className="mb-2 h-12 w-auto" /> : <Logo className="mb-2 h-8" />}
          <p className="text-[18px] font-bold">{s.clinic.name}</p>
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
          <p className="mt-2">Digitally generated via Physionexs · Synced to the patient's app care plan.</p>
        </div>
        <div className="text-right">
          <p className="font-serif text-[18px] italic text-ink">{s.physio.name.replace(/^Dr\.?\s*/, '')}</p>
          <p>{s.physio.name}</p>
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
