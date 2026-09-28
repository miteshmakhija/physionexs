// Daily recovery check-in: answer options shared by the web and mobile patient apps.
// Red-flag options and all safety advice come from the API, so the wording lives in one place (backend).

export const SWELLING = [
  { value: 'none', label: 'None' },
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
] as const

export const SLEEP = [
  { value: 'good', label: 'Well' },
  { value: 'ok', label: 'Okay' },
  { value: 'poor', label: 'Poorly' },
] as const

export const EXERCISES = [
  { value: 'all', label: 'All' },
  { value: 'some', label: 'Some' },
  { value: 'none', label: 'None' },
] as const

export type Swelling = (typeof SWELLING)[number]['value']
export type Sleep = (typeof SLEEP)[number]['value']
export type Exercises = (typeof EXERCISES)[number]['value']

export const labelOf = (options: readonly { value: string; label: string }[], value: string) => options.find((o) => o.value === value)?.label ?? value
