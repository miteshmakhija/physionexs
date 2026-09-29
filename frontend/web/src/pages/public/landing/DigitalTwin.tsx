import { approach } from '@shared/approach'

export function DigitalTwin() {
  return (
    <section id="approach" aria-labelledby="approach-heading" className="scroll-mt-8 border-t border-line pt-12">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <p className="eyebrow">{approach.eyebrow}</p>
        <span className="eyebrow rounded-sm border border-line-strong px-2 py-0.5 !text-ink">{approach.status}</span>
      </div>
      <h2 id="approach-heading" className="max-w-2xl text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[42px]">
        {approach.headline}
      </h2>
      <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">{approach.intro}</p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_300px]">
        <ol className="grid border-t border-line sm:grid-cols-2">
          {approach.steps.map((s) => (
            <li key={s.n} className="border-b border-line py-6 sm:px-6 sm:odd:border-r sm:odd:pl-0">
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow">{s.n}</span>
                <span className="eyebrow rounded-sm bg-surface-2 px-1.5 py-0.5">{s.trait}</span>
              </div>
              <h3 className="mt-2 text-[18px] font-bold tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <BodyMap />
      </div>
      <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-muted">{approach.criteriaNote}</p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {approach.principles.map((p) => (
          <div key={p.title}>
            <span className="mb-3 block h-0.5 w-6 bg-ink" />
            <h3 className="text-[15px] font-bold">{p.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{p.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
        <a href="#pilot" className="inline-flex h-11 items-center rounded-md bg-ink px-5 text-[12.5px] font-semibold uppercase tracking-[0.09em] text-white hover:bg-ink-2">
          Become a pilot clinic
        </a>
        <span className="text-[13px] text-muted">For clinics treating knee-replacement patients.</span>
      </div>

      <a
        href={approach.citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-10 inline-block text-[12px] leading-relaxed text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
      >
        {approach.citation.label}
      </a>
    </section>
  )
}

/** Illustrative joint map: a patient three weeks after a right knee replacement. */
function BodyMap() {
  const trend = [64, 70, 75, 78, 79, 78, 80]
  const points = trend.map((v, i) => `${(i / (trend.length - 1)) * 140},${40 - ((v - 60) / 30) * 40}`).join(' ')
  const joint = 'fill-surface stroke-line-strong'
  return (
    <figure className="rounded-lg border border-line p-6">
      <p className="eyebrow">Illustrative</p>
      <div className="mt-4 flex items-center gap-6">
        {/* Front view: the patient's right side is on the viewer's left. */}
        <svg viewBox="0 0 160 250" className="h-52 w-auto shrink-0" aria-hidden>
          <g className="stroke-line-strong" strokeWidth="3" strokeLinecap="round" fill="none">
            <circle cx="80" cy="24" r="14" />
            <path d="M80 40V118M56 54H104M56 54L48 96L46 134M104 54L112 96L114 134M66 118H94M66 118L62 178L60 238M94 118L98 178L100 238" />
          </g>
          {[
            [56, 54], [104, 54], [48, 96], [112, 96], [66, 118], [94, 118], [98, 178], [60, 238], [100, 238],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="4" strokeWidth="2" className={joint} />
          ))}
          <circle cx="62" cy="178" r="11" className="fill-amber/15" />
          <circle cx="62" cy="178" r="5.5" className="fill-amber" />
        </svg>
        <div>
          <p className="eyebrow">Right knee flexion</p>
          <p className="mt-1 text-[32px] font-extrabold leading-none tracking-[-0.03em]">
            78°<span className="text-[14px] font-semibold tracking-normal text-muted"> / 120°</span>
          </p>
          <div className="mt-3 h-1 w-24 bg-line">
            <div className="h-1 bg-amber" style={{ width: `${(78 / 120) * 100}%` }} />
          </div>
        </div>
      </div>
      <figcaption className="mt-6 border-t border-line pt-4">
        <svg viewBox="-2 -2 144 44" preserveAspectRatio="none" className="h-12 w-full" aria-hidden>
          {/* Dashed: the typical recovery curve (≈90° by week three). Solid: this patient. */}
          <line x1="0" y1={40 - (4 / 30) * 40} x2="140" y2="0" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" className="stroke-line-strong" />
          <polyline points={points} fill="none" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="stroke-ink" />
        </svg>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Flat for five days, behind the typical curve — flagged for the physio to review.
        </p>
      </figcaption>
    </figure>
  )
}
