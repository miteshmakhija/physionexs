import { Link } from 'react-router'

import { SupportFooter } from '@/components/Support'
import { Logo } from '@/components/ui'
import { approach } from '@shared/approach'

export default function Landing() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-line px-4 py-5 sm:px-6">
        <Logo className="h-9" />
        <Link to="/signin" className="eyebrow !text-ink hover:underline">
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-16">
        <p className="eyebrow mb-5">Physiotherapy, planned</p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[60px]">
          <span className="text-[#0F2A33]">Recover with a plan.</span>
          <br />
          <span className="text-brand">Track.</span> <span className="text-leaf">Heal.</span> <span className="text-sun">Thrive.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-muted sm:text-[17px]">
          Find a physiotherapist near you, book online or in-clinic, follow your prescribed exercises and medicines —
          while your physio runs the whole practice from one dashboard.
        </p>

        <div className="mt-12 grid border-t border-line sm:grid-cols-2">
          <RoleCard
            to="/signin?as=patient"
            accent="bg-brand"
            title="I'm a Patient"
            body="Discover physios near you, book appointments, follow your plan and track progress."
            cta="Open the patient app"
          />
          <RoleCard
            to="/signin?as=physio"
            accent="bg-leaf"
            title="I'm a Physiotherapist"
            body="Run your clinic — token queue, scheduling, records, prescriptions, billing and analytics."
            cta="Open the practice console"
          />
        </div>

        <DigitalTwin />

        <div className="eyebrow mt-12 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span>Available on iOS & Android</span>
          <span aria-hidden>·</span>
          <span>physionexs.com</span>
        </div>
      </main>
      <SupportFooter />
    </div>
  )
}

function RoleCard(props: { to: string; accent: string; title: string; body: string; cta: string }) {
  return (
    <Link
      to={props.to}
      className="group border-b border-line py-8 transition hover:bg-surface-2 sm:px-8 sm:first:border-r sm:first:pl-0"
    >
      <span className={`mb-5 block h-0.5 w-8 ${props.accent}`} />
      <h2 className="text-[22px] font-bold tracking-[-0.02em]">{props.title}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">{props.body}</p>
      <span className="eyebrow mt-6 inline-flex items-center gap-1 !text-ink">
        {props.cta} <span className="transition group-hover:translate-x-0.5">→</span>
      </span>
    </Link>
  )
}

function DigitalTwin() {
  return (
    <section aria-labelledby="approach-heading" className="mt-20 border-t border-line pt-12">
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
