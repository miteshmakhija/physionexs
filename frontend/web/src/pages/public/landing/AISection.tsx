// Home page: how Physionexs uses AI. Claims stay within what's built: camera AI is in clinical validation,
// flags are automatic checks, and generative AI drafts for the physio only. Recovery-twin features are piloting.

const CAPABILITIES = [
  {
    n: '01',
    title: 'Measures movement',
    body: 'On-device AI estimates knee angle from a phone or clinic camera. The video never leaves the device, and camera readings stay out of clinical use until they match a goniometer.',
    tag: 'Clinical validation under way',
  },
  {
    n: '02',
    title: 'Spots what’s changing',
    body: 'Daily check-ins and clinic readings are checked automatically for rising pain, a knee that’s stopped improving, missed exercises and warning signs — so problems surface between visits.',
    tag: 'Automatic checks',
  },
  {
    n: '03',
    title: 'Explains and drafts',
    body: 'Generative AI turns the numbers into a plain-language explanation of each flag, a weekly summary and a first draft of the visit note — for the physiotherapist to check and edit.',
    tag: 'For physiotherapists',
  },
]

const GUARDRAILS = [
  'AI suggests, your physio decides',
  'AI never sees names or contact details',
  'Nothing changes a plan without approval',
]

export function AISection() {
  return (
    <section id="ai" aria-labelledby="ai-heading" className="scroll-mt-8 rounded-lg bg-ink px-5 py-10 text-white sm:px-10 sm:py-14">
      <div className="flex flex-wrap items-center gap-3">
        <p className="eyebrow !text-white/60">AI, working alongside your physio</p>
        <span className="eyebrow rounded-sm border border-white/30 px-2 py-0.5 !text-white">Piloting with partner clinics</span>
      </div>
      <h2 id="ai-heading" className="mt-4 max-w-3xl text-[32px] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">
        AI that notices. <span className="text-white/60">Your physio decides.</span>
      </h2>
      <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-white/75">
        Physionexs uses AI where it genuinely helps — measuring movement, spotting change and saving your physiotherapist time — and keeps
        every clinical decision with a person who knows you.
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_380px]">
        <ol className="grid gap-px overflow-hidden rounded-md bg-white/15 sm:grid-cols-3 lg:grid-cols-1">
          {CAPABILITIES.map((c) => (
            <li key={c.n} className="bg-ink p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow !text-white/50">{c.n}</span>
                <span className="eyebrow rounded-sm bg-white/10 px-1.5 py-0.5 !text-white/80">{c.tag}</span>
              </div>
              <h3 className="mt-2 text-[19px] font-bold tracking-[-0.02em]">{c.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-white/70">{c.body}</p>
            </li>
          ))}
        </ol>
        <FlagPreview />
      </div>

      <ul className="mt-10 grid gap-3 border-t border-white/15 pt-6 sm:grid-cols-3">
        {GUARDRAILS.map((g) => (
          <li key={g} className="flex items-center gap-2 text-[14px] font-semibold">
            <span aria-hidden className="size-1.5 rounded-full bg-leaf" /> {g}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Sample of the physio's flags inbox with an AI explanation. Sample data; the model is never given names. */
function FlagPreview() {
  return (
    <figure className="self-start rounded-lg bg-white p-5 text-ink shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]">
      <p className="eyebrow">Sample screen · physio’s flags</p>
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
