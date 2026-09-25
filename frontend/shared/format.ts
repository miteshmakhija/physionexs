// Display helpers shared by web and mobile.
// Deliberately Intl-free: React Native's Hermes engine has partial timezone/locale support, and
// every clinic is currently in India (IST = UTC+5:30, no daylight saving), so we shift explicitly.

export const CLINIC_UTC_OFFSET_MINUTES = 330

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** A Date whose UTC fields read as clinic-local wall time. */
function local(input: string | Date): Date {
  const d = typeof input === 'string' ? new Date(input) : input
  return new Date(d.getTime() + CLINIC_UTC_OFFSET_MINUTES * 60_000)
}

/** Indian digit grouping: 1,23,456 */
function groupIN(n: number): string {
  const [int, dec] = Math.abs(n).toFixed(n % 1 ? 2 : 0).split('.')
  const last3 = int.slice(-3)
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return (n < 0 ? '-' : '') + (rest ? `${rest},${last3}` : last3) + (dec ? `.${dec}` : '')
}

export function rupees(paise: number | null | undefined): string {
  if (paise == null) return '—'
  return '₹' + groupIN(paise / 100)
}

export function time(iso: string): string {
  const d = local(iso)
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/** 0–23 hour in clinic time. */
export function hourIn(iso: string): number {
  return local(iso).getUTCHours()
}

/** "Wed 1 Oct" */
export function dayLabel(iso: string | Date): string {
  const d = local(iso)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** YYYY-MM-DD in clinic time. */
export function isoDay(input: string | Date = new Date()): string {
  return local(input).toISOString().slice(0, 10)
}

/** "Today · 4:30 pm", "Tomorrow · 9:00 am", "Wed 1 Oct · 11:00 am" */
export function when(iso: string): string {
  const day = isoDay(iso)
  const today = isoDay(new Date())
  const tomorrow = isoDay(new Date(Date.now() + 86_400_000))
  const prefix = day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : dayLabel(iso)
  return `${prefix} · ${time(iso)}`
}

/** For a YYYY-MM-DD string: { weekday: 'Mon', date: 28, long: 'Monday, 28 September' } */
export function dayParts(yyyyMmDd: string) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`)
  const weekday = DAYS[d.getUTCDay()]
  return {
    weekday,
    date: d.getUTCDate(),
    long: `${WEEKDAYS[(d.getUTCDay() + 6) % 7]}, ${d.getUTCDate()} ${FULL_MONTHS[d.getUTCMonth()]}`,
  }
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const MODE_LABEL = { in_clinic: 'In-clinic', online: 'Online video' } as const

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting payment',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

export const REFERRAL_OPTIONS = [
  { value: 'search', label: 'Physionexs search' },
  { value: 'friend_family', label: 'Friend or family' },
  { value: 'doctor_referral', label: 'Doctor referral' },
  { value: 'google', label: 'Google' },
  { value: 'social_media', label: 'Social media' },
  { value: 'walk_by', label: 'Walked past the clinic' },
  { value: 'other', label: 'Other' },
] as const

/** "Mon 28 Sep" for a YYYY-MM-DD date. */
export function shortDate(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
