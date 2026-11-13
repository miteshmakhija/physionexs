// Structured physiotherapy assessment: the form definition shared by the web and mobile physio apps.
// Answers are stored on the consultation as `assessment_form.sections[<section id>][<field key>]`.
// Red-flag screening (section 4) is NOT defined here: its wording and sign-off rules come from the API
// (GET /clinic/assessment-form, backend/app/services/assessment.py) so the safety copy lives in one place.

export const FORM_VERSION = 1

export type VisitType = 'initial' | 'follow_up' | 'reassessment'

export type Option = { value: string; label: string }

type Base = { key: string; label: string; showIf?: { key: string; equals: string } }
export type FormField = Base & (
  | { kind: 'single'; options: readonly Option[] } // one choice (chips)
  | { kind: 'multi'; options: readonly Option[] } // any number of choices
  | { kind: 'select'; options: readonly Option[] } // one choice (dropdown)
  | { kind: 'yesno' }
  | { kind: 'scale'; min: number; max: number }
  | { kind: 'text'; multiline?: boolean }
  | { kind: 'date' }
  // One choice per row, e.g. functional activities or ROM per movement. `sided` asks for R / L per row.
  | { kind: 'matrix'; rows: readonly Option[] | 'movements'; columns: readonly Option[]; sided?: boolean }
  // A 0–5 grade per row and side (MRC strength).
  | { kind: 'grades'; rows: readonly Option[] | 'movements'; min: number; max: number }
  // Measured degrees per row and side (goniometer). Knee values also feed recovery tracking on sign.
  | { kind: 'degrees'; rows: readonly Option[] | 'movements'; max: number }
  // Region-specific special tests, each Positive / Negative / Not performed.
  | { kind: 'special_tests' }
)

export type FormSection = { id: string; title: string; hint?: string; groups: { title?: string; fields: FormField[] }[] }

const o = (...labels: string[]): Option[] => labels.map((label) => ({ value: slug(label), label }))
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const yesno = (...labels: string[]): FormField[] => labels.map((label) => ({ kind: 'yesno', key: slug(label), label }))

export const BODY_REGIONS = o('Cervical spine', 'Thoracic spine', 'Lumbar spine', 'Shoulder', 'Elbow', 'Wrist & hand', 'Hip', 'Knee', 'Ankle & foot', 'Multiple / general')
export const SIDES = o('Right', 'Left', 'Bilateral')

const GENERIC_MOVEMENTS = o('Flexion', 'Extension', 'Abduction', 'Adduction', 'Internal rotation', 'External rotation')
const SPINE_MOVEMENTS = o('Flexion', 'Extension', 'Side flexion', 'Rotation')
/** Movements shown in ROM and strength for a body region; anything not listed uses the generic six. */
export const MOVEMENTS_BY_REGION: Record<string, Option[]> = {
  cervical_spine: SPINE_MOVEMENTS,
  thoracic_spine: SPINE_MOVEMENTS,
  lumbar_spine: SPINE_MOVEMENTS,
  elbow: o('Flexion', 'Extension', 'Pronation', 'Supination'),
  wrist_hand: o('Flexion', 'Extension', 'Radial deviation', 'Ulnar deviation', 'Grip'),
  knee: o('Flexion', 'Extension'),
  ankle_foot: o('Dorsiflexion', 'Plantarflexion', 'Inversion', 'Eversion'),
}
export const movementsFor = (region?: string) => (region && MOVEMENTS_BY_REGION[region]) || GENERIC_MOVEMENTS

// Where a measured value means something other than the movement name. Knee "extension" is recorded as lag
// (degrees short of straight) because that is what recovery tracking stores (backend KNEE_TWIN_READINGS).
const DEGREE_LABELS: Record<string, Record<string, string>> = { knee: { extension: 'Extension lag' } }
export const degreeLabel = (row: Option, region?: string) => DEGREE_LABELS[region ?? '']?.[row.value] ?? row.label

/** Rows whose readings are saved to recovery tracking (pilot clinics, knee only). Mirrors backend KNEE_TWIN_READINGS. */
export const TWIN_ROWS: Record<string, string[]> = { degrees: ['flexion', 'extension'], mrc: ['extension', 'flexion'] }
export const feedsRecovery = (region?: string) => region === 'knee'

