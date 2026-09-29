import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { Alert, Button, Field, Input, Loader, Select, cx } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { isStaleBuildError, reloadForNewBuild } from '@/lib/staleBuild'
import {
  CaptureWindow, LEG, OneEuroFilter, frameQuality, jointsVisible, kneeFlexion2D, kneeFlexion3D, otherSideClearer,
  type Capture, type FrameProblem, type Joint, type Pt, type Side,
} from '@/lib/pose/angles'
import { MODEL_ID, createPoseLandmarker, openCamera } from '@/lib/pose/tracker'

const MEASURES = [
  { code: 'knee_flexion', label: 'Knee flexion (bend)', hold: 'Ask the patient to bend as far as comfortable and hold.' },
  { code: 'knee_extension_lag', label: 'Extension lag (short of straight)', hold: 'Ask the patient to straighten as far as they can and hold.' },
] as const
const POSTURES = [
  { value: 'supine', label: 'Lying on back (heel slide)' },
  { value: 'seated', label: 'Sitting' },
  { value: 'standing', label: 'Standing' },
] as const
const PROBLEM: Record<FrameProblem, string> = {
  no_person: 'No one in view',
  not_visible: 'Hip, knee or ankle not clearly visible',
  out_of_frame: 'Leg is at the edge of the frame',
}
const STEADY_SPREAD = 5 // degrees; a wider spread means the patient wasn't holding still

type Setup = { code: (typeof MEASURES)[number]['code']; side: Side; posture: (typeof POSTURES)[number]['value']; consented: boolean }

export default function CameraMeasure() {
  const { id } = useParams()
  const { clinicId, isOwner, role } = useClinic()
  const file = useQuery({ queryKey: ['patient-file', id], queryFn: () => api<Schemas['PatientFileOut']>(`/clinic/patients/${id}`, { clinicId }) })
  if (file.isLoading) return <Loader />
  if (!file.data) return <Alert>Patient not found.</Alert>
  if (!(isOwner || role === 'physio')) return <Alert>Only physiotherapists can take measurements.</Alert>
  return <Measure patient={file.data} clinicId={clinicId} />
}

function Measure({ patient, clinicId }: { patient: Schemas['PatientFileOut']; clinicId: string }) {
  const [setup, setSetup] = useState<Setup>({
    code: 'knee_flexion', side: patient.active_plan?.affected_side === 'left' ? 'left' : 'right', posture: 'supine', consented: false,
  })
  const [started, setStarted] = useState(false)

  return (
    <div className="max-w-5xl">
      <Link to={`/clinic/patients/${patient.id}`} className="eyebrow hover:underline">← {patient.full_name}</Link>
      <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Measure with camera</h1>
      <p className="text-[13.5px] text-muted">
        Validation mode: take a goniometer reading at the same moment. Camera readings are saved as estimates and aren’t used clinically until
        camera accuracy has been validated. <Link to="/clinic/validation" className="underline">Validation results →</Link>
      </p>
      <p className="mt-3 inline-block rounded-sm bg-leaf-tint px-3 py-1.5 text-[12.5px] font-medium text-leaf-dark">
        Video stays on this device. Nothing is recorded or uploaded — only the angle numbers.
      </p>
      {!started ? <SetupForm setup={setup} onChange={setSetup} onStart={() => setStarted(true)} /> : (
        <Live setup={setup} patient={patient} clinicId={clinicId} onSide={(side) => setSetup({ ...setup, side })} onStop={() => setStarted(false)} />
      )}
    </div>
  )
}

