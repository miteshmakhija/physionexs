import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { SupportFooter } from '@/components/Support'
import { Logo } from '@/components/ui'

const UPDATED = '29 September 2026'
const CONTACT = 'connect@physionexs.com'

function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" aria-label="Physionexs home"><Logo className="h-8" /></Link>
          <nav className="flex gap-5 text-[13.5px]">
            <Link to="/terms" className="hover:underline">Terms</Link>
            <Link to="/privacy" className="hover:underline">Privacy</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="eyebrow">Last updated {UPDATED}</p>
        <h1 className="mt-2 text-[34px] font-bold tracking-[-0.02em]">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{intro}</p>
        <div className="mt-10 space-y-9">{children}</div>
      </main>
      <SupportFooter />
    </div>
  )
}

function Part({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[18px] font-semibold">{n}. {title}</h2>
      <div className="mt-2 space-y-3 text-[14.5px] leading-relaxed text-ink-2">{children}</div>
    </section>
  )
}

export function Terms() {
  return (
    <LegalPage
      title="Terms & Conditions"
      intro="These terms apply when you use Physionexs, on physionexs.com or in the Physionexs app, as a patient, a physiotherapist, or a member of a clinic's team. By creating an account or using the service you agree to them."
    >
      <Part n={1} title="What Physionexs is">
        <p>Physionexs is software that connects patients with physiotherapy clinics and helps clinics run their practice: bookings, walk-in tokens, patient records, care plans, prescriptions and invoices.</p>
        <p>Care is provided by the clinic and its physiotherapists, not by Physionexs. Clinical decisions, advice and treatment are the responsibility of the treating professional.</p>
      </Part>
      <Part n={2} title="Not for emergencies">
        <p>Physionexs is not an emergency service. If you have chest pain, difficulty breathing, severe bleeding, sudden weakness or any other emergency, call 112 or go to the nearest hospital.</p>
      </Part>
      <Part n={3} title="Your account">
        <p>You sign in with your email and password (or Google, for patients). Keep your password private; you are responsible for activity on your account. Tell us at {CONTACT} if you think someone else has used it.</p>
        <p>One email belongs to one kind of account: a patient account cannot also be a physiotherapist or staff login. Patients under 18 should use Physionexs with a parent or guardian.</p>
      </Part>
      <Part n={4} title="Bookings, payments and cancellations">
        <p>A booking reserves a slot with the physiotherapist at the branch you choose. Fees are set by the clinic and shown before you confirm.</p>
        <p>You can pay at the clinic, or online where available. Online payments are processed by our payment partner; we do not store your card details.</p>
        <p>You can cancel a booking up to 4 hours before it starts. Refunds for online payments are handled as described on your appointment page. Clinics may cancel or reschedule when needed; you will be told in the app.</p>
      </Part>
      <Part n={5} title="Health Points">
        <p>Health Points are a reward for logging your exercises. They can be used only to reduce the fee of a future booking made on Physionexs, have no cash value, cannot be transferred, and may be changed or withdrawn if misused.</p>
      </Part>
      <Part n={6} title="For clinics and physiotherapists">
        <p>Physiotherapists must hold a valid registration with their professional council; profiles become public only after we verify it. Clinics are responsible for the accuracy of the records, prescriptions and invoices they create, for the staff they add, and for complying with the laws that apply to their practice.</p>
        <p>The practice console is offered on the plan the clinic chooses (monthly, yearly, or a fee per app booking), with the trial and terms shown at sign-up.</p>
      </Part>
      <Part n={7} title="Acceptable use">
        <p>Do not misuse the service: no false information, no access to accounts or records that are not yours, no attempts to disrupt or reverse-engineer the platform, and nothing unlawful.</p>
      </Part>
      <Part n={8} title="Availability and liability">
        <p>We work to keep Physionexs available and accurate but cannot promise it will always be uninterrupted or error-free. To the extent the law allows, Physionexs is not liable for indirect losses, or for the care provided by clinics.</p>
      </Part>
      <Part n={9} title="Changes and ending your account">
        <p>We may update these terms; the date above shows the latest version, and we will tell you in the app about important changes. You can stop using Physionexs at any time and ask us to close your account at {CONTACT}. We may suspend accounts that break these terms.</p>
      </Part>
      <Part n={10} title="Law and contact">
        <p>These terms are governed by the laws of India. Questions: <a href={`mailto:${CONTACT}`} className="underline">{CONTACT}</a>. See also our <Link to="/privacy" className="underline">Privacy Policy</Link>.</p>
      </Part>
    </LegalPage>
  )
}