/** Special tests offered for a body region (section 13). Only the selected region's list is shown. */
export const SPECIAL_TESTS: Record<string, Option[]> = {
  cervical_spine: o('Spurling', 'Distraction', 'ULTT (median)', 'Sharp-Purser'),
  lumbar_spine: o('Straight leg raise', 'Slump', 'Prone instability', 'Femoral nerve stretch'),
  shoulder: o('Neer', 'Hawkins-Kennedy', 'Empty can', 'Drop arm', "Speed's", "O'Brien", 'Apprehension'),
  elbow: o("Cozen's", "Mill's", "Golfer's elbow", 'Varus stress', 'Valgus stress'),
  wrist_hand: o("Phalen's", "Tinel's", 'Finkelstein'),
  hip: o('FABER', 'FADIR', 'Thomas', 'Trendelenburg'),
  knee: o('Lachman', 'Anterior drawer', 'Posterior drawer', 'McMurray', 'Thessaly', 'Valgus stress', 'Varus stress', 'Patellar apprehension'),
  ankle_foot: o('Anterior drawer', 'Talar tilt', 'Thompson', 'Squeeze'),
}
export const TEST_RESULTS = o('Positive', 'Negative', 'Not performed')

export const ASSESSMENT_SECTIONS: FormSection[] = [
  {
    id: 'visit', title: 'Patient & visit', groups: [{
      fields: [
        { kind: 'select', key: 'referred_by', label: 'Referred by', options: o('Self', 'Orthopaedic surgeon', 'GP / physician', 'Neurologist', 'Sports physician', 'Another physio', 'Other') },
        { kind: 'select', key: 'body_region', label: 'Body region', options: BODY_REGIONS },
        { kind: 'single', key: 'side', label: 'Side', options: SIDES },
        { kind: 'single', key: 'onset', label: 'Onset', options: o('Sudden', 'Gradual', 'Post-trauma', 'Post-operative') },
        { kind: 'single', key: 'duration', label: 'Duration', options: [{ value: 'lt_1w', label: '< 1 week' }, { value: '1_4w', label: '1–4 weeks' }, { value: '1_3m', label: '1–3 months' }, { value: 'gt_3m', label: '> 3 months' }] },
      ],
    }],
  },
  {
    id: 'complaints', title: 'Chief complaints', groups: [
      { fields: [
        { kind: 'multi', key: 'complaints', label: 'Patient has', options: o('Pain', 'Stiffness', 'Weakness', 'Swelling', 'Numbness', 'Tingling', 'Muscle spasm', 'Reduced movement', 'Difficulty walking', 'Balance problem', 'Fatigue', 'Other') },
        { kind: 'yesno', key: 'pain', label: 'Pain present' },
      ] },
      { title: 'Pain', fields: [
        { kind: 'scale', key: 'pain_intensity', label: 'Pain intensity (NPRS)', min: 0, max: 10, showIf: { key: 'pain', equals: 'yes' } },
        { kind: 'multi', key: 'pain_type', label: 'Pain type', options: o('Sharp', 'Dull', 'Aching', 'Burning', 'Throbbing'), showIf: { key: 'pain', equals: 'yes' } },
        { kind: 'single', key: 'pain_frequency', label: 'Frequency', options: o('Constant', 'Intermittent'), showIf: { key: 'pain', equals: 'yes' } },
        ...yesno('Pain at rest', 'Pain at night', 'Pain with movement', 'Pain radiates').map((f) => ({ ...f, showIf: { key: 'pain', equals: 'yes' } })),
      ] },
    ],
  },
  {
    id: 'history', title: 'History', hint: 'Pre-filled from the patient’s medical background where recorded.', groups: [
      { title: 'Previous history', fields: yesno('Previous similar problem', 'Previous physiotherapy', 'Previous surgery', 'Previous fracture', 'Previous trauma / injury', 'Hospitalisation') },
      { title: 'Medical history', fields: yesno('Diabetes', 'Hypertension', 'Cardiac condition', 'Respiratory condition', 'Neurological condition', 'Arthritis', 'Osteoporosis', 'Cancer history', 'Other significant illness') },
      { title: 'Surgical history', fields: [
        ...yesno('Recent surgery', 'Implant / prosthesis'),
        { kind: 'select', key: 'surgery_site', label: 'Surgery site', options: BODY_REGIONS, showIf: { key: 'recent_surgery', equals: 'yes' } },
        { kind: 'date', key: 'surgery_date', label: 'Surgery date', showIf: { key: 'recent_surgery', equals: 'yes' } },
      ] },
    ],
  },
  // Section 4, red-flag screening, comes from the API and sits between History and Observation.
  {
    id: 'observation', title: 'Observation', groups: [
      { title: 'General', fields: yesno('Conscious & oriented', 'Cooperative', 'Comfortable at rest', 'Distress observed') },
      { title: 'Posture', fields: [{ kind: 'multi', key: 'posture', label: 'Posture', options: o('Normal', 'Forward head', 'Rounded shoulders', 'Increased thoracic kyphosis', 'Increased lumbar lordosis', 'Scoliosis', 'Pelvic asymmetry', 'Other') }] },
      { title: 'Swelling', fields: [
        { kind: 'yesno', key: 'swelling', label: 'Swelling present' },
        { kind: 'single', key: 'swelling_side', label: 'Side', options: SIDES, showIf: { key: 'swelling', equals: 'yes' } },
        { kind: 'yesno', key: 'pitting', label: 'Pitting', showIf: { key: 'swelling', equals: 'yes' } },
      ] },
      { title: 'Skin / scar', fields: yesno('Skin normal', 'Scar present', 'Redness', 'Bruising', 'Wound') },
    ],
  },
  {
    id: 'gait', title: 'Gait', groups: [{
      fields: [
        ...yesno('Independent walking', 'Normal gait', 'Limp', 'Antalgic gait', 'Reduced step length', 'Reduced walking speed', 'Foot drop', 'Balance difficulty'),
        { kind: 'single', key: 'assistive_device', label: 'Assistive device', options: o('None', 'Cane', 'Walker', 'Crutches', 'Wheelchair', 'Other') },
      ],
    }],
  },
  {
    id: 'palpation', title: 'Palpation', groups: [{
      fields: [
        ...yesno('Tenderness', 'Muscle spasm', 'Increased muscle tone', 'Reduced muscle tone', 'Trigger point', 'Warmth', 'Swelling'),
        { kind: 'single', key: 'tenderness_grade', label: 'Tenderness grade', options: o('None', 'Mild', 'Moderate', 'Severe') },
      ],
    }],
  },
  {
    id: 'rom', title: 'Range of motion', hint: 'Movements follow the body region chosen in Patient & visit.', groups: [{
      fields: [
        { kind: 'matrix', key: 'rom', label: 'Range of motion', rows: 'movements', columns: o('Normal', 'Restricted', 'Painful'), sided: true },
        { kind: 'degrees', key: 'degrees', label: 'Measured range (°)', rows: 'movements', max: 180 },
      ],
    }],
  },
  {
    id: 'strength', title: 'Muscle strength', groups: [{
      fields: [
        { kind: 'single', key: 'overall', label: 'Overall', options: o('Normal strength', 'Mild weakness', 'Moderate weakness', 'Severe weakness') },
        { kind: 'grades', key: 'mrc', label: 'MRC grade (0–5)', rows: 'movements', min: 0, max: 5 },
      ],
    }],
  },
  {
    id: 'neuro', title: 'Neurological', groups: [
      { title: 'Sensation', fields: [{ kind: 'multi', key: 'sensation', label: 'Sensation', options: o('Normal', 'Reduced', 'Increased', 'Numbness', 'Tingling') }] },
      { title: 'Motor', fields: yesno('Normal motor function', 'Weakness', 'Coordination normal') },
      { title: 'Reflexes', fields: [{ kind: 'single', key: 'reflexes', label: 'Reflexes', options: o('Normal', 'Reduced', 'Increased') }] },
    ],
  },
  {
    id: 'balance', title: 'Balance', groups: [
      { fields: yesno('Sitting balance normal', 'Standing balance normal', 'Single-leg balance normal', 'Dynamic balance normal', 'Fall risk identified') },
      { title: 'Falls history', fields: yesno('Fall in last 12 months', 'Recurrent falls') },
    ],
  },
  {
    id: 'function', title: 'Functional assessment', groups: [{
      fields: [{
        kind: 'matrix', key: 'activities', label: 'Activities', columns: o('Normal', 'Difficulty', 'Unable'),
        rows: o('Bed mobility', 'Sit to stand', 'Sitting', 'Standing', 'Walking', 'Stairs', 'Dressing', 'Bathing', 'Toileting', 'Driving', 'Work activities', 'Sports'),
      }],
    }],
  },
  {
    id: 'special_tests', title: 'Special tests', hint: 'Shows the tests for the chosen body region.', groups: [{
      fields: [{ kind: 'special_tests', key: 'tests', label: 'Special tests' }],
    }],
  },
  {
    id: 'outcomes', title: 'Outcome measures', groups: [{
      fields: [
        { kind: 'select', key: 'tool', label: 'Assessment tool', options: o('VAS / NPRS', 'Oswestry Disability Index', 'Neck Disability Index', 'WOMAC', 'DASH / QuickDASH', 'LEFS', 'Berg Balance Scale', 'TUG', '6-Minute Walk Test', 'Other') },
        { kind: 'text', key: 'score', label: 'Score' },
        { kind: 'text', key: 'interpretation', label: 'Interpretation' },
      ],
    }],
  },
  {
    id: 'clinical', title: 'Clinical assessment', groups: [{
      fields: [
        { kind: 'multi', key: 'problems', label: 'Main problems', options: o('Pain', 'Reduced ROM', 'Muscle weakness', 'Reduced flexibility', 'Poor posture', 'Balance impairment', 'Gait abnormality', 'Reduced endurance', 'Neurological impairment', 'Functional limitation', 'Swelling', 'Other') },
        { kind: 'multi', key: 'impression', label: 'Clinical impression', options: o('Musculoskeletal', 'Neurological', 'Orthopaedic', 'Post-operative', 'Sports injury', 'Geriatric', 'Paediatric', 'Cardiopulmonary', 'Other') },
        { kind: 'text', key: 'impression_text', label: 'Clinical impression (free text)', multiline: true },
      ],
    }],
  },
  {
    id: 'goals', title: 'Goals', groups: [{
      fields: [
        { kind: 'multi', key: 'short_term', label: 'Short-term goals', options: o('Reduce pain', 'Reduce swelling', 'Improve ROM', 'Improve muscle strength', 'Improve flexibility', 'Improve balance', 'Improve gait', 'Improve mobility', 'Improve function', 'Improve endurance') },
        { kind: 'multi', key: 'long_term', label: 'Long-term goals', options: o('Independent ADLs', 'Independent walking', 'Return to work', 'Return to sports', 'Return to previous activity level', 'Reduce recurrence', 'Independent home exercise program') },
      ],
    }],
  },
  {
    id: 'treatment', title: 'Treatment plan', groups: [{
      fields: [
        { kind: 'multi', key: 'provided', label: 'Treatment provided', options: o('Therapeutic exercise', 'Stretching', 'Strengthening', 'Manual therapy', 'Joint mobilisation', 'Soft tissue therapy', 'Neuromuscular re-education', 'Balance training', 'Gait training', 'Postural training', 'Electrotherapy', 'Heat therapy', 'Cold therapy', 'Taping', 'Patient education', 'Home exercise program') },
        { kind: 'single', key: 'frequency', label: 'Frequency', options: [{ value: 'daily', label: 'Daily' }, { value: '2x_week', label: '2× / week' }, { value: '3x_week', label: '3× / week' }, { value: 'weekly', label: 'Weekly' }, { value: 'as_required', label: 'As required' }] },
        { kind: 'single', key: 'duration', label: 'Planned duration', options: [{ value: '1w', label: '1 week' }, { value: '2w', label: '2 weeks' }, { value: '4w', label: '4 weeks' }, { value: '6w', label: '6 weeks' }, { value: '8w_plus', label: '8+ weeks' }] },
      ],
    }],
  },
  {
    // Exercises themselves are prescribed on the care plan (Prescribe exercises); this only records the teaching.
    id: 'hep', title: 'Home exercise program', hint: 'Prescribe the exercises from the care plan; record the teaching here.', groups: [{
      fields: yesno('HEP explained', 'Patient understood', 'Patient demonstrated correctly'),
    }],
  },
  {
    // Therapist, date and signature come from signing the note.
    id: 'final', title: 'Final assessment', groups: [{
      fields: [
        ...yesno('Condition improving', 'Patient responding to treatment', 'Further physiotherapy required', 'Referral required', 'Home program required'),
        { kind: 'text', key: 'remarks', label: 'Therapist’s final remarks', multiline: true },
      ],
    }],
  },
]

