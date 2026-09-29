// Home page: who Physionexs serves — one platform, both sides of the recovery. No separate entry links:
// Sign in routes each person to the right place. "Pilot" marks recovery-twin features.

const PATIENTS = [
  { title: 'Find & book', body: 'Search physiotherapists near you, book in-clinic or online and pay securely.' },
  { title: 'Follow your plan', body: 'Today’s exercises with steps and videos, and medicines with reminders.' },
  { title: '30-second daily check-in', body: 'Tell your physio how you’re doing. Warning signs get immediate advice.', pilot: true },
  { title: 'See your progress', body: 'Your knee bend against your physio’s target, pain trends and exercise streaks.', pilot: true },
  { title: 'Hear from your physio', body: 'Plan changes, results and reminders as they happen.' },
]

const CLINICS = [
  { title: 'Queue & scheduling', body: 'Live tokens for walk-ins; online bookings in your calendar with reminders.' },
  { title: 'Records & prescriptions', body: 'SOAP notes, measurements, exercise programs, medicines and tests in one patient file.' },
  { title: 'Billing & analytics', body: 'Invoices, online payments and a clear view of how the clinic is doing.' },
  { title: 'Recovery flags', body: 'One inbox for warning signs, rising pain and plateaus, with suggested changes you approve.', pilot: true },
  { title: 'AI assist', body: 'Plain-language flag explanations, 7-day summaries and visit-note drafts.', pilot: true },
]

function List({ title, items }: { title: string; items: { title: string; body: string; pilot?: boolean }[] }) {
  return (
    <div>
      <h3 className="text-[18px] font-bold tracking-[-0.02em]">{title}</h3>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {items.map((f) => (
          <li key={f.title} className="py-4">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              {f.title}
              {f.pilot && <span className="eyebrow rounded-sm bg-brand-tint px-1.5 py-0.5 !text-brand">Pilot</span>}
            </p>
            <p className="mt-0.5 text-[14px] leading-relaxed text-muted">{f.body}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Audiences() {
  return (
    <section id="who" aria-labelledby="who-heading" className="scroll-mt-8 border-t border-line pt-12">
      <p className="eyebrow">Who it serves</p>
      <h2 id="who-heading" className="mt-3 max-w-3xl text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
        One platform for everyone in the recovery.
      </h2>
      <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">
        Patients and their physiotherapists work from the same plan and the same data — and the clinic runs from the same place.
      </p>
      <div className="mt-8 grid gap-10 md:grid-cols-2">
        <List title="For patients" items={PATIENTS} />
        <List title="For physiotherapists & clinics" items={CLINICS} />
      </div>
    </section>
  )
}

/** Hero visual: the same recovery seen from both sides — the patient's app and the physio's console. Sample data. */
export function BothSides() {
  return (
    <figure className="relative mx-auto w-full max-w-[500px] sm:pb-24 lg:mx-0">
      <div className="w-[260px] rounded-[30px] border-[6px] border-ink bg-white p-4 shadow-[0_24px_60px_-30px_rgba(20,20,20,0.45)]">
        <p className="eyebrow">Patient app</p>
        <p className="mt-1 text-[20px] font-bold">Good morning, Sunita</p>
        <div className="mt-3 rounded-md border border-line p-3">
          <p className="eyebrow">Today’s check-in ✓</p>
          <p className="mt-1 text-[12.5px]">Pain <b>3/10</b> · Stiffness <b>3/10</b> · Slept well</p>
        </div>
        <div className="mt-3 rounded-md border border-line p-3">
          <p className="eyebrow">Right · Knee bend</p>
          <p className="mt-1 text-[24px] font-extrabold leading-none">91°<span className="text-[11px] font-semibold text-muted"> / target 120°</span></p>
          <div className="mt-2 h-1.5 rounded-full bg-line"><div className="h-1.5 rounded-full bg-brand" style={{ width: '52%' }} /></div>
        </div>
        <div className="mt-3 rounded-md bg-surface-2 p-3">
          <p className="flex items-center gap-2 text-[12.5px] font-semibold"><span className="size-1.5 rounded-full bg-brand" />Your physio updated your plan</p>
          <p className="mt-0.5 text-[11.5px] text-muted">Heel slides: 3 → 2 sets</p>
        </div>
      </div>
      <div className="relative mt-4 ml-auto w-[250px] rounded-lg border border-line bg-white p-4 shadow-[0_24px_60px_-28px_rgba(20,20,20,0.45)] sm:absolute sm:bottom-0 sm:right-0 sm:mt-0 sm:w-[236px]">
        <p className="eyebrow">Physio console</p>
        <div className="mt-2 flex items-start gap-2">
          <span className="mt-0.5 rounded-sm bg-amber-tint px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-amber">Watch</span>
          <p className="text-[13px] font-semibold leading-snug">Pain rising <span className="font-normal text-muted">· 3-day avg 6/10</span></p>
        </div>
        <div className="mt-2 rounded-md border border-violet/30 bg-violet/5 p-2.5 text-[12px] leading-snug text-ink-2">
          <p className="eyebrow !text-violet">AI draft</p>
          Pain rose after heel slides were logged as hard on 3 days; knee bend still improving.
        </div>
        <p className="mt-2 text-[12px]"><b>Suggested:</b> heel slides 3 → 2 sets · <span className="font-semibold underline">Approve</span></p>
      </div>
      <figcaption className="sr-only">Illustrative sample: the patient’s app and the physiotherapist’s console showing the same recovery.</figcaption>
    </figure>
  )
}
