// Joint-angle maths for camera measurement (design: docs/digital-twin/B-camera-tracking.md).
// Pure functions only: no camera, no model, so everything here is unit-tested (angles.test.ts).

export interface Pt {
  x: number
  y: number
  z?: number
  visibility?: number
}

export type Side = 'left' | 'right'

// MediaPipe Pose landmark indices; "left"/"right" are the patient's own sides.
export const LEG: Record<Side, { hip: number; knee: number; ankle: number }> = {
  left: { hip: 23, knee: 25, ankle: 27 },
  right: { hip: 24, knee: 26, ankle: 28 },
}

const deg = (rad: number) => (rad * 180) / Math.PI

function flexionFrom(v1: [number, number, number], v2: [number, number, number]): number | null {
  const n1 = Math.hypot(...v1)
  const n2 = Math.hypot(...v2)
  if (n1 === 0 || n2 === 0) return null
  const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2)))
  return 180 - deg(Math.acos(cos)) // 0° = straight leg, larger = more bent
}

/**
 * Knee flexion from a side-on view, in the image plane. Landmarks are normalised (0–1) per axis, so they're scaled
 * to pixels first; otherwise a 16:9 frame would distort the angle.
 */
export function kneeFlexion2D(hip: Pt, knee: Pt, ankle: Pt, width: number, height: number): number | null {
  return flexionFrom(
    [(hip.x - knee.x) * width, (hip.y - knee.y) * height, 0],
    [(ankle.x - knee.x) * width, (ankle.y - knee.y) * height, 0],
  )
}

/** Same angle from MediaPipe's 3D "world" landmarks (metres). Logged alongside 2D during validation to compare. */
export function kneeFlexion3D(hip: Pt, knee: Pt, ankle: Pt): number | null {
  return flexionFrom(
    [hip.x - knee.x, hip.y - knee.y, (hip.z ?? 0) - (knee.z ?? 0)],
    [ankle.x - knee.x, ankle.y - knee.y, (ankle.z ?? 0) - (knee.z ?? 0)],
  )
}

export type FrameProblem = 'no_person' | 'not_visible' | 'out_of_frame'

/** Per-frame quality gate: the leg's three landmarks must be confidently visible and inside the frame. */
export function frameQuality(landmarks: Pt[] | undefined, side: Side, minVisibility = 0.6, margin = 0.02): FrameProblem | null {
  if (!landmarks?.length) return 'no_person'
  const pts = Object.values(LEG[side]).map((i) => landmarks[i])
  if (pts.some((p) => !p || (p.visibility ?? 0) < minVisibility)) return 'not_visible'
  if (pts.some((p) => p.x < margin || p.x > 1 - margin || p.y < margin || p.y > 1 - margin)) return 'out_of_frame'
  return null
}

/**
 * One Euro filter (Casiez et al., 2012): smooths jitter when the joint is still, follows quickly when it moves.
 * `t` is in seconds.
 */
export class OneEuroFilter {
  private x: number | null = null
  private dx = 0
  private t: number | null = null
  private readonly minCutoff: number
  private readonly beta: number
  private readonly dCutoff: number

  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, t: number): number {
    if (this.x === null || this.t === null || t <= this.t) {
      this.x = value
      this.t = t
      return value
    }
    const dt = t - this.t
    const dxRaw = (value - this.x) / dt
    this.dx += OneEuroFilter.alpha(this.dCutoff, dt) * (dxRaw - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += OneEuroFilter.alpha(cutoff, dt) * (value - this.x)
    this.t = t
    return this.x
  }

  reset() {
    this.x = null
    this.t = null
    this.dx = 0
  }
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Capture {
  value: number // median angle over the window, degrees
  value3d: number | null
  confidence: number // share of frames in the window that passed the quality gate
  frames: number // frames that passed
  spread: number // max − min of passing angles; large = the patient wasn't holding still
}

/**
 * Rolling window of recent frames. The physio asks the patient to hold at the end of the movement, reads the
 * goniometer, and captures: the result is the median of the last `windowMs` of good frames.
 */
export class CaptureWindow {
  private frames: { t: number; angle: number | null; angle3d: number | null }[] = []
  private readonly keepMs: number

  constructor(keepMs = 3000) {
    this.keepMs = keepMs
  }

  push(tMs: number, angle: number | null, angle3d: number | null = null) {
    this.frames.push({ t: tMs, angle, angle3d })
    while (this.frames.length && this.frames[0].t < tMs - this.keepMs) this.frames.shift()
  }

  result(nowMs: number, windowMs = 1000, minFrames = 5): Capture | null {
    const recent = this.frames.filter((f) => f.t >= nowMs - windowMs)
    const good = recent.filter((f) => f.angle !== null) as { t: number; angle: number; angle3d: number | null }[]
    if (good.length < minFrames) return null
    const angles = good.map((f) => f.angle)
    const a3 = good.map((f) => f.angle3d).filter((v): v is number => v !== null)
    return {
      value: Math.round(median(angles) * 10) / 10,
      value3d: a3.length ? Math.round(median(a3) * 10) / 10 : null,
      confidence: Math.round((good.length / recent.length) * 100) / 100,
      frames: good.length,
      spread: Math.round((Math.max(...angles) - Math.min(...angles)) * 10) / 10,
    }
  }

  clear() {
    this.frames = []
  }
}

/** Bland–Altman agreement between camera and goniometer: mean difference (bias) and 95% limits of agreement. */
export function blandAltman(pairs: { camera: number; reference: number }[]) {
  const n = pairs.length
  if (n < 2) return null
  const diffs = pairs.map((p) => p.camera - p.reference)
  const bias = diffs.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(diffs.reduce((a, d) => a + (d - bias) ** 2, 0) / (n - 1))
  return { n, bias, sd, lower: bias - 1.96 * sd, upper: bias + 1.96 * sd }
}
