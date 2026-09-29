import { approach } from '@shared/approach'

// Home page: the problem we solve and the one loop that solves it. AI is woven into the steps where it helps;
// claims stay within what's built (camera AI in validation, rule-based checks, generative drafts for physios).

const GAPS = [
  {
    title: 'Most recovery happens at home',
    body: 'Between appointments, patients follow a printed sheet — unsure whether they’re doing it right, or whether a new pain matters.',
  },
  {
    title: 'Physios only see snapshots',
    body: 'Progress is checked at visits, so a knee that has stopped improving or a warning sign can go unnoticed for days.',
  },
  {
    title: 'Clinics juggle paper and apps',
    body: 'Queues, notes, prescriptions and billing live in different places, taking time away from patients.',
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Plan',
    body: 'Your physio assesses you, sets clear targets — like knee bend by week 8 — and prescribes exercises and medicines straight into your app.',
    help: 'Physio-led',
  },
  {
    n: '02',
    title: 'Check in & measure',
    body: 'You follow your plan and answer a 30-second daily check-in. Your physio records measurements at visits; camera measurement is being validated.',
    help: 'On-device AI camera · in validation',
  },
  {
    n: '03',
    title: 'Spot & explain',
    body: 'Automatic checks watch for rising pain, a knee that has stopped improving, missed exercises and warning signs. AI explains each flag and drafts summaries and notes for your physio.',
    help: 'Automatic checks + generative AI',
  },
  {
    n: '04',
    title: 'Decide & update',
    body: 'Your physio reviews every flag and suggestion. Approved changes reach your app the same day, and warning signs get immediate advice.',
    help: 'Your physio decides',
  },
]

const GUARDRAILS = [
  { title: 'AI suggests, your physio decides', body: 'Automatic suggestions can only hold or reduce exercises, and nothing changes without approval.' },
  { title: 'AI never sees who you are', body: 'It receives recovery numbers only — never names, phone numbers or notes.' },
  { title: 'Video stays on the phone', body: 'Movement is analysed on the device; only angles are saved.' },
  { title: 'Consent first', body: 'Check-ins are shared only after you agree. Designed around India’s DPDP Act, 2023.' },
]

export function Gap() {
  return (
    <section aria-labelledby="gap-heading" className="border-t border-line pt-12">
      <p className="eyebrow">The problem</p>
      <h2 id="gap-heading" className="mt-3 max-w-3xl text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
        Recovery doesn’t stop between visits. Care shouldn’t either.
      </h2>
      <div className="mt-8 grid border-t border-line sm:grid-cols-3">
        {GAPS.map((g) => (
          <div key={g.title} className="border-b border-line py-6 sm:border-b-0 sm:px-6 sm:[&:not(:last-child)]:border-r sm:first:pl-0">
            <h3 className="text-[17px] font-bold tracking-[-0.01em]">{g.title}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{g.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-heading" className="scroll-mt-8 border-t border-line pt-12">
      <div className="flex flex-wrap items-center gap-3">
        <p className="eyebrow">How it works</p>
        <span className="eyebrow rounded-sm border border-line-strong px-2 py-0.5 !text-ink">{approach.status}</span>
      </div>
      <h2 id="how-heading" className="mt-3 max-w-3xl text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
        One loop between you and your physio — with AI that notices early.
      </h2>
      <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">
        Everything connects: the plan your physio sets, what you do and feel each day, what gets measured, and what changes next. AI helps where
        it genuinely saves time or catches something early; people make the decisions.
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_370px]">
        <ol className="grid border-t border-line sm:grid-cols-2">
          {STEPS.map((s) => (
            <li key={s.n} className="border-b border-line py-6 sm:px-6 sm:odd:border-r sm:odd:pl-0">
              <span className="eyebrow">{s.n}</span>
              <h3 className="mt-2 text-[19px] font-bold tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{s.body}</p>
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-sm bg-surface-2 px-2 py-1 text-[12px] font-semibold text-ink-2">
                <span aria-hidden className="size-1.5 rounded-full bg-violet" /> {s.help}
              </p>
            </li>
          ))}
        </ol>
        <FlagPreview />
      </div>

      <div className="mt-10 grid gap-6 rounded-lg bg-surface-2 p-6 sm:grid-cols-2 lg:grid-cols-4">
        {GUARDRAILS.map((g) => (
          <div key={g.title}>
            <span className="mb-3 block h-0.5 w-6 bg-leaf" />
            <h3 className="text-[15px] font-bold">{g.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{g.body}</p>
          </div>
        ))}
      </div>

      <p className="mt-6 max-w-3xl text-[13px] leading-relaxed text-muted">
        Together this forms a digital twin of each recovery: specific to the patient, updated between visits, predictive, and two-way.{' '}
        <a href={approach.citation.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
          Grounded in Olawade et al., Virtual Reality &amp; Intelligent Hardware (2026).
        </a>
      </p>
    </section>
  )
}

/** Sample of the physio's flags with an AI explanation and a suggested change. Sample data; AI is never given names. */
function FlagPreview() {
  return (
    <figure className="self-start rounded-lg border border-line bg-white p-5 shadow-[0_18px_50px_-28px_rgba(20,20,20,0.35)]">
      <p className="eyebrow">Physio’s view · sample</p>
      <div className="mt-4 flex items-start gap-3">
        <span className="mt-0.5 rounded-sm bg-danger px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-white">Act</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">Red flag</p>
          <p className="text-[13.5px] text-ink-2">Fever or chills · reported today</p>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-violet/30 bg-violet/5 p-3 text-[13px] leading-relaxed">
        <p className="eyebrow !text-violet">AI draft · check before relying on it</p>
        <p className="mt-1 text-ink-2">
          The patient reported fever or chills 23 days after a right knee replacement. Pain rose from 4/10 to 6/10 over three days and sleep was
          poor, though knee bend kept improving (80° → 83°). No wound or temperature readings are recorded.
        </p>
      </div>
      <div className="mt-3 rounded-md border border-line-strong bg-surface-2 p-3 text-[13px]">
        <p className="eyebrow">Suggested change · automatic</p>
        <p className="mt-1 font-semibold">Pause home exercises until reviewed</p>
        <div className="mt-2 flex gap-2">
          <span className="rounded-md bg-ink px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white">Approve</span>
          <span className="rounded-md border border-ink px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em]">Edit</span>
          <span className="px-2 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">Reject</span>
        </div>
      </div>
      <figcaption className="mt-3 text-[11.5px] text-muted">Illustrative sample data.</figcaption>
    </figure>
  )
}
