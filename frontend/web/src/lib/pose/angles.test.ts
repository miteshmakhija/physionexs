import { describe, expect, it } from 'vitest'

import { CaptureWindow, LEG, OneEuroFilter, blandAltman, frameQuality, kneeFlexion2D, kneeFlexion3D, median, type Pt } from './angles'

describe('kneeFlexion2D', () => {
  it('is 0° for a straight leg and 90° for a right angle', () => {
    expect(kneeFlexion2D({ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.8 }, 100, 100)).toBeCloseTo(0)
    expect(kneeFlexion2D({ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.8 }, 100, 100)).toBeCloseTo(90)
  })

  it('corrects for the frame aspect ratio', () => {
    // A thigh at 45° in a 1600×900 frame: 180 px left and 180 px up, i.e. different normalised offsets per axis.
    const hip = { x: 0.5 - 180 / 1600, y: 0.5 - 180 / 900 }
    expect(kneeFlexion2D(hip, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.8 }, 1600, 900)).toBeCloseTo(45)
    expect(kneeFlexion2D(hip, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.8 }, 1, 1)).not.toBeCloseTo(45) // unscaled would be wrong
  })

  it('handles a 45° bend and degenerate input', () => {
    const r = Math.SQRT1_2
    expect(kneeFlexion2D({ x: 0.5 - r * 0.3, y: 0.5 - r * 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.8 }, 100, 100)).toBeCloseTo(45)
    expect(kneeFlexion2D({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.8 }, 100, 100)).toBeNull()
  })
})

describe('kneeFlexion3D', () => {
  it('uses depth', () => {
    expect(kneeFlexion3D({ x: 0, y: -0.4, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0.4 })).toBeCloseTo(90)
  })
})

describe('frameQuality', () => {
  const body = (vis: number, x = 0.5): Pt[] => Array.from({ length: 33 }, () => ({ x, y: 0.5, visibility: vis }))
  it('passes a visible, in-frame leg', () => expect(frameQuality(body(0.9), 'right')).toBeNull())
  it('flags missing person, low visibility and edge of frame', () => {
    expect(frameQuality(undefined, 'left')).toBe('no_person')
    expect(frameQuality(body(0.3), 'left')).toBe('not_visible')
    expect(frameQuality(body(0.9, 0.99), 'left')).toBe('out_of_frame')
  })
  it('only checks the chosen leg', () => {
    const b = body(0.9)
    b[LEG.left.knee] = { x: 0.5, y: 0.5, visibility: 0.1 }
    expect(frameQuality(b, 'right')).toBeNull()
    expect(frameQuality(b, 'left')).toBe('not_visible')
  })
})

describe('OneEuroFilter', () => {
  it('reduces jitter on a still joint', () => {
    const f = new OneEuroFilter()
    const noisy = Array.from({ length: 60 }, (_, i) => 90 + (i % 2 ? 3 : -3))
    const out = noisy.map((v, i) => f.filter(v, i / 30))
    const tail = out.slice(30)
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(3)
  })
})

describe('CaptureWindow', () => {
  it('takes the median of the last second of good frames, with confidence and spread', () => {
    const w = new CaptureWindow()
    for (let i = 0; i < 30; i++) w.push(i * 33, i % 10 === 0 ? null : 100 + (i % 3), 102)
    const c = w.result(29 * 33)!
    expect(c.value).toBe(101)
    expect(c.value3d).toBe(102)
    expect(c.confidence).toBeGreaterThan(0.85)
    expect(c.spread).toBe(2)
  })
  it('needs enough good frames', () => {
    const w = new CaptureWindow()
    for (let i = 0; i < 30; i++) w.push(i * 33, i < 27 ? null : 90)
    expect(w.result(29 * 33)).toBeNull()
  })
})

describe('median and blandAltman', () => {
  it('computes median', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
  })
  it('computes bias and limits of agreement', () => {
    const r = blandAltman([{ camera: 92, reference: 90 }, { camera: 84, reference: 85 }, { camera: 101, reference: 98 }, { camera: 70, reference: 70 }])!
    expect(r.n).toBe(4)
    expect(r.bias).toBeCloseTo(1)
    expect(r.sd).toBeCloseTo(1.826, 2)
    expect(r.upper - r.lower).toBeCloseTo(2 * 1.96 * r.sd)
    expect(blandAltman([{ camera: 1, reference: 1 }])).toBeNull()
  })
})