/** Sections a follow-up visit shows; initial assessments and reassessments show them all. */
export const FOLLOW_UP_SECTIONS = ['complaints', 'rom', 'strength', 'outcomes', 'treatment', 'final']

export const sectionsFor = (visit: VisitType) =>
  visit === 'follow_up' ? ASSESSMENT_SECTIONS.filter((s) => FOLLOW_UP_SECTIONS.includes(s.id)) : ASSESSMENT_SECTIONS

/** Red-flag screening is required before signing these visit types (mirrors backend SCREENED_VISITS). */
export const needsScreening = (visit: VisitType) => visit !== 'follow_up'

// ── Values, progress and pre-fill ───────────────────────────────────────────

export type SectionValues = Record<string, unknown>
export type FormValues = Record<string, SectionValues> // keyed by section id
export type MatrixCell = { value?: string; side?: string }
export type GradeCell = { right?: number; left?: number }

export const MATRIX_SIDES: Option[] = [{ value: 'right', label: 'R' }, { value: 'left', label: 'L' }, { value: 'both', label: 'R+L' }]

export const isVisible = (f: FormField, values: SectionValues) => !f.showIf || values[f.showIf.key] === f.showIf.equals

const hasValue = (v: unknown): boolean =>
  v != null && v !== '' && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)