function SetupForm({ setup, onChange, onStart }: { setup: Setup; onChange: (s: Setup) => void; onStart: () => void }) {
  return (
    <form className="mt-6 grid max-w-2xl gap-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); onStart() }}>
      <Field label="Measure">
        <Select value={setup.code} onChange={(e) => onChange({ ...setup, code: e.target.value as Setup['code'] })}>
          {MEASURES.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
        </Select>
      </Field>
      <Field label="Side">
        <Select value={setup.side} onChange={(e) => onChange({ ...setup, side: e.target.value as Side })}>
          <option value="right">Right</option>
          <option value="left">Left</option>
        </Select>
      </Field>
      <Field label="Position">
        <Select value={setup.posture} onChange={(e) => onChange({ ...setup, posture: e.target.value as Setup['posture'] })}>
          {POSTURES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
      </Field>
      <div className="text-[13.5px] text-ink-2 sm:col-span-3">
        <p className="font-semibold">Set-up</p>
        <ul className="mt-1 list-disc pl-5 text-muted">
          <li>Camera side-on to the {setup.side} leg, at knee height, about 2 m away.</li>
          <li>Whole leg in view: hip, knee and ankle. Shorts or fitted clothing; good, even light.</li>
          <li>Steady the phone or laptop — don’t hand-hold it. Auto-capture takes the reading once the leg is held still, so nobody needs to reach the screen.</li>
        </ul>
      </div>
      <label className="flex items-start gap-2 text-[13.5px] sm:col-span-3">
        <input type="checkbox" checked={setup.consented} onChange={(e) => onChange({ ...setup, consented: e.target.checked })} className="mt-1 accent-ink" required />
        <span>The patient has agreed to be measured with the camera. I’ve told them the video isn’t recorded or uploaded.</span>
      </label>
      <div className="sm:col-span-3"><Button type="submit" disabled={!setup.consented}>Start camera</Button></div>
    </form>
  )
}

const JOINTS = [['hip', 'Hip'], ['knee', 'Knee'], ['ankle', 'Ankle']] as const
type LiveView = { angle: number | null; problem: FrameProblem | null; joints: Record<Joint, boolean>; otherSide: boolean; hold: number; fps: number }
const EMPTY: LiveView = { angle: null, problem: 'no_person', joints: { hip: false, knee: false, ankle: false }, otherSide: false, hold: 0, fps: 0 }

/** A short beep (and a buzz on phones) so the physio knows a hands-free capture happened without looking. */
function beep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.value = 0.15
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
    osc.onended = () => void ctx.close()
  } catch { /* no audio: the on-screen tick still shows */ }
  navigator.vibrate?.(120)
}

