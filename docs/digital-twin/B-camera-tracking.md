# Design B — Camera tracking

Status: **proposal, for review** · Builds on [A — Knee twin](A-knee-twin.md)

## Goal

Measure joint angles, count reps and check basic form from a phone camera. The video never leaves the device. Camera
numbers are **not shown to patients or used in rules until they've been validated** against a goniometer.

## Two stages

1. **B1 — Clinic validation tool.** Physios use the camera alongside a goniometer during visits. Each use records a
   paired reading. This proves (or disproves) accuracy on real patients and gives physios something useful right away.
2. **B2 — Patient home tracking.** Once accuracy is accepted, patients use it at home. The web version comes first
   (same code as B1), then the mobile app.

## Technology

### Pose model
**MediaPipe Pose Landmarker** (Google, open source): 33 body landmarks per frame, with both image coordinates and
approximate 3D "world" coordinates, and a visibility score per landmark. It comes in lite, full and heavy sizes.
We start with *full* and fall back to *lite* on slow phones.

### Where it runs

| Option | Pros | Cons |
|---|---|---|
| **Web (MediaPipe Tasks for JavaScript)** | No app release; the same code serves the console (B1) and patient web | Slower than native on low-end Android; browser camera quirks |
| **Mobile native** (`react-native-vision-camera` + a TFLite pose model via a frame-processor plugin) | Fastest, smoothest | Needs an EAS build (not Expo Go); more code; plugin maturity to verify |
| **Mobile via WebView** running the web code | Reuses B1 code in the app | WebView camera permissions and performance to verify on iOS/Android |

**Plan:** build for web first (B0/B1). For mobile, a short spike compares native with WebView, measured on real devices,
and we pick whichever passes the performance bar below.

**Performance bar:** at least 15 frames per second of pose tracking on a typical ₹10–15k Android phone. We test on at
least one such device and one iPhone before committing.

## How an angle is measured

Knee flexion is the angle at the knee between the thigh (hip→knee) and the shin (knee→ankle): 0° is straight,
larger is more bent.

1. Take the hip, knee and ankle landmarks for the plan's affected side.
2. **Quality gate for each frame:** skip frames where any of the three landmarks has visibility < 0.6, where the body
   isn't fully in frame, or where the phone is moving. The share of frames that pass becomes the session's `confidence`.
3. Compute the angle in 2D from a **side-on** view (most reliable with one camera). We also log the 3D-world-coordinate
   angle during B1 to see whether it does better.
4. Smooth it with a One Euro filter, which cuts jitter without much lag.
5. **Rep detection:** a simple state machine with hysteresis. A rep starts when the angle rises above the "start"
   threshold and counts when it passes the "peak" threshold and returns. We record each rep's peak.
6. **Session result:** the median of the top 3 rep peaks, not the single best frame. One lucky or glitchy frame
   shouldn't set the number.

## Exercise tracking spec

Add a `tracking` JSONB column to `exercises` so each exercise in the library says what to measure:

```json
{
  "joint": "knee", "angle": "flexion", "view": "side", "posture": "supine",
  "rep": { "start_above": 20, "peak_above": 45 },
  "metrics": ["peak_flexion", "reps"],
  "form_checks": ["hip_lifts"],
  "setup": ["Phone at bed height, 2 m away, side-on", "Wear shorts", "Whole leg in view"]
}
```

**First exercises (knee):** heel slide (flexion), seated knee extension (extension lag), straight-leg raise
(form check: the knee stays straight while the hip lifts). Shoulder flexion comes after the knee is proven.

**Known risk:** heel slides are done lying down, and pose models are trained mostly on upright people. Accuracy lying
down may be worse. B0 tests this first. If it fails, we use a seated knee-bend variant for measurement.

## Data flow

1. The patient (or physio) finishes a set. The app sends
   `POST /me/exercise-sessions` with `{plan_exercise_id, reps, rep_peaks[], result_deg, confidence, model, app_version, device}`.
   **No frames or video are sent.**
2. The server writes an `ExerciseLog` (completion, so adherence and streaks keep working) and a `Measurement` with
   `source=camera`, `method=camera_v1`, and the confidence.
3. **Before validation is accepted:** camera measurements are saved with `trusted = false`, so rules ignore them, and
   they're shown only to the physio, labelled "camera estimate".
4. **After:** they become `trusted` when confidence ≥ threshold. Clinic goniometer readings still take priority on the same day.

## B1 — Clinic validation mode

- In the console, open the Patient file → Twin → **Measure with camera**. It uses the laptop or tablet webcam, or a phone
  signed in to the console.
- At the peak, the physio also takes a goniometer reading and types it in. The app saves a **validation pair**
  (new table `validation_pairs`: camera measurement, goniometer value, physio, exercise, posture, notes on lighting and clothing).
- **Analysis:** a Bland–Altman plot (average difference between the two methods, and the range that 95% of differences
  fall within). Split by exercise and posture.
- **Acceptance rule:** agreed with the clinical lead **before** collecting data. For example, "95% of differences
  within ±X°" (X to be set clinically). Target sample: about 100 pairs from 20+ patients across 2+ clinics.
- **If it fails:** camera results stay physio-only as a rough guide, and we try other exercises, postures or model sizes.

## B2 — Patient experience at home

- **Setup screen:** a picture showing where to put the phone. A live outline turns green when the whole leg is visible.
- **During the exercise:** a rep counter and a live angle arc, with a marker at the **physio's target**. Feedback only
  ever says "good" or "a little more, *up to your target*". It never encourages going past the target.
- **Stop button**, and "Hurts? Stop now" is always visible. If pressed, it logs pain and ends the session.
- **No voice coaching in v1** (the paper warns that wrong live guidance can cause harm).
- A "Not recording" indicator stays on the screen the whole time.

## Privacy and regulation

- Frames are processed in memory and dropped. Nothing is recorded or uploaded.
- A separate `camera_analysis` consent is required before first use.
- **Regulation:** once the software measures range of motion that feeds treatment decisions, it may count as a software
  medical device under India's CDSCO rules. **Get a health-tech lawyer's view before B2 goes live.**

## Milestones

| # | Deliverable | Size |
|---|---|---|
| B0 | Spike: one exercise (heel slide + seated variant) in the browser; measure speed on low-end Android + iPhone; check lying-down accuracy informally | S |
| B1 | Clinic validation mode, `validation_pairs`, Bland–Altman export | M |
| B2a | Patient web tracking behind a per-clinic feature flag | M |
| B2b | Mobile (native or WebView, whichever wins the spike) + EAS build | M–L |

## Decisions needed from you

1. The acceptance rule (±X°) and who signs it off.
2. Which clinic(s) will collect validation pairs.
3. The legal review before B2.