/** Visible fields in a section and how many have an answer. */
export function progressOf(section: FormSection, values: SectionValues = {}) {
  const fields = section.groups.flatMap((g) => g.fields).filter((f) => isVisible(f, values))
  return { total: fields.length, answered: fields.filter((f) => hasValue(values[f.key])).length }
}

export const regionOf = (values: FormValues) => values.visit?.body_region as string | undefined

export const rowsFor = (rows: readonly Option[] | 'movements', region?: string) => (rows === 'movements' ? movementsFor(region) : rows)

// Medical-history items matched against the free-text conditions on the patient's medical background.
const CONDITION_HINTS: Record<string, RegExp> = {
  diabetes: /diabet|\bdm\b|t[12]dm/i,
  hypertension: /hypertens|\bhtn\b|blood pressure/i,
  cardiac_condition: /cardiac|heart|\bcad\b|angina|arrhythm/i,
  respiratory_condition: /asthma|copd|respirat|lung|bronch/i,
  neurological_condition: /neuro|stroke|parkinson|epilep|sclerosis|neuropath/i,
  arthritis: /arthrit|\boa\b|\bra\b|gout/i,
  osteoporosis: /osteopor|osteopen/i,
  cancer_history: /cancer|tumou?r|malignan|carcinoma|lymphoma/i,
}

