import { Link } from 'react-router'

import { SupportFooter } from '@/components/Support'
import { Logo } from '@/components/ui'
import { approach } from '@shared/approach'

const nav = [
  { href: '#patients', label: 'For patients' },
  { href: '#clinics', label: 'For clinics' },
  { href: '#approach', label: 'Digital twin' },
  { href: '#faq', label: 'FAQ' },
]

export default function Landing() {
  return (
    <div className="min-h-dvh bg-canvas">
      <Header />
      <main>
        <Hero />
        <ForPatients />
        <ForClinics />
        <DigitalTwin />
        <Faq />
        <FinalCta />
      </main>
      <SupportFooter />
    </div>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
        <Link to="/" aria-label="Physionexs home">
          <Logo className="h-8 sm:h-9" />
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-7 text-[14px] font-medium text-ink-2 md:flex">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-ink hover:underline hover:underline-offset-4">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <Link to="/signin" className="text-[14px] font-semibold hover:underline hover:underline-offset-4">
            Sign in
          </Link>
          <Link
            to="/signin?as=patient"
            className="hidden rounded-md bg-ink px-4 py-2 text-[14px] font-semibold text-white transition hover:bg-ink-2 sm:inline-block"
          >
            Book a physio
          </Link>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pb-24">
      <div>
        <p className="eyebrow mb-5">Physiotherapy, planned</p>
        <h1 className="text-[40px] font-extrabold leading-[1.06] tracking-[-0.03em] sm:text-[60px]">
          <span className="text-[#0F2A33]">Recover with a plan.</span>
          <br />
          <span className="text-brand">Track.</span> <span className="text-leaf">Heal.</span>{' '}
          <span className="text-sun">Thrive.</span>
        </h1>
        <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-muted sm:text-[18px]">
          Find a physiotherapist near you, book in-clinic or online, and follow your prescribed exercises and medicines
          — while your physio runs the whole practice from one dashboard.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/signin?as=patient"
            className="group inline-flex items-center justify-center gap-2 rounded-md bg-ink px-6 py-3.5 text-[15px] font-semibold text-white transition hover:bg-ink-2"
          >
            Find a physiotherapist <Arrow />
          </Link>
          <Link
            to="/signin?as=physio"
            className="group inline-flex items-center justify-center gap-2 rounded-md border border-ink px-6 py-3.5 text-[15px] font-semibold transition hover:bg-surface-2"
          >
            I'm a physiotherapist <Arrow />
          </Link>
        </div>

        <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-ink-2">
          {['In-clinic or online video', 'Secure online payments', 'iOS, Android & web'].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <Check /> {t}
            </li>
          ))}
        </ul>
      </div>

      <HeroVisual />
    </section>
  )
}

