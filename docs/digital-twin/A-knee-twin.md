# Design A — Knee twin (slice 1, no camera)

Status: **proposal, for review** · Order: A → [B camera](B-camera-tracking.md) → [C WhatsApp](C-whatsapp-checkins.md)

## Goal

Give each knee-replacement (TKA) patient a patient-specific, continuously updated record of their recovery that
flags problems early and lets the physio change the plan in one tap. No camera and no AI in this slice; both plug
into the same tables later.

It must meet the four digital-twin criteria from Olawade et al. (2026, §2.2):

| Criterion | How slice 1 meets it |
|---|---|
| Patient-specific | Targets, baseline and readings per patient, per side |
| Near-real-time | Daily check-ins; rules run the moment data arrives |
| Predictive | Progress compared with an expected recovery band for the week after surgery |
| Two-way | Flag → suggestion → physio approves → patient's plan updates |

**Out of scope:** camera (B), WhatsApp (C), GenAI explanations, fitted prediction models, joints other than the knee
(the data model supports them; only the knee gets rules and a reference band).

## What exists today (reuse)

- `CarePlan` (condition, goal, stage, dates), `CarePlanExercise` (sets/reps/hold/frequency), `ExerciseLog` (feel, pain 0–10)
- `Consultation` (SOAP text + `pain_vas`), `AuditLog`, `Notification` (in-app only), `PlatformSetting` via `get_setting`
- `services/adherence.py` (scheduled vs done per day, streaks), `components/charts.tsx` on web
- Cron: one daily run on Vercel Hobby (`/cron/daily`, 03:30 UTC)

**Gap:** there are no push notifications, so nothing reminds patients to check in. See "Dependencies".

## Data model (one Alembic migration)

### Changes to `care_plans`
| Column | Type | Note |
|---|---|---|
| `protocol` | str(40) null | `"tka"` enables knee rules + reference band |
| `surgery_date` | date null | Week-since-surgery drives the expected band |
| `affected_side` | enum `left/right/both` null | |

### `care_plan_targets` (new)
`care_plan_id`, `code`, `side`, `target_value`, `by_week` (null = end of plan). Unique on (`care_plan_id`, `code`, `side`).
Example: `knee_flexion`, right, 120, week 8.

### `measurements` (new): the twin's memory
Shaped like a FHIR Observation so we can export later.

| Column | Type | Note |
|---|---|---|
| `patient_id`, `clinic_patient_id`, `care_plan_id?` | FK | |
| `code` | str(40) | From a code registry in `services/twin/codes.py` (below) |
| `side` | enum `left/right/none` | |
| `value` | numeric(6,1) | |
| `unit` | str(10) | `deg`, `score`, `cm` |
| `source` | enum `clinic/self/camera` | `camera` is reserved for B |
| `method` | str(30) | `goniometer`, `tape`, `self_report`, later `camera_v1` |
| `measured_at` | timestamptz | |
| `recorded_by` | FK users null | |
| `consultation_id?` | FK | Links clinic readings to the visit note |
| `confidence?` | numeric(3,2) | For camera readings |
| `trusted` | bool, default true | False = excluded from rules and greyed in charts |
| `note?` | text | |

Index on (`patient_id`, `code`, `measured_at`).

**Code registry (v1):** `knee_flexion` (deg), `knee_extension_lag` (deg), `knee_girth` (cm, swelling), `pain_nprs` (0–10).
Each code carries a valid range (for example knee flexion 0–160°), a unit and a label. LOINC/SNOMED mappings are added
when we build FHIR export, not now.

### `daily_checkins` (new)
One row per patient per day (unique `patient_id`, `day`).

| Field | Type |
|---|---|
| `pain` | 0–10 |
| `stiffness` | 0–10 |
| `swelling` | enum `none/mild/moderate/severe` |
| `sleep` | enum `good/ok/poor` |
| `exercises` | enum `all/some/none` |
| `red_flags` | text[]: `calf_pain`, `fever`, `wound_redness`, `chest_breathless` |
| `note?` | text |
| `source` | enum `app/web/whatsapp` |

Check-ins stay in their own table and are not copied into `measurements`. The twin service combines
measurements, check-ins and exercise logs into one timeline when it reads.

### `twin_flags` (new)
`clinic_patient_id`, `care_plan_id`, `rule`, `severity` (`info/watch/act`), `status` (`open/acknowledged/resolved/dismissed`),
`evidence` JSONB (the exact numbers that triggered it), `dedupe_key`, `opened_at`, `resolved_at`, `resolved_by`,
`explanation?` (reserved for GenAI later). A partial unique index on (`care_plan_id`, `rule`) where `status = 'open'`
means one open flag per rule per plan, which prevents alert fatigue.

### `plan_suggestions` (new)
`care_plan_id`, `flag_id?`, `author` (`rules/physio`, later `ai`), `changes` JSONB (list of
`{plan_exercise_id, field, from, to}`, plus `pause`/`resume`), `rationale`, `status`
(`pending/approved/rejected/expired`), `decided_by`, `decided_at`, `applied_at`.

### `consents` (new)
`patient_id`, `purpose` (`twin_tracking`, later `camera_analysis`, `ai_processing`, `whatsapp`), `version`, `granted_at`,
`withdrawn_at`. Check-ins and twin views require an active `twin_tracking` consent (DPDP Act 2023).

## Expected recovery band

A small reference table in code: for TKA, the expected range of knee flexion for each week after surgery.

> **Must come from a clinical source.** The numbers need to be taken from published TKA rehab literature and signed off
> by a physio before launch. I will not invent them. Until then the band is hidden and rule R4 is off.

We show a **band** (low–high), not a single line, and say "typical range" instead of "prediction".

## Rules v1

