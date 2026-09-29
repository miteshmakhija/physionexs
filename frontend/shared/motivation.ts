/**
 * Daily motivation for patients: one message a day, the same for everyone that day, cycling through
 * exercise, points, recovery, medicine and healthy-food themes. General wellness only; never advice for a
 * specific condition (the card says to follow the physio's and doctor's advice).
 */

export type MotivationKind = 'exercise' | 'points' | 'recovery' | 'medicine' | 'food'

export interface Motivation {
  kind: MotivationKind
  text: string
}

export const MOTIVATION_LABEL: Record<MotivationKind, string> = {
  exercise: 'Keep moving',
  points: 'Earn as you heal',
  recovery: 'Your recovery',
  medicine: 'Medicines',
  food: 'Eat well',
}

export const MOTIVATIONS: Motivation[] = [
  { kind: 'exercise', text: 'Small sessions every day beat one long session a week. Ten focused minutes today counts.' },
  { kind: 'food', text: 'Add protein to each meal (dal, paneer, eggs, curd, sprouts or fish). It helps muscles repair after exercise.' },
  { kind: 'points', text: 'Log your exercises 7 days in a row and Health Points land in your account, ready to take money off your next visit.' },
  { kind: 'recovery', text: 'Recovery is rarely a straight line. A sore day is normal; keep going, and tell your physio if pain keeps rising.' },
  { kind: 'medicine', text: 'Take your medicines at the same time each day and tick them off. Your physio can see what you’ve logged.' },
  { kind: 'food', text: 'Drink water through the day. Well-hydrated muscles and joints move more easily during exercise.' },
  { kind: 'exercise', text: 'Do your exercises at the same time each day, like after brushing your teeth, and they soon become a habit.' },
  { kind: 'points', text: 'Every day you log adds to your streak. Longer streaks earn more points, so don’t break the chain.' },
  { kind: 'recovery', text: 'Patients who follow their home programme usually get back to normal activities sooner. Today’s effort is tomorrow’s progress.' },
  { kind: 'food', text: 'Calcium and vitamin D foods (milk, curd, ragi, sesame, green leafy vegetables, a little morning sun) support strong bones.' },
  { kind: 'exercise', text: 'Quality over quantity: slow, controlled movements do more than rushed repetitions.' },
  { kind: 'medicine', text: 'Set a phone alarm for your medicines. Missed doses are easy to forget on busy days.' },
  { kind: 'points', text: 'Health Points never ask you to pay more. They only take money off your next booking. Log today to keep earning.' },
  { kind: 'food', text: 'Fill half your plate with colourful vegetables and fruit. They bring the vitamins your body uses to heal.' },
  { kind: 'recovery', text: 'Look how far you’ve come. Check your Progress page to see your pain and exercise trend over the weeks.' },
  { kind: 'exercise', text: 'Warm up for a few minutes before your exercises: a short walk or gentle movement gets your joints ready.' },
  { kind: 'food', text: 'Go easy on sugary drinks and fried snacks. Choose fruit, nuts, roasted chana or buttermilk instead.' },
  { kind: 'medicine', text: 'Don’t stop or change a medicine on your own. If something doesn’t feel right, ask your doctor or physio first.' },
  { kind: 'recovery', text: 'Good sleep is part of your treatment. Your body does much of its repair work while you rest.' },
  { kind: 'points', text: 'Two weeks of logged exercise earns even more points than one. Keep your streak going and watch the balance grow.' },
  { kind: 'exercise', text: 'If an exercise feels too hard, don’t skip it. Do fewer reps and mention it at your next visit.' },
]

/** Today's message: stable for the whole local day, different on the next. */
export function motivationFor(date = new Date()): Motivation {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
  return MOTIVATIONS[day % MOTIVATIONS.length]
}