/** A static, illustrative glimpse of the patient app's "today" view. */
function HeroVisual() {
  const exercises = [
    { name: 'Heel slides', dose: '3 × 12', done: true },
    { name: 'Quad sets', dose: '3 × 10 · hold 5 s', done: true },
    { name: 'Straight-leg raise', dose: '3 × 10', done: false },
  ]
  return (
    <figure aria-label="Illustrative preview of the patient app" className="relative mx-auto w-full max-w-md">
      <div aria-hidden className="absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-brand-tint via-surface to-leaf-tint" />
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_60px_-28px_rgba(15,42,51,0.35)] sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="eyebrow">Today</p>
            <p className="mt-1 text-[18px] font-bold tracking-[-0.02em]">Your recovery plan</p>
          </div>
          <span className="eyebrow rounded-sm bg-leaf-tint px-2 py-1 !text-leaf-dark">Week 3</span>
        </div>

        <div className="mt-5 flex items-center gap-4 rounded-lg border border-line p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-brand-tint text-[13px] font-bold text-brand">
            4:30
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">Follow-up · In-clinic</p>
            <p className="truncate text-[13px] text-muted">Knee rehab review · Paid</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <p className="text-[14px] font-semibold">Exercises</p>
            <p className="text-[12px] text-muted">2 of 3 done</p>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-line">
            <div className="h-1.5 w-2/3 rounded-full bg-leaf" />
          </div>
          <ul className="mt-3 divide-y divide-line">
            {exercises.map((e) => (
              <li key={e.name} className="flex items-center gap-3 py-2.5">
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                    e.done ? 'border-leaf bg-leaf text-white' : 'border-line-strong'
                  }`}
                >
                  {e.done && <Check className="h-3 w-3" />}
                </span>
                <span className={`flex-1 text-[14px] ${e.done ? 'text-muted line-through' : 'font-medium'}`}>{e.name}</span>
                <span className="text-[12px] text-muted">{e.dose}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="eyebrow">Knee flexion</p>
            <p className="mt-1 text-[22px] font-extrabold leading-none tracking-[-0.03em]">
              78°<span className="text-[12px] font-semibold tracking-normal text-muted"> / 120°</span>
            </p>
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="eyebrow">Pain today</p>
            <p className="mt-1 text-[22px] font-extrabold leading-none tracking-[-0.03em]">
              3<span className="text-[12px] font-semibold tracking-normal text-muted"> / 10</span>
            </p>
          </div>
        </div>
      </div>
      <figcaption className="eyebrow mt-4 text-center">Illustrative</figcaption>
    </figure>
  )
}

function SectionHeading(props: { id: string; eyebrow: string; title: string; intro: string; invert?: boolean }) {
  return (
    <div className="max-w-2xl">
      <p className={`eyebrow mb-4 ${props.invert ? '!text-white/60' : ''}`}>{props.eyebrow}</p>
      <h2 id={props.id} className="text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[42px]">
        {props.title}
      </h2>
      <p className={`mt-4 text-[16px] leading-relaxed ${props.invert ? 'text-white/70' : 'text-muted'}`}>{props.intro}</p>
    </div>
  )
}

function ForPatients() {
  const steps = [
    { title: 'Find', body: 'Browse verified physiotherapists near you by fee, availability and whether they see you in-clinic or online.' },
    { title: 'Book', body: 'Pick a slot and pay securely in the app. You’ll get a reminder before every visit.' },
    { title: 'Follow', body: 'Your care plan, exercises and prescriptions live in one place — with step-by-step guidance for each exercise.' },
    { title: 'Track', body: 'A 30-second daily check-in logs pain and stiffness, so you and your physio can see progress week by week.' },
  ]
  return (
    <section id="patients" aria-labelledby="patients-heading" className="scroll-mt-20 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <SectionHeading
          id="patients-heading"
          eyebrow="For patients"
          title="Everything your recovery needs, in one app."
          intro="From the first booking to your last exercise session, Physionexs keeps your plan clear and your physio in the loop."
        />
        <ol className="mt-12 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="bg-surface p-6">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-tint text-[13px] font-bold text-brand">
                {i + 1}
              </span>
              <h3 className="mt-5 text-[18px] font-bold tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
          <Link to="/signin?as=patient" className="group inline-flex items-center gap-2 text-[15px] font-semibold hover:underline hover:underline-offset-4">
            Open the patient app <Arrow />
          </Link>
          <p className="text-[13.5px] text-muted">Earn Health Points and use them on future bookings.</p>
        </div>
      </div>
    </section>
  )
}

function ForClinics() {
  const features = [
    { title: 'Token queue', body: 'Register walk-ins at reception and call patients in turn from a live token queue.' },
    { title: 'Scheduling', body: 'Set weekly hours, manage leave and accept online bookings without double-booking.' },
    { title: 'Patient records', body: 'Consultation notes, care plans and progress for every patient, in one file.' },
    { title: 'Prescriptions', body: 'Prescribe exercises from a reviewed library and medicines, then print or share them.' },
    { title: 'Billing', body: 'Raise invoices in seconds and see what’s been paid — patients get theirs in the app.' },
    { title: 'Analytics', body: 'Appointments, revenue and patient trends at a glance, for the whole clinic.' },
    { title: 'Recovery flags', body: 'Plateaus and missed sessions surface early, so you can step in before a patient drops off.' },
    { title: 'Team access', body: 'Add physiotherapists and staff with their own sign-in. Every clinic’s data stays its own.' },
  ]
  return (
    <section id="clinics" aria-labelledby="clinics-heading" className="scroll-mt-20 bg-[#0F2A33] text-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <SectionHeading
            id="clinics-heading"
            eyebrow="For physiotherapists & clinics"
            title="Run your whole practice from one console."
            intro="Physionexs replaces the appointment diary, paper files and billing book — and brings new patients to your door."
            invert
          />
          <Link
            to="/signin?as=physio"
            className="group inline-flex items-center gap-2 rounded-md bg-white px-6 py-3.5 text-[15px] font-semibold text-ink transition hover:bg-white/90"
          >
            Open the practice console <Arrow />
          </Link>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="bg-[#0F2A33] p-6">
              <span className="mb-4 block h-0.5 w-6 bg-leaf" />
              <h3 className="text-[16px] font-bold">{f.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-white/65">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 border-t border-white/10 pt-8 text-[14px] sm:grid-cols-3">
          <div>
            <p className="font-semibold">Simple plans</p>
            <p className="mt-1 text-white/65">Monthly or yearly with no fee on app bookings — or pay per booking, with no subscription.</p>
          </div>
          <div>
            <p className="font-semibold">Secure by design</p>
            <p className="mt-1 text-white/65">Password plus authenticator-app sign-in for clinic owners, and an audit trail of sensitive actions.</p>
          </div>
          <div>
            <p className="font-semibold">Verified listings</p>
            <p className="mt-1 text-white/65">Every physiotherapist is checked by our team before patients can book them.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function DigitalTwin() {
  return (
    <section id="approach" aria-labelledby="approach-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
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
      </div>
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

const faqs = [
  {
    q: 'How do I book a physiotherapist?',
    a: 'Sign in with your mobile number, choose a physio near you, pick an in-clinic or online slot and pay in the app. Your booking is confirmed as soon as the payment goes through.',
  },
  {
    q: 'What does it cost patients?',
    a: 'You pay the consultation fee shown on the physio’s profile before you book — nothing hidden. Health Points you earn can be used to reduce the fee on later bookings.',
  },
  {
    q: 'Can I see a physio online?',
    a: 'Yes. Many physiotherapists offer online video consultations as well as in-clinic visits. Filter by “Online” when you search.',
  },
  {
    q: 'Is my health data private?',
    a: 'Your records are visible only to you and the clinic treating you — clinics can never see each other’s data. When camera features are used, video stays on your phone; only joint angles are sent.',
  },
  {
    q: 'I’m a physiotherapist. How do I get started?',
    a: 'Choose “I’m a physiotherapist”, register your clinic and complete verification. You can then set your hours, add your team and start accepting bookings. Choose a monthly or yearly plan, or pay only per booking.',
  },
  {
    q: 'Can my front-desk staff use it too?',
    a: 'Yes. The clinic owner adds staff and physiotherapists from Staff management; they sign in with their own phone number and see only your clinic.',
  },
]

function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-20 border-t border-line bg-surface-2">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <p className="eyebrow mb-4">FAQ</p>
          <h2 id="faq-heading" className="text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[42px]">
            Questions, answered.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-muted">
            Can’t find what you need? Our care team is happy to help — contact details are below.
          </p>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {faqs.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden className="text-[20px] font-normal leading-none text-muted transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 sm:pt-24">
      <div className="grid overflow-hidden rounded-xl border border-line sm:grid-cols-2">
        <CtaCard
          to="/signin?as=patient"
          accent="bg-brand"
          title="Start your recovery"
          body="Find a physiotherapist near you and book your first session in minutes."
          cta="Book a physio"
        />
        <CtaCard
          to="/signin?as=physio"
          accent="bg-leaf"
          title="Grow your practice"
          body="Queue, schedule, records, prescriptions, billing and analytics — in one place."
          cta="Register your clinic"
        />
      </div>
      <p className="eyebrow mt-8 text-center">Available on iOS, Android and the web</p>
    </section>
  )
}

function CtaCard(props: { to: string; accent: string; title: string; body: string; cta: string }) {
  return (
    <Link
      to={props.to}
      className="group border-b border-line p-8 transition last:border-b-0 hover:bg-surface-2 sm:border-b-0 sm:p-10 sm:first:border-r"
    >
      <span className={`mb-5 block h-0.5 w-8 ${props.accent}`} />
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{props.title}</h2>
      <p className="mt-2 max-w-sm text-[14.5px] leading-relaxed text-muted">{props.body}</p>
      <span className="mt-6 inline-flex items-center gap-2 text-[15px] font-semibold">
        {props.cta} <Arrow />
      </span>
    </Link>
  )
}

function Arrow() {
  return (
    <span aria-hidden className="transition group-hover:translate-x-0.5">
      →
    </span>
  )
}

function Check({ className = 'h-4 w-4 text-leaf' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  )
}