/** History answers implied by the background's conditions ("Type 2 diabetes" → Diabetes: yes). */
export function historyFromConditions(conditions: readonly string[] = []): SectionValues {
  return Object.fromEntries(Object.entries(CONDITION_HINTS).filter(([, re]) => conditions.some((c) => re.test(c))).map(([k]) => [k, 'yes']))
}

/** Background conditions plus any medical-history items answered "yes" that it doesn't mention yet. */
export function conditionsWithHistory(history: SectionValues = {}, conditions: readonly string[] = []): string[] {
  const medical = ASSESSMENT_SECTIONS.find((s) => s.id === 'history')?.groups.find((g) => g.title === 'Medical history')?.fields ?? []
  const added = medical
    .filter((f) => history[f.key] === 'yes' && f.key !== 'other_significant_illness')
    .filter((f) => !conditions.some((c) => (CONDITION_HINTS[f.key] ?? new RegExp(f.label, 'i')).test(c)))
    .map((f) => f.label)
  return [...conditions, ...added]
}

// ── S/O/A/P text from the structured answers ────────────────────────────────

const SOAP_BUCKETS = {
  subjective: ['visit', 'complaints', 'history'],
  objective: ['observation', 'gait', 'palpation', 'rom', 'strength', 'neuro', 'balance', 'function', 'special_tests', 'outcomes'],
  assessment: ['clinical'],
  plan: ['goals', 'treatment', 'hep', 'final'],
}
export type Soap = Record<keyof typeof SOAP_BUCKETS, string>