function Live({ setup, patient, clinicId, onSide, onStop }: {
  setup: Setup; patient: Schemas['PatientFileOut']; clinicId: string; onSide: (side: Side) => void; onStop: () => void
}) {
  const qc = useQueryClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const windowRef = useRef(new CaptureWindow())
  const filterRef = useRef(new OneEuroFilter())
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const sideRef = useRef(setup.side)
  const autoRef = useRef(true)
  const armedRef = useRef(true) // one hands-free capture at a time: re-armed once it's saved or discarded
  const liveRef = useRef<LiveView>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<LiveView>(EMPTY)
  const [delegate, setDelegate] = useState<string>('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [auto, setAuto] = useState(true)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [form, setForm] = useState({ goniometer: '', lighting: 'good', clothing: 'shorts', note: '' })
  const [saved, setSaved] = useState<Schemas['CameraMeasurementOut'][]>([])
  const measure = MEASURES.find((m) => m.code === setup.code)!

  // Switching leg keeps the camera and model running; only the readings start afresh.
  useEffect(() => {
    sideRef.current = setup.side
    windowRef.current.clear()
    filterRef.current.reset()
  }, [setup.side])
  useEffect(() => { autoRef.current = auto }, [auto])
  useEffect(() => { armedRef.current = capture === null }, [capture])

  // The camera (restarted when switching between the front and back cameras).
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    openCamera(videoRef.current!, facing).then((s) => {
      if (cancelled) s.getTracks().forEach((t) => t.stop())
      else stream = s
    }, (e) => fail(e))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing])

  // The pose model and the per-frame loop.
  useEffect(() => {
    let raf = 0
    let cancelled = false
    const frameTimes: number[] = []
    let lastVideoTime = -1

    const draw = (lms: Pt[] | undefined, problem: FrameProblem | null, angle: number | null) => {
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (!lms?.length) return
      const L = LEG[sideRef.current]
      const pts = [lms[L.hip], lms[L.knee], lms[L.ankle]].map((p) => [p.x * canvas.width, p.y * canvas.height] as const)
      const colour = problem ? '#A7A7A9' : '#33A532'
      ctx.lineWidth = Math.max(4, canvas.width / 200)
      ctx.strokeStyle = colour
      ctx.beginPath()
      ctx.moveTo(...pts[0])
      ctx.lineTo(...pts[1])
      ctx.lineTo(...pts[2])
      ctx.stroke()
      ctx.fillStyle = colour
      for (const [x, y] of pts) {
        ctx.beginPath()
        ctx.arc(x, y, ctx.lineWidth * 1.6, 0, Math.PI * 2)
        ctx.fill()
      }
      if (angle !== null) {
        ctx.font = `bold ${Math.round(canvas.width / 22)}px sans-serif`
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = '#141414'
        ctx.lineWidth = 4
        const label = `${Math.round(angle)}°`
        ctx.strokeText(label, pts[1][0] + 20, pts[1][1] - 20)
        ctx.fillText(label, pts[1][0] + 20, pts[1][1] - 20)
      }
    }

    const tick = () => {
      const video = videoRef.current
      const landmarker = landmarkerRef.current
      if (cancelled || !video || !landmarker) return
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime
        const now = performance.now()
        const side = sideRef.current
        const res = landmarker.detectForVideo(video, now)
        const lms = res.landmarks[0] as Pt[] | undefined
        const world = res.worldLandmarks[0] as Pt[] | undefined
        const problem = frameQuality(lms, side)
        let angle: number | null = null
        let angle3d: number | null = null
        if (!problem && lms) {
          const L = LEG[side]
          const raw = kneeFlexion2D(lms[L.hip], lms[L.knee], lms[L.ankle], video.videoWidth, video.videoHeight)
          angle = raw === null ? null : filterRef.current.filter(raw, now / 1000)
          if (world) angle3d = kneeFlexion3D(world[L.hip], world[L.knee], world[L.ankle])
        }
        windowRef.current.push(now, angle, angle3d)
        frameTimes.push(now)
        while (frameTimes.length && frameTimes[0] < now - 1000) frameTimes.shift()
        liveRef.current = {
          angle, problem, joints: jointsVisible(lms, side), otherSide: otherSideClearer(lms, side),
          hold: windowRef.current.steadyProgress(now), fps: frameTimes.length,
        }
        draw(lms, problem, angle)
      }
      raf = requestAnimationFrame(tick)
    }

    createPoseLandmarker().then((made) => {
      if (cancelled) return made.landmarker.close()
      landmarkerRef.current = made.landmarker
      setDelegate(made.delegate)
      setStatus('live')
      raf = requestAnimationFrame(tick)
    }, (e) => fail(e))

    const ui = window.setInterval(() => {
      const v = liveRef.current
      setView({ ...v })
      // Hands-free: once the leg has been held steady long enough, capture it.
      if (autoRef.current && armedRef.current && v.hold >= 1) {
        const c = windowRef.current.result(performance.now())
        if (c) {
          armedRef.current = false
          setCaptureError(null)
          setCapture(c)
          beep()
        }
      }
    }, 150)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearInterval(ui)
      landmarkerRef.current?.close()
      landmarkerRef.current = null
    }
  }, [])

  function fail(e: unknown) {
    if (isStaleBuildError(e) && reloadForNewBuild()) return // the site was updated since this tab opened
    setStatus('error')
    setError(e instanceof DOMException && e.name === 'NotAllowedError'
      ? 'Camera permission was blocked. Allow camera access for this site and try again.'
      : `Couldn’t start camera measurement: ${(e as Error).message}`)
  }

  const doCapture = () => {
    const c = windowRef.current.result(performance.now())
    setCaptureError(c ? null : 'Not enough clear frames in the last second. Keep the whole leg in view, hold still, then capture again.')
    setCapture(c)
  }

  const save = useMutation({
    mutationFn: () => api<Schemas['CameraMeasurementOut']>(`/clinic/patients/${patient.id}/camera-measurements`, {
      method: 'POST', clinicId,
      json: {
        code: setup.code, side: setup.side, posture: setup.posture, camera_value: capture!.value, camera_value_3d: capture!.value3d,
        confidence: capture!.confidence, frames: capture!.frames, spread: capture!.spread, fps: view.fps, model: MODEL_ID,
        goniometer_value: Number(form.goniometer), lighting: form.lighting, clothing: form.clothing, note: form.note.trim() || null, patient_consented: true,
      },
    }),
    onSuccess: (r) => {
      setSaved([r, ...saved])
      setCapture(null)
      setForm({ ...form, goniometer: '', note: '' })
      void qc.invalidateQueries({ queryKey: ['twin', patient.id] })
      void qc.invalidateQueries({ queryKey: ['validation'] })
    },
  })

  const other: Side = setup.side === 'right' ? 'left' : 'right'
  const tracking = status === 'live' && !view.problem
  const guidance = view.problem === 'no_person' ? 'Point the camera at the patient, side-on, about 2 m away'
    : view.problem === 'out_of_frame' ? 'Move the camera back: the leg is at the edge of the picture'
      : view.problem === 'not_visible' ? `Show the whole ${setup.side} leg, from hip to ankle`
        : capture ? 'Captured ✓' : auto && view.hold > 0.15 ? 'Hold still…' : measure.hold

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="relative overflow-hidden rounded-md bg-ink">
          <video ref={videoRef} playsInline muted className="block h-auto w-full" />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          {status === 'loading' && <p className="absolute inset-0 flex items-center justify-center text-[14px] text-white">Loading pose model (first time ~9 MB)…</p>}
          {status === 'live' && (
            <>
              {/* Large enough to read from where the patient is. */}
              <div className="absolute left-3 top-3 flex gap-1.5">
                {JOINTS.map(([k, label]) => (
                  <span key={k} className={cx('rounded-sm px-2.5 py-1 text-[14px] font-bold text-white', view.joints[k] ? 'bg-leaf' : 'bg-black/60')}>
                    {view.joints[k] ? '✓' : '✗'} {label}
                  </span>
                ))}
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-black/60 px-4 py-3 text-white">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[16px] font-semibold sm:text-[20px]">{guidance}</p>
                  {view.angle !== null && <p className="text-[28px] font-extrabold tabular-nums sm:text-[36px]">{Math.round(view.angle)}°</p>}
                </div>
                {auto && tracking && !capture && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/25" aria-hidden>
                    <div className="h-full bg-leaf transition-[width] duration-150" style={{ width: `${Math.round(view.hold * 100)}%` }} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
          <span>{status === 'live' && `${view.fps} frames/s · ${delegate} · ${MODEL_ID}`}</span>
          <button type="button" className="underline" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}>Switch camera (front/back)</button>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="border border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">{setup.side === 'right' ? 'Right' : 'Left'} · {measure.label}</p>
            <button type="button" className="text-[12px] underline" onClick={() => onSide(other)}>Measure {other} leg</button>
          </div>
          <p className="mt-1 text-[44px] font-extrabold leading-none tabular-nums">{view.angle !== null ? `${Math.round(view.angle)}°` : '—'}</p>
          <p className={cx('mt-2 text-[13px]', view.problem ? 'text-amber' : 'text-leaf-dark')}>{view.problem ? PROBLEM[view.problem] : 'Tracking the leg'}</p>
          {view.otherSide && (
            <div className="mt-2">
              <Alert tone="warning">
                The {other} leg is clearly in view, not the {setup.side}.{' '}
                <button type="button" className="font-semibold underline" onClick={() => onSide(other)}>Measure the {other} leg</button>, or turn the patient round.
              </Alert>
            </div>
          )}
          <label className="mt-3 flex items-start gap-2 text-[13px]">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-0.5 accent-ink" />
            <span><b>Auto-capture</b> when the leg is held still for 1.5 s (beeps). No need to reach the screen.</span>
          </label>
          <p className="mt-2 text-[13px] text-muted">{measure.hold} Read the goniometer at the same moment.</p>
          <Button className="mt-3 w-full" onClick={doCapture} disabled={!tracking}>
            {status !== 'live' ? 'Starting camera…' : tracking ? 'Capture now' : 'Waiting for hip, knee and ankle…'}
          </Button>
          {captureError && <div className="mt-2"><Alert tone="warning">{captureError}</Alert></div>}
        </div>

        {capture && (
          <form className="space-y-3 border border-ink p-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
            <p className="text-[14px]">Camera: <b className="text-[18px]">{capture.value}°</b> <span className="text-muted">· {Math.round(capture.confidence * 100)}% clear frames</span></p>
            {capture.spread > STEADY_SPREAD && <Alert tone="warning">Angle moved {capture.spread}° during capture — the patient may not have been holding still. Consider capturing again.</Alert>}
            <Field label="Goniometer reading (°)">
              <Input type="number" step="1" min={0} max={160} value={form.goniometer} onChange={(e) => setForm({ ...form, goniometer: e.target.value })} required autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Light">
                <Select value={form.lighting} onChange={(e) => setForm({ ...form, lighting: e.target.value })}>
                  <option value="good">Good</option><option value="mixed">Mixed</option><option value="dim">Dim</option>
                </Select>
              </Field>
              <Field label="Clothing">
                <Select value={form.clothing} onChange={(e) => setForm({ ...form, clothing: e.target.value })}>
                  <option value="shorts">Shorts</option><option value="fitted">Fitted</option><option value="loose">Loose</option>
                </Select>
              </Field>
            </div>
            <Field label="Note (optional)"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. brace on, camera slightly high" /></Field>
            {save.error && <Alert>{(save.error as Error).message}</Alert>}
            <div className="flex gap-2">
              <Button type="submit" loading={save.isPending}>Save pair</Button>
              <Button type="button" variant="ghost" onClick={() => setCapture(null)}>Discard</Button>
            </div>
          </form>
        )}

        {saved.length > 0 && (
          <div className="border border-line p-4 text-[13.5px]">
            <p className="eyebrow mb-2">Saved this session</p>
            <ul className="space-y-1 tabular-nums">
              {saved.map((r) => (
                <li key={r.camera.id}>Camera {r.camera.value}° · goniometer {r.goniometer.value}° · <b>{r.difference > 0 ? '+' : ''}{r.difference}°</b></li>
              ))}
            </ul>
          </div>
        )}
        <Button variant="secondary" className="w-full" onClick={onStop}>Stop camera</Button>
      </aside>
    </div>
  )
}
