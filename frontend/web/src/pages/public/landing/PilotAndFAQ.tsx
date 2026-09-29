import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui'
import { api } from '@/lib/api'

/** "Become a pilot clinic": saved for the Super Admin (Records → Pilot leads) and emailed to support. */
export function PilotForm() {
  const [f, setF] = useState({ clinic_name: '', contact_name: '', city: '', phone: '', email: '', knee_patients_per_month: '', message: '', website: '' })
  const send = useMutation({
    mutationFn: () => api('/platform/pilot-leads', {
      method: 'POST',
      json: { ...f, email: f.email || null, knee_patients_per_month: f.knee_patients_per_month || null, message: f.message || null, website: f.website || null },
    }),
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <section id="pilot" aria-labelledby="pilot-heading" className="scroll-mt-8 border-t border-line pt-12">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="eyebrow">Pilot programme</p>
          <h2 id="pilot-heading" className="mt-3 text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">Become a pilot clinic</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            We’re working with a small number of clinics that treat knee-replacement patients to pilot recovery tracking, daily check-ins,
            camera measurement and AI assist. Pilot clinics help shape how it works in real practice.
          </p>
          <ul className="mt-5 space-y-2 text-[14px]">
            {['Switched on for your clinic when you’re ready', 'Your physios decide every change to a patient’s plan', 'Help us validate camera measurement against a goniometer'].map((x) => (
              <li key={x} className="flex gap-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-leaf" />{x}</li>
            ))}
          </ul>
        </div>
        {send.isSuccess ? (
          <div className="self-start rounded-md border border-line p-6" role="status">
            <p className="text-[18px] font-bold">Thank you — we’ve got your details.</p>
            <p className="mt-1 text-[14px] text-muted">Someone from Physionexs will be in touch soon.</p>
          </div>
        ) : (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); send.mutate() }}>
            <Field label="Clinic name"><Input value={f.clinic_name} onChange={set('clinic_name')} required minLength={2} autoComplete="organization" /></Field>
            <Field label="Your name"><Input value={f.contact_name} onChange={set('contact_name')} required minLength={2} autoComplete="name" /></Field>
            <Field label="City"><Input value={f.city} onChange={set('city')} required minLength={2} autoComplete="address-level2" /></Field>
            <Field label="Mobile number"><Input type="tel" value={f.phone} onChange={set('phone')} required autoComplete="tel" placeholder="98123 45678" /></Field>
            <Field label="Email (optional)"><Input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></Field>
            <Field label="Knee-replacement patients a month">
              <Select value={f.knee_patients_per_month} onChange={set('knee_patients_per_month')}>
                <option value="">Choose…</option>
                <option value="<10">Fewer than 10</option>
                <option value="10-30">10 to 30</option>
                <option value="30+">More than 30</option>
              </Select>
            </Field>
            <div className="sm:col-span-2"><Field label="Anything else? (optional)"><Textarea rows={3} value={f.message} onChange={set('message')} maxLength={1000} /></Field></div>
            {/* Hidden from people; bots fill it in and are ignored. */}
            <input type="text" name="website" value={f.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-px w-px opacity-0" />
            {send.error && <div className="sm:col-span-2"><Alert>{(send.error as Error).message}</Alert></div>}
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <Button type="submit" loading={send.isPending}>Request a pilot</Button>
              <span className="text-[12.5px] text-muted">We use these details only to contact you about the pilot.</span>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

const FAQ = [
  {
    q: 'Is my health data safe?',
    a: 'Your records are visible only to your clinic. Daily check-ins are shared with your physio only after you agree, and you can stop at any time. Camera video is analysed on your device and never uploaded. When your physio uses AI assist, the AI receives recovery numbers — never your name or contact details. Physionexs is designed around India’s Digital Personal Data Protection Act, 2023.',
  },
  {
    q: 'Does AI make decisions about my treatment?',
    a: 'No. AI measures, flags and drafts; your physiotherapist decides. Automatic suggestions can only hold or reduce your exercises, and nothing reaches your plan until your physio approves it.',
  },
  {
    q: 'Is this an emergency service?',
    a: 'No. If you report a warning sign in a check-in, the app tells you straight away to contact your clinic, or to call 112 for chest pain or sudden breathlessness. If you feel very unwell, call 112.',
  },
  {
    q: 'Do I need to install an app?',
    a: 'No. Everything works on the web at physionexs.com today. iOS and Android apps are coming soon.',
  },
  {
    q: 'Which conditions does it support?',
    a: 'Booking, records and exercise plans work for any physiotherapy. Recovery tracking, check-ins and AI assist are being piloted for knee replacement first.',
  },
  {
    q: 'What does it cost a clinic?',
    a: 'Clinics choose a monthly or yearly plan, or pay per booking, and start with a free trial. You’ll see the plans when you sign up.',
  },
]

export function FAQSection() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-8 border-t border-line pt-12">
      <p className="eyebrow">Questions</p>
      <h2 id="faq-heading" className="mt-3 text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">Frequently asked</h2>
      <div className="mt-8 divide-y divide-line border-y border-line">
        {FAQ.map((f) => (
          <details key={f.q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold">
              {f.q}
              <span aria-hidden className="text-[20px] leading-none text-muted transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
