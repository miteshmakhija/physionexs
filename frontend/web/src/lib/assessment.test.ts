import { describe, expect, it } from 'vitest'

import {
  ASSESSMENT_SECTIONS,
  conditionsWithHistory,
  historyFromConditions,
  planFromAssessment,
  progressOf,
  sectionsFor,
  soapFromAssessment,
} from '@shared/assessment'

describe('structured assessment', () => {
  it('has unique field keys within each section', () => {
    for (const s of ASSESSMENT_SECTIONS) {
      const keys = s.groups.flatMap((g) => g.fields.map((f) => f.key))
      expect(new Set(keys).size, s.id).toBe(keys.length)
    }
  })

  it('shows a short form for follow-ups', () => {
    expect(sectionsFor('follow_up').map((s) => s.id)).toEqual(['complaints', 'rom', 'strength', 'outcomes', 'treatment', 'final'])
    expect(sectionsFor('initial')).toHaveLength(ASSESSMENT_SECTIONS.length)
  })

  it('counts only visible fields', () => {
    const complaints = ASSESSMENT_SECTIONS.find((s) => s.id === 'complaints')!
    expect(progressOf(complaints, { pain: 'no' })).toEqual({ total: 2, answered: 1 })
    expect(progressOf(complaints, { pain: 'yes', pain_intensity: 6 }).total).toBe(9)
  })

  it('pre-fills history from background conditions and adds new ones back', () => {
    expect(historyFromConditions(['Type 2 diabetes', 'HTN'])).toEqual({ diabetes: 'yes', hypertension: 'yes' })
    expect(conditionsWithHistory({ diabetes: 'yes', osteoporosis: 'yes', arthritis: 'no' }, ['Type 2 diabetes'])).toEqual(['Type 2 diabetes', 'Osteoporosis'])
  })

  it('suggests a care plan from goals, frequency × duration, region and side', () => {
    const draft = planFromAssessment({
      visit: { body_region: 'knee', side: 'bilateral' },
      history: { recent_surgery: 'yes', surgery_date: '2026-10-20' },
      clinical: { impression_text: '  Post-op bilateral TKA  ' },
      goals: { short_term: ['reduce_pain', 'improve_rom'], long_term: ['independent_walking'] },
      treatment: { frequency: '3x_week', duration: '6w' },
    }, new Date(2026, 10, 13))
    expect(draft).toEqual({
      goal: 'Reduce pain, Improve ROM, Independent walking',
      condition: 'Post-op bilateral TKA',
      condition_detail: 'Bilateral knee',
      affected_side: 'both',
      ends_on: '2026-12-25',
      stage: 'Week 1 of 6',
      sessions_planned: 18,
      surgery_date: '2026-10-20',
    })
    expect(planFromAssessment({ treatment: { frequency: 'as_required', duration: '8w_plus' } }, new Date(2026, 0, 1)))
      .toEqual({ ends_on: '2026-02-26', stage: 'Week 1 of 8+' })
  })

  it('writes knee extension degrees as extension lag', () => {
    const soap = soapFromAssessment({ visit: { body_region: 'knee' }, rom: { degrees: { flexion: { right: 95 }, extension: { right: 8 } } } }, 'initial')
    expect(soap.objective).toContain('Measured range: flexion R 95°, extension lag R 8°')
  })

  it('drafts S/O/A/P from the answers', () => {
    const soap = soapFromAssessment({
      visit: { body_region: 'knee', onset: 'post_trauma' },
      complaints: { complaints: ['pain', 'swelling'], pain: 'yes', pain_intensity: 6 },
      rom: { rom: { flexion: { value: 'restricted', side: 'right' } } },
      strength: { mrc: { extension: { right: 3, left: 5 } } },
      special_tests: { tests: { lachman: 'positive', mcmurray: '' } },
      gait: { independent_walking: 'no', limp: 'yes' },
      clinical: { impression: ['sports_injury'] },
      treatment: { frequency: '3x_week' },
    }, 'initial', 'Red-flag screening: no red flags identified.')
    expect(soap.subjective).toContain('Onset: post-trauma')
    expect(soap.subjective).toContain('Pain intensity (NPRS) 6/10')
    expect(soap.subjective).toMatch(/no red flags identified\.$/)
    expect(soap.objective).toContain('flexion (R) restricted')
    expect(soap.objective).toContain('extension R 3/5 L 5/5')
    expect(soap.objective).toContain('Special tests: Lachman positive')
    expect(soap.objective).not.toContain('McMurray')
    expect(soap.objective).toContain('Gait — limp, not independent walking.')
    expect(soap.assessment).toContain('sports injury')
    expect(soap.plan).toContain('3× / week')
  })
})