These live in `services/twin/rules.py`. Each rule is a pure function from the timeline to a flag or nothing, so
unit-testing is easy. Every threshold is a `PlatformSetting` so a clinical lead can tune it without a deploy.
The defaults below are starting points to be confirmed clinically.

| ID | Rule (default) | Severity | Runs |
|---|---|---|---|
| R1 `pain_rising` | 3-day average pain ≥ previous 7-day average + 2 | watch | on check-in |
| R2 `pain_high` | Pain ≥ 8 on any check-in | act | on check-in |
| R3 `rom_plateau` | Knee flexion changed < 5° across the last 3 trusted readings spanning ≥ 7 days, while below target | watch | on measurement |
| R4 `behind_band` | Latest trusted flexion below this week's typical band | watch | on measurement (off until band is signed off) |
| R5 `rom_drop` | Flexion ≥ 10° below the patient's best trusted reading | act | on measurement |
| R6 `missed_sessions` | 3 scheduled days in a row with nothing done (from `adherence.day_stats`) | watch | daily cron |
| R7 `no_checkin` | No check-in for 3 days | info | daily cron |
| R8 `red_flag` | Any red flag ticked | act | on check-in, **plus instant patient advice** |

**R8 safety path:** if a patient ticks calf pain, fever, wound redness or chest pain/breathlessness, the app immediately
shows fixed text: "Contact your clinic now. If you have chest pain or breathlessness, call 112." It also opens an `act` flag.
This text is written by us, never generated, and doesn't wait for the physio.

**Resolving flags automatically:** a flag closes itself when its condition has been false for 3 days (for example, pain
back to normal). Physios can also acknowledge or dismiss a flag, and dismissing asks for a one-line reason.

## Suggestions and guardrails (the two-way loop)

- Rules may only suggest **holding or reducing** the plan: for example, R1/R2 suggest "reduce sets by 1 on exercises
  logged as *hard*" or "pause progression this week". **Only a physio can author an increase.**
- Physios can approve a suggestion as-is, edit it before approving, or reject it.
- On approval, the server re-checks each change: the exercise is still in the plan, the `from` value still matches
  (otherwise the suggestion becomes `expired`), and rule-authored changes never increase anything. It then applies the
  changes to `CarePlanExercise` in one transaction, writes an `AuditLog` entry, and sends the patient a `plan_updated`
  notification.
- **Untrusted data:** readings outside the code's valid range are rejected (422). A jump of more than 30° from the last
  trusted reading within 48 hours is saved with `trusted = false`, and the physio sees it greyed with "confirm or discard".

## API

**Patient** (`/me`, extends `routers/care.py` or a new `routers/twin.py`)
- `GET /me/twin`: body map (latest trusted value per code and side vs target) plus time series for charts
- `GET /me/checkins/today`, `POST /me/checkins` (upsert for today), `GET /me/checkins?range=week|month`
- `POST /me/consents`, `DELETE /me/consents/{purpose}`

**Clinic** (extends `routers/records.py`)
- `POST /patients/{cp_id}/measurements`, `PATCH /measurements/{id}` (confirm/discard untrusted)
- `GET /patients/{cp_id}/twin`: same shape as the patient view, plus flags and suggestions
- `PUT /care-plans/{plan_id}/targets`
- `GET /flags?status=open`: the clinic's "needs attention" inbox
- `POST /flags/{id}/acknowledge | dismiss`
- `POST /care-plans/{plan_id}/suggestions` (physio-authored), `POST /suggestions/{id}/approve` (optional edited `changes`), `POST /suggestions/{id}/reject`

**Cron:** `/cron/daily` also runs R6/R7 and auto-resolution.

## Screens

**Practice console (web)**
- **Care plan form:** protocol (TKA), surgery date, affected side, targets.
- **Consultation:** a quick "Measurements" row (knee flexion, extension lag, girth, pain) so goniometer readings become structured data during the visit.
- **Patient file → new "Twin" tab:** body map; charts of flexion vs target (with band), pain and stiffness, adherence; open flags with their evidence; pending suggestions shown as a before/after comparison with Approve / Edit / Reject.
- **Dashboard:** a "Needs attention" card with open `act`/`watch` flags across patients.

**Patient (web + mobile)**
- **Home:** a daily check-in card (5 taps, about 30 seconds), with red-flag questions at the end.
- **Progress:** body map plus flexion trend vs target, and pain/stiffness trend.
- **Notification** when the physio updates the plan.
- A first-time consent screen before the first check-in.

## Dependencies and decisions needed from you

1. **A clinical lead** to supply and sign off the TKA reference band and confirm the rule thresholds.
2. **Reminders:** without push notifications, few patients will check in daily. Options: add `expo-notifications`
   (needs an EAS build), or WhatsApp (design C). WhatsApp is probably the better channel in India.
3. **1–2 pilot clinics** with knee-replacement patients.

## Milestones

| # | Deliverable | Size |
|---|---|---|
| A1 ✅ | Migration; measurements + targets; console entry in Consultation and care plan form; "Recovery twin" section on the patient file (body map, cards, trends, readings) | M |
| A2 | Consent + daily check-in (patient web + mobile); R8 safety path | M |
| A3 | Rules engine, flags inbox, dashboard card, cron rules, auto-resolve | M |
| A4 | Suggestions + approve/edit/reject + guardrails + patient notification | M |

Each milestone ships on its own. A1 is useful to physios even if patients never check in.

## Testing

- Rules: table-driven pytest cases, one timeline fixture per rule, covering fire, don't fire and auto-resolve.
- Guardrails: rule-authored increases are rejected; a stale `from` value expires the suggestion; out-of-range values return 422.
- API: patients can only see their own twin; clinics can only see their own patients (same scoping as `records.py`).
