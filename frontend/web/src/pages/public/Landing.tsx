import { Link } from 'react-router'

import { SupportFooter } from '@/components/Support'
import { Logo } from '@/components/ui'
import { Audiences, BothSides } from '@/pages/public/landing/Audiences'
import { Gap, HowItWorks } from '@/pages/public/landing/HowItWorks'
import { FAQSection, PilotForm } from '@/pages/public/landing/PilotAndFAQ'

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#who', label: 'Who it serves' },
  { href: '#pilot', label: 'Pilot' },
  { href: '#faq', label: 'FAQ' },
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

      <main className="mx-auto max-w-6xl space-y-20 px-4 pb-16 pt-8 sm:px-6 sm:pt-14">
        <div className="grid items-center gap-12 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <a href="#how" className="mb-6 inline-flex items-center gap-2 rounded-full border border-line-strong py-1 pl-1 pr-3 text-[12.5px] hover:border-ink">
              <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-white">New</span>
              AI-assisted recovery tracking, now piloting <span aria-hidden>→</span>
            </a>
            <h1 className="text-[40px] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[58px]">
              <span className="text-[#0F2A33]">Recover with a plan.</span>
              <br />
              <span className="text-brand">Track.</span> <span className="text-leaf">Heal.</span> <span className="text-sun">Thrive.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-muted sm:text-[17px]">
              Physionexs connects patients and physiotherapists every day between visits — one shared plan, a 30-second check-in, measured
              progress, and AI that helps your physio notice early. Every decision stays with your physio, and the clinic runs from the same place.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link to="/signin" className="inline-flex h-12 items-center rounded-md bg-ink px-6 text-[13px] font-semibold uppercase tracking-[0.09em] text-white hover:bg-ink-2">
                Get started
              </Link>
              <a href="#how" className="eyebrow !text-ink hover:underline">See how it works ↓</a>
            </div>
          </div>
          <BothSides />
        </div>

        <Gap />
        <HowItWorks />
        <Audiences />
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
