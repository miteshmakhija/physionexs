// MediaPipe Pose, running entirely in the browser. Frames never leave the device; only angles are sent to the API.
// Loaded lazily so the ~9 MB model and WASM only download when someone opens the camera page.
import type { PoseLandmarker } from '@mediapipe/tasks-vision'

// Keep the WASM version in step with @mediapipe/tasks-vision in package.json.
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
export const MODEL_ID = 'mediapipe-pose-full-f16-v1'

export async function createPoseLandmarker(): Promise<{ landmarker: PoseLandmarker; delegate: 'GPU' | 'CPU' }> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
      return { landmarker, delegate }
    } catch (e) {
      if (delegate === 'CPU') throw e // GPU unavailable → retry on CPU; CPU failing is fatal
    }
  }
  throw new Error('unreachable')
}

/** Opens the camera: the back one by default on phones (`environment`); laptops just use their only camera. */
export async function openCamera(video: HTMLVideoElement, facing: 'environment' | 'user' = 'environment'): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
  })
  video.srcObject = stream
  await video.play()
  return stream
}
