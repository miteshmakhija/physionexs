# Design C — WhatsApp check-ins

Status: **proposal, for review** · Feeds the same `daily_checkins` table as [A — Knee twin](A-knee-twin.md)

## Why

The twin is only as good as its daily data. Patients in India reply on WhatsApp far more readily than they open an
app, and the app currently has no push notifications to remind them. WhatsApp could be both the reminder and the check-in.

## The flow

1. **Morning message (a pre-approved template, "utility" category):**
   "Good morning Asha, time for your 30-second knee check-in." with buttons **Start** / **Skip today**.
2. Tapping **Start** opens WhatsApp's 24-hour reply window, so we can send interactive messages:
   - **Pain today (0–10):** a list message, or "reply with a number". *The list-message row limit needs checking*,
     since 11 options may exceed it; typed numbers are the fallback.
   - **Stiffness:** buttons None / Some / A lot (WhatsApp allows at most 3 reply buttons).
   - **Exercises yesterday:** All / Some / None.
   - **Safety check:** "Any new calf pain, fever, wound redness, or chest pain/breathlessness?" Yes / No.
3. **"Yes" to the safety check:** we immediately send the same fixed advice as the app ("Contact your clinic now…
   call 112") and open an `act` flag for the physio.
4. **Done:** "Thanks! Your physio can see today's update." The answers are saved as a `daily_checkins` row with
   `source = whatsapp`, and rules run exactly as for app check-ins.
5. **Optional second template:** "Your physio updated your exercise plan. Open Physionexs to see it." This fills the
   plan-update loop from design A.

**Messages never include the diagnosis or other health details**, only the patient's first name. Health data stays in our system.

## WhatsApp Business rules that shape this

- Messages we start must use **templates approved by Meta**. Free-form and interactive messages are only allowed within
  24 hours of the patient's last message.
- The patient must **opt in** to WhatsApp messages, and "STOP" must opt them out.
- It needs a **dedicated phone number** (not one on regular WhatsApp), Meta Business verification and an approved display name.
- **Pricing** is charged per message by category. **Check Meta's current India rate card and the provider's markup.**
  I haven't put numbers here because they change.
- If many people block or report us, Meta lowers our number's quality rating and limits sending, so we keep messages
  useful and let patients choose to skip.

## Provider

We already use MSG91 for OTPs. **Check whether our MSG91 account can add the WhatsApp Business API**, and compare it
with one alternative provider on price, template approval speed and webhook quality. Staying with MSG91 means one vendor and one bill.

## Backend

- **New `routers/webhooks.py` route** `POST /webhooks/whatsapp` (next to Razorpay's). It verifies the provider's
  signature and handles incoming replies and delivery statuses.
- **`services/whatsapp.py`:** send a template, send an interactive message. Like `msg91.py`, it logs instead of sending in local dev.
- **`whatsapp_sessions` table:** `patient_id`, `day`, `step`, `answers` JSONB, `expires_at` (24 hours), so a
  half-finished check-in can resume.
- **`whatsapp_messages` table:** message id, direction, template, status, timestamps, for audit and debugging. **No health content stored here.**
- **Patient settings:** `checkin_channel` (`app/whatsapp/both`); opt-in is stored as a `consents` row with purpose `whatsapp`.
- **Scheduling:** Vercel Hobby runs each cron once a day. **v1 sends everyone's reminder at one fixed time**
  (for example 8:00 IST = 02:30 UTC). Letting each patient pick a time needs hourly crons (Vercel Pro) or an external scheduler.
- **Idempotency:** one morning message per patient per day, guarded by a unique (`patient_id`, `day`) key on sessions.

## Pilot

- **1 clinic, about 20 knee patients, 4 weeks.** Half get app-only check-ins and half WhatsApp, or everyone gets both
  and we compare which channel they use.
- **Measure:** check-in completion rate, drop-off per step, opt-out rate, cost per completed check-in, and physio feedback on flags.
- **Go/no-go:** decide the success threshold before starting (for example, WhatsApp completion clearly higher than
  the app at an acceptable cost per check-in).

## Privacy (DPDP Act 2023)

- The consent text must say that replies pass through Meta and our provider.
- Keep messages free of health detail and store the minimum (answers go into `daily_checkins`; logs hold metadata only).
- Opt-out works from both WhatsApp ("STOP") and the app.

## Milestones

| # | Deliverable | Size |
|---|---|---|
| C0 | Provider choice, Meta Business verification, number, 2 templates submitted | S (mostly waiting on approvals) |
| C1 ✅ | Webhook, session state machine, daily send, safety path, opt-in/out. Built against the WhatsApp Cloud API (Meta) with a swappable adapter; switched off until keys are set | M |
| C2 | Pilot + readout | 4 weeks of running |

**Start C0 early:** Meta verification and template approval can take days to weeks, so it can run alongside A.

## Decisions needed from you

1. Stay with MSG91 for WhatsApp or evaluate another provider.
2. The pilot clinic, and whether one fixed morning time is acceptable for v1.
3. The budget ceiling per patient per month for messages.

## What C1 built (2026-09-29)

- **Opt-in** on the patient home (web + mobile), under today's check-in: its own versioned consent (`whatsapp`), shown
  only when WhatsApp is switched on and the patient has a mobile number. Reply STOP to turn off, START to turn back on.
- **Morning invite** from the daily cron (09:00 IST): the `daily_checkin` template with the first name only, once per
  patient per day, skipped if they've already checked in.
- **Conversation** (`services/whatsapp_flow.py`, pure and unit-tested): pain and stiffness as typed numbers 0–10
  (11 options don't fit a list), swelling as a list, sleep and exercises as buttons, then the warning-sign question;
  "Yes" opens a list of the four red flags (short titles ≤ 24 chars, full wording as the description).
- **Saving** goes through the same code as app check-ins (`services/checkin_submit.py`): `source = whatsapp`, physio
  alert, flag rules, and the same fixed red-flag advice with the clinic's number.
- **Webhook** `/webhooks/whatsapp`: Meta's verify handshake (GET) and signed messages (POST, `X-Hub-Signature-256`).
  State is saved before replying; retries are ignored by message id. The message log holds no content.

**Provider.** MSG91's WhatsApp API reference wasn't publicly readable, so C1 talks to Meta's WhatsApp Cloud API
directly (`services/whatsapp_provider.py`). Using MSG91 instead means adding an adapter with the same two functions
(`send`, `parse_webhook`) once we have their API reference from the MSG91 account.

## Switching it on

1. Meta Business verification; a WhatsApp Business phone number (not one on regular WhatsApp); display name approved.
2. Create and get approval for a **utility** template named `daily_checkin`, language `en`:
   body "Good morning {{1}}, time for your 30-second knee check-in." with quick-reply buttons **Start** (payload
   `start`) and **Skip today** (payload `skip`).
3. In the Meta app, subscribe the webhook to `messages` at `https://physionexs-api.vercel.app/webhooks/whatsapp`
   with a verify token of your choice.
4. Set on the API project in Vercel: `WHATSAPP_PROVIDER=meta`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; redeploy.
5. Legal review of the WhatsApp consent text (`services/checkins.py`), then pilot with one clinic (C2).
