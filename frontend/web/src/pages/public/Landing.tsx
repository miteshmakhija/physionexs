import { Link } from 'react-router'

import { SupportFooter } from '@/components/Support'
import { Logo } from '@/components/ui'
import { AISection } from '@/pages/public/landing/AISection'
import { ForPatients, ForPhysios } from '@/pages/public/landing/Audiences'
import { DigitalTwin } from '@/pages/public/landing/DigitalTwin'
import { FAQSection, PilotForm } from '@/pages/public/landing/PilotAndFAQ'

const NAV = [
  { href: '#ai', label: 'AI' },
  { href: '#physios', label: 'For physios' },
  { href: '#patients', label: 'For patients' },
  { href: '#pilot', label: 'Pilot' },
]

export default function Landing() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-6 border-b border-line px-4 py-5 sm:px-6">
        <Logo className="h-9" />
        <nav className="flex items-center gap-6" aria-label="Home page sections">
          {NAV.map((n) => <a key={n.href} href={n.href} className="eyebrow hidden hover:!text-ink md:inline">{n.label}</a>)}
          <Link to="/signin" className="eyebrow !text-ink hover:underline">Sign in</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-20 px-4 pb-16 pt-8 sm:px-6 sm:pt-16">
        <div>
          <a href="#ai" className="mb-6 inline-flex items-center gap-2 rounded-full border border-line-strong py-1 pl-1 pr-3 text-[12.5px] hover:border-ink">
            <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-white">New</span>
            AI-assisted recovery tracking, now piloting <span aria-hidden>→</span>
          </a>
          <h1 className="max-w-3xl text-[40px] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[60px]">
            <span className="text-[#0F2A33]">Recover with a plan.</span>
            <br />
            <span className="text-brand">Track.</span> <span className="text-leaf">Heal.</span> <span className="text-sun">Thrive.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-muted sm:text-[17px]">
            Find a physiotherapist near you, book online or in-clinic and follow your plan at home. Between visits, AI helps your physio see how
            you’re really doing — and your physio decides what changes.
          </p>

          <div className="mt-12 grid border-t border-line sm:grid-cols-2">
            <RoleCard
              to="/signin?as=patient"
              accent="bg-brand"
              title="I'm a Patient"
              body="Discover physios near you, book appointments, follow your plan, check in daily and see your progress."
              cta="Open the patient app"
            />
            <RoleCard
              to="/signin?as=physio"
              accent="bg-leaf"
              title="I'm a Physiotherapist"
              body="Run your clinic — token queue, scheduling, records, prescriptions, billing and analytics — with AI assist."
              cta="Open the practice console"
            />
          </div>
        </div>

        <AISection />
        <DigitalTwin />
        <ForPhysios />
        <ForPatients />
        <PilotForm />
        <FAQSection />

        <div className="eyebrow flex flex-wrap items-center gap-x-6 gap-y-2">
          <span>Web app available today</span>
          <span aria-hidden>·</span>
          <span>iOS & Android apps coming soon</span>
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