// "No" is worth writing down for these (an expected normal finding that's absent); otherwise only "yes" is listed.
const NO_MATTERS = /normal|^independent|^conscious|^cooperative|^comfortable|^condition improving|^patient (responding|understood|demonstrated)|^hep explained/i

const optLabel = (options: readonly Option[], v: unknown) => options.find((x) => x.value === v)?.label ?? String(v)
const lower = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1))

function fieldText(f: FormField, v: unknown, region?: string): string | null {
  if (!hasValue(v)) return null
  switch (f.kind) {
    case 'single':
    case 'select':
      return `${f.label}: ${lower(optLabel(f.options, v))}`
    case 'multi':
      return `${f.label}: ${(v as string[]).map((x) => lower(optLabel(f.options, x))).join(', ')}`
    case 'scale':
      return `${f.label} ${String(v)}/${f.max}`
    case 'text':
    case 'date':
      return `${f.label}: ${String(v).trim()}`
    case 'matrix': {
      const cells = v as Record<string, MatrixCell>
      const parts = rowsFor(f.rows, region).filter((r) => cells[r.value]?.value).map((r) => {
        const c = cells[r.value]
        const side = c.side ? ` (${optLabel(MATRIX_SIDES, c.side)})` : ''
        return `${lower(r.label)}${side} ${lower(optLabel(f.columns, c.value))}`
      })
      return parts.length ? `${f.label}: ${parts.join(', ')}` : null
    }
    case 'grades':
    case 'degrees': {
      const cells = v as Record<string, GradeCell>
      const unit = f.kind === 'grades' ? '/5' : '°'
      const parts = rowsFor(f.rows, region).filter((r) => cells[r.value]?.right != null || cells[r.value]?.left != null).map((r) => {
        const c = cells[r.value]
        const name = f.kind === 'degrees' ? degreeLabel(r, region) : r.label
        return `${lower(name)} ${[c.right != null ? `R ${c.right}${unit}` : null, c.left != null ? `L ${c.left}${unit}` : null].filter(Boolean).join(' ')}`
      })
      return parts.length ? `${f.label.replace(/ \(.*\)$/, '')}: ${parts.join(', ')}` : null
    }
    case 'special_tests': {
      const results = v as Record<string, string>
      const parts = (SPECIAL_TESTS[region ?? ''] ?? []).filter((t) => results[t.value]).map((t) => `${t.label} ${lower(optLabel(TEST_RESULTS, results[t.value]))}`)
      return parts.length ? `Special tests: ${parts.join(', ')}` : null
    }
    case 'yesno':
      return null // grouped per field group in sectionText
  }
}

function sectionText(s: FormSection, values: SectionValues, region?: string): string | null {
  const parts: string[] = []
  for (const g of s.groups) {
    const fields = g.fields.filter((f) => isVisible(f, values))
    const yes = fields.filter((f) => f.kind === 'yesno' && values[f.key] === 'yes').map((f) => lower(f.label))
    const no = fields.filter((f) => f.kind === 'yesno' && values[f.key] === 'no' && NO_MATTERS.test(f.label)).map((f) => `not ${lower(f.label)}`)
    if (yes.length || no.length) parts.push(`${g.title ? `${g.title}: ` : ''}${[...yes, ...no].join(', ')}`)
    for (const f of fields) {
      const t = fieldText(f, values[f.key], region)
      if (t) parts.push(t)
    }
  }
  return parts.length ? `${s.title} — ${parts.join('. ')}.` : null
}

