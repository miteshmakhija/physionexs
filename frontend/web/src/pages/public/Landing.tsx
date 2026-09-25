import { Link } from 'react-router'

import { SupportFooter } from '@/components/Support'
import { Logo } from '@/components/ui'

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
        <h1 className="max-w-3xl text-[40px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[60px]">
          Recover with a plan. Track. Heal. Thrive.
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