export function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This policy explains what personal data Physionexs collects, why, who can see it, and the choices you have. We process personal data in line with India's Digital Personal Data Protection Act, 2023."
    >
      <Part n={1} title="What we collect">
        <p><b className="text-ink">Account details:</b> your name, email, mobile number (optional for patients), and password (stored only as a secure hash).</p>
        <p><b className="text-ink">Health information:</b> what your clinic records about your care (consultation notes, care plans, exercises, medicines, tests and prescriptions) and what you log yourself (exercises, medicine doses, pain scores and daily check-ins).</p>
        <p><b className="text-ink">Bookings and payments:</b> appointments, invoices and payment status. Card and UPI details are handled by our payment partner, not stored by us.</p>
        <p><b className="text-ink">Clinic team data:</b> for staff, job details, attendance, leave and payroll entered by the clinic.</p>
        <p><b className="text-ink">Technical data:</b> sign-in times, device type and security logs, used to keep accounts safe.</p>
      </Part>
      <Part n={2} title="Why we use it">
        <p>To run your account and bookings; to let your clinic provide and track your care; to send reminders, updates and password-reset emails; to keep the service secure; and to improve Physionexs using aggregated data that does not identify you.</p>
        <p>We do not sell your personal data, and we do not use your health information for advertising.</p>
      </Part>
      <Part n={3} title="Who can see it">
        <p><b className="text-ink">Your clinic:</b> the clinics you book with or visit can see your records with them. Each clinic sees only its own patients; staff limited to one branch see only that branch.</p>
        <p><b className="text-ink">Service providers</b> who process data for us under contract: cloud hosting and database, email and SMS delivery, sign-in with Google, payment processing, and app notifications. Where a clinic turns on AI assist, only de-identified clinical data is sent to the AI provider.</p>
        <p><b className="text-ink">Authorities,</b> only where the law requires it.</p>
      </Part>
      <Part n={4} title="How long we keep it">
        <p>We keep your data while your account is active. Medical and financial records may need to be kept for longer periods required by law; other data is deleted or anonymised when no longer needed.</p>
      </Part>
      <Part n={5} title="Security">
        <p>Data is encrypted in transit, access is limited by role and branch, sensitive actions are logged, and administrator accounts use two-factor authentication.</p>
      </Part>
      <Part n={6} title="Your choices and rights">
        <p>You can see and update your details in the app, and ask us to access, correct or erase your personal data, or withdraw consent, by writing to <a href={`mailto:${CONTACT}`} className="underline">{CONTACT}</a>. Some records must be kept by your clinic by law. You may also nominate someone to act for you, and complain to the Data Protection Board of India.</p>
      </Part>
      <Part n={7} title="Children">
        <p>Patients under 18 should use Physionexs with the consent of a parent or guardian.</p>
      </Part>
      <Part n={8} title="Changes and contact">
        <p>We may update this policy; the date above shows the latest version. For privacy questions or grievances, contact our Grievance Officer at <a href={`mailto:${CONTACT}`} className="underline">{CONTACT}</a>. See also our <Link to="/terms" className="underline">Terms &amp; Conditions</Link>.</p>
      </Part>
    </LegalPage>
  )
}
