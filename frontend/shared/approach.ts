// "Our approach: digital twin" copy, shared by the web landing page and the mobile sign-in screen.
// This is not built yet — keep the "In development" framing and avoid clinical-accuracy claims
// until camera angles have been validated against goniometer readings.

export const approach = {
  eyebrow: 'Our approach · Digital twin',
  status: 'In development',
  headline: 'A living model of your recovery.',
  intro:
    'Your phone camera measures how you move, AI spots what’s changing, and your physio decides what happens next — a digital twin of your rehab that updates between visits.',
  // The four features Olawade et al. (2026, §2.2) use to define a true digital twin; each step delivers one.
  criteriaNote: 'Researchers define a true digital twin by four features — patient-specific, near-real-time, predictive and two-way. Each step is built to deliver one.',
  steps: [
    {
      n: '01',
      title: 'Capture',
      trait: 'Near-real-time',
      body: 'Your phone camera estimates joint angles, counts reps and checks your form as you exercise, with instant on-screen feedback. A 30-second daily check-in adds pain and stiffness.',
    },
    {
      n: '02',
      title: 'Model',
      trait: 'Patient-specific',
      body: 'A virtual model of your recovery that belongs to you alone: range of motion, pain and adherence, charted over time against your goals.',
    },
    {
      n: '03',
      title: 'Flag & explain',
      trait: 'Predictive',
      body: 'Rules and recovery curves catch plateaus, missed sessions and flare-up triggers early. GenAI explains each flag in plain language and drafts your physio’s notes.',
    },
    {
      n: '04',
      title: 'Physio decides',
      trait: 'Two-way',
      body: 'Your physio reviews every suggestion. Once approved, the updated plan goes straight back to your app, closing the loop.',
    },
  ],
  principles: [
    { title: 'Video stays on your phone', body: 'Movement is analysed on the device. Only joint angles are sent, never the video.' },
    { title: 'AI suggests, your physio decides', body: 'Nothing in your plan changes without your physio’s approval.' },
    { title: 'Safe by default', body: 'If readings look wrong, the app falls back to your last approved plan. It never increases load on its own.' },
    { title: 'Consent first', body: 'The camera runs only when you start an exercise. Designed around India’s DPDP Act, 2023.' },
  ],
  citation: {
    label: 'Grounded in Olawade et al., “The role of digital twin technology in physiotherapy and rehabilitation practice”, Virtual Reality & Intelligent Hardware 8(1), 2026.',
    url: 'https://doi.org/10.1016/j.vrih.2026.01.002',
  },
} as const