/**
 * Draft S/O/A/P text from the answers; `redFlagLine` (built from the API's wording) is added to Subjective.
 * The physio reviews and edits it before signing.
 */
export function soapFromAssessment(values: FormValues, visit: VisitType, redFlagLine?: string): Soap {
  const region = regionOf(values)
  const shown = new Set(sectionsFor(visit).map((s) => s.id))
  const text = (ids: string[]) => ASSESSMENT_SECTIONS.filter((s) => ids.includes(s.id) && shown.has(s.id))
    .map((s) => sectionText(s, values[s.id] ?? {}, region)).filter(Boolean).join('\n')
  return {
    subjective: [text(SOAP_BUCKETS.subjective), redFlagLine].filter(Boolean).join('\n'),
    objective: text(SOAP_BUCKETS.objective),
    assessment: text(SOAP_BUCKETS.assessment),
    plan: text(SOAP_BUCKETS.plan),
  }
}

// ── Care plan from an assessment ────────────────────────────────────────────

// Clinic sessions per week for each treatment frequency; "daily" assumes a six-day clinic week.
const SESSIONS_PER_WEEK: Record<string, number> = { daily: 6, '2x_week': 2, '3x_week': 3, weekly: 1 }
const WEEKS: Record<string, number> = { '1w': 1, '2w': 2, '4w': 4, '6w': 6, '8w_plus': 8 }

export type PlanDraft = {
  condition?: string
  condition_detail?: string
  goal?: string
  stage?: string
  sessions_planned?: number
  ends_on?: string // YYYY-MM-DD
  affected_side?: 'left' | 'right' | 'both'
  surgery_date?: string
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)

/** Care-plan fields suggested by an assessment: goals, sessions and end date from frequency × duration, region and side. */
export function planFromAssessment(values: FormValues, today: Date = new Date()): PlanDraft {
  const field = (section: string, key: string) => ASSESSMENT_SECTIONS.find((s) => s.id === section)?.groups.flatMap((g) => g.fields).find((f) => f.key === key)
  const labels = (section: string, key: string) => {
    const f = field(section, key)
    const picked = values[section]?.[key] as string[] | undefined
    return f && 'options' in f && picked?.length ? picked.map((v) => optLabel(f.options, v)) : []
  }
  const draft: PlanDraft = {}

  const goals = [...labels('goals', 'short_term'), ...labels('goals', 'long_term')]
  if (goals.length) draft.goal = clip(goals.join(', '), 200)

  const impression = (values.clinical?.impression_text as string | undefined)?.trim()
  if (impression) draft.condition = clip(impression, 160)

  const region = regionOf(values)
  const side = values.visit?.side as string | undefined
  const regionLabel = region ? optLabel(BODY_REGIONS, region) : ''
  const sideLabel = side ? optLabel(SIDES, side) : ''
  if (regionLabel && region !== 'multiple_general') draft.condition_detail = [sideLabel, lower(regionLabel)].filter(Boolean).join(' ')
  if (side) draft.affected_side = side === 'bilateral' ? 'both' : (side as 'left' | 'right')

  const weeks = WEEKS[values.treatment?.duration as string]
  const perWeek = SESSIONS_PER_WEEK[values.treatment?.frequency as string]
  if (weeks) {
    const end = new Date(today)
    end.setDate(end.getDate() + weeks * 7)
    draft.ends_on = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    draft.stage = `Week 1 of ${weeks}${values.treatment?.duration === '8w_plus' ? '+' : ''}`
    if (perWeek) draft.sessions_planned = Math.min(200, perWeek * weeks)
  }

  if (values.history?.recent_surgery === 'yes' && values.history.surgery_date) draft.surgery_date = values.history.surgery_date as string
  return draft
}
