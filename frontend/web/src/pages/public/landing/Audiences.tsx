import { Link } from 'react-router'

// Home page: what the practice console and the patient app do. "Pilot" marks recovery-twin features.

const PHYSIO = [
  { title: 'Token queue & scheduling', body: 'Walk-ins get a live token; online bookings land in your calendar with reminders.' },
  { title: 'Records & SOAP notes', body: 'Structured notes, measurements and history in one patient file.' },
  { title: 'Prescriptions', body: 'Exercise programs from a reviewed library, plus medicines and tests — printed or in the patient’s app.' },
  { title: 'Billing & analytics', body: 'Invoices, online payments and a clear view of how the clinic is doing.' },
  { title: 'Recovery flags', body: 'One inbox for warning signs, rising pain and plateaus, with suggested plan changes you approve.', pilot: true },
  { title: 'AI assist', body: 'Plain-language flag explanations, 7-day patient summaries and visit-note drafts.', pilot: true },
]

const PATIENT = [
  { title: 'Find & book', body: 'Search physiotherapists near you, book in-clinic or online and pay securely.' },
  { title: 'Follow your plan', body: 'Today’s exercises with steps and videos, and medicines with reminders.' },
  { title: '30-second check-in', body: 'Tell your physio how you’re doing each day. Warning signs get immediate advice.', pilot: true },
  { title: 'See your progress', body: 'Your knee bend against your physio’s target, pain trends and exercise streaks.', pilot: true },
  { title: 'Hear from your physio', body: 'Plan changes, results and appointment reminders, as they happen.' },
]

function Features({ items }: { items: { title: string; body: string; pilot?: boolean }[] }) {
  return (
    <ul className="grid border-t border-line sm:grid-cols-2">
      {items.map((f) => (
        <li key={f.title} className="border-b border-line py-5 sm:px-5 sm:odd:border-r sm:odd:pl-0">
          <h3 className="flex items-center gap-2 text-[16px] font-bold tracking-[-0.01em]">
            {f.title}
            {f.pilot && <span className="eyebrow rounded-sm bg-brand-tint px-1.5 py-0.5 !text-brand">Pilot</span>}
          </h3>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{f.body}</p>
        </li>
      ))}
    </ul>
  )
}

export function ForPhysios() {
  return (
    <section id="physios" aria-labelledby="physios-heading" className="scroll-mt-8 border-t border-line pt-12">
      <p className="eyebrow">For physiotherapists</p>
      <h2 id="physios-heading" className="mt-3 max-w-2xl text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
        Run your practice. See recovery between visits.
      </h2>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_360px]">
        <Features items={PHYSIO} />
        <ConsolePreview />
      </div>
      <Link to="/signin?as=physio" className="eyebrow mt-8 inline-flex items-center gap-1 !text-ink hover:underline">Open the practice console →</Link>
    </section>
  )
}

export function ForPatients() {
  return (
    <section id="patients" aria-labelledby="patients-heading" className="scroll-mt-8 border-t border-line pt-12">
      <p className="eyebrow">For patients</p>
      <h2 id="patients-heading" className="mt-3 max-w-2xl text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
        Your recovery, in your pocket.
      </h2>
      <div className="mt-8 grid gap-10 lg:grid-cols-[300px_1fr]">
        <PhonePreview />
        <div>
          <Features items={PATIENT} />
          <Link to="/signin?as=patient" className="eyebrow mt-8 inline-flex items-center gap-1 !text-ink hover:underline">Open the patient app →</Link>
        </div>
      </div>
    </section>
  )
}

/** Sample of the practice console's recovery view. Illustrative data. */
function ConsolePreview() {
  return (
    <figure className="self-start rounded-lg border border-line p-5">
      <p className="eyebrow">Sample screen · recovery twin</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[['Right knee bend', '91°', '/ 120°', 52, 'bg-brand'], ['Straightening', '5°', '/ 0°', 58, 'bg-brand']].map(([label, v, t, pct, bar]) => (
          <div key={label as string} className="border border-line p-3">
            <p className="eyebrow">{label}</p>
            <p className="mt-1 text-[22px] font-extrabold leading-none tabular-nums">{v}<span className="text-[11.5px] font-semibold text-muted"> {t}</span></p>
            <div className="mt-2 h-1 bg-line"><div className={`h-1 ${bar}`} style={{ width: `${pct}%` }} /></div>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 300 90" className="mt-4 w-full" aria-hidden>
        <line x1="0" x2="300" y1="14" y2="14" className="stroke-muted" strokeWidth="1.5" strokeDasharray="4 4" />
        <text x="298" y="10" textAnchor="end" className="fill-muted text-[9px]">Target 120°</text>
        <polyline points="4,80 70,64 140,52 210,44 296,36" fill="none" className="stroke-brand" strokeWidth="2.5" strokeLinejoin="round" />
        {[[4, 80], [70, 64], [140, 52], [210, 44], [296, 36]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.5" className="fill-brand stroke-white" strokeWidth="1.5" />)}
      </svg>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[12.5px]">
        <span className="text-muted">Check-ins · 7 days</span>
        <span className="font-semibold">6 of 7</span>
      </div>
      <figcaption className="mt-2 text-[11.5px] text-muted">Illustrative sample data.</figcaption>
    </figure>
  )
}

/** Sample of the patient app home: today's check-in and knee progress. Illustrative data. */
function PhonePreview() {
  return (
    <figure className="mx-auto w-[280px] self-start rounded-[32px] border-[6px] border-ink bg-white p-4 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.45)]">
      <p className="eyebrow">Good morning</p>
      <p className="text-[22px] font-bold">Sunita</p>
      <div className="mt-3 rounded-md border border-line p-3">
        <p className="eyebrow">Today’s check-in ✓</p>
        <p className="mt-1 text-[12.5px]">Pain <b>3/10</b> · Stiffness <b>3/10</b> · Slept well</p>
      </div>
      <div className="mt-3 rounded-md border border-line p-3">
        <p className="eyebrow">Right · Knee bend</p>
        <p className="mt-1 text-[24px] font-extrabold leading-none">91°<span className="text-[11px] font-semibold text-muted"> / target 120°</span></p>
        <div className="mt-2 h-1.5 rounded-full bg-line"><div className="h-1.5 rounded-full bg-brand" style={{ width: '52%' }} /></div>
        <p className="mt-2 text-[11.5px] text-muted">52% of the way from 60° to your target</p>
      </div>
      <div className="mt-3 rounded-md bg-surface-2 p-3">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold"><span className="size-1.5 rounded-full bg-brand" />Your physio updated your plan</p>
        <p className="mt-0.5 text-[11.5px] text-muted">Heel slides: 3 → 2 sets. Ice after exercises.</p>
      </div>
      <figcaption className="mt-3 text-center text-[11px] text-muted">Illustrative sample data.</figcaption>
    </figure>
  )
}
