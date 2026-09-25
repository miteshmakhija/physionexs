# Physionexs

Physiotherapy platform: patients find and book physios and follow their care plan; clinics run their practice from one console; platform staff administer everything.

| Folder | What | Stack | Deploys to |
|---|---|---|---|
| `backend/` | API | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Postgres (Neon) | Vercel → `api.physionexs.com` |
| `frontend/web/` | Website: patient web (`/app`), practice console (`/clinic`), Super Admin (`/admin`) | React 19, Vite, Tailwind 4, React Router, TanStack Query | Vercel → `physionexs.com` |
| `frontend/mobile/` | One iOS/Android app; screens switch by role (patient / physio & staff) | Expo SDK 57, Expo Router | EAS Build → App Store / Play Store |
| `frontend/shared/` | Design tokens + API types generated from the backend's OpenAPI schema | TypeScript | — |

`Physionexs standalone.html` is the clickable prototype (still branded with the old name, PhysioLekha). Logos live in `brand/`.

## Local development

### Backend

```sh
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt     # macOS/Linux: .venv/bin/pip
cp .env.example .env                                   # fill in DATABASE_URL, DATABASE_URL_DIRECT, JWT_SECRET
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m app.cli seed-settings
.venv/Scripts/python -m app.cli create-admin --name "Your Name" --email you@physionexs.com
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

- API docs: http://localhost:8000/docs (dev only).
- Without MSG91 keys, login OTPs are printed to the API log instead of being sent by SMS.
- Without Razorpay keys, checkout is simulated (orders start with `order_dev_`; the app asks you to confirm a fake payment). This is refused when `ENVIRONMENT=production`.
- Demo data: `python -m app.cli seed-demo` adds 3 verified physios in Pune with weekly hours (password `demo-physio-123`, emails `iap-demo-100X@demo.physionexs.com`); `python -m app.cli purge-demo` removes them.
- Exercise library: `python -m app.cli seed-exercises` loads 42 starter exercises as **in review**. They're draft content written to seed the library — a Physionexs physiotherapist must check each one and publish it from **Super Admin → Exercise library** before clinics can prescribe it. (`--publish` skips review and is refused outside development.)
- Tests: `.venv/Scripts/python -m pytest` (unit). The end-to-end booking tests write to the configured database and clean up afterwards: `PNX_INTEGRATION=1 .venv/Scripts/python -m pytest` — point them at a Neon dev branch, not production.

### Web

```sh
cd frontend/web
npm install
npm run dev          # http://localhost:5173 — /api is proxied to localhost:8000
```

### Mobile

```sh
cd frontend/mobile
npm install
cp .env.example .env   # EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-IP>:8000
npx expo start
```

Run the API with `--host 0.0.0.0` so a phone on the same Wi-Fi can reach it.

### After changing API schemas

```sh
cd backend && .venv/Scripts/python scripts/export_openapi.py
cd ../frontend/web && npm run gen:api     # regenerates frontend/shared/api-types.ts for web + mobile
```

### Database migrations

```sh
cd backend
.venv/Scripts/alembic revision --autogenerate -m "describe change"   # review the generated file!
.venv/Scripts/alembic upgrade head
```

Migrations use `DATABASE_URL_DIRECT` (Neon host without `-pooler`); the app uses the pooled `DATABASE_URL`.

## Deploying to Vercel

Create **two Vercel projects** from this repo:

1. **physionexs-api**: Root Directory `backend`. Framework preset: Other.
   - Environment variables: everything in `backend/.env.example`, with `ENVIRONMENT=production`.
   - Domain: `api.physionexs.com`.
2. **physionexs-web**: Root Directory `frontend/web`. Framework preset: Vite.
   - Domain: `physionexs.com` (+ `www`).
   - `vercel.json` proxies `/api/*` to `api.physionexs.com`, so the login cookie stays first-party.

Run migrations from your machine or CI before deploying backend changes; they are not run on deploy.

The API project pins its functions to Vercel's Singapore region (`sin1`, in `backend/vercel.json`) to sit next to the Neon database in ap-southeast-1 — keep them in the same region or every query pays a cross-region round trip.

### Razorpay

1. Put `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in the API project's environment variables (test keys first).
2. Razorpay Dashboard → Webhooks → add `https://api.physionexs.com/webhooks/razorpay` with events `payment.captured`, `order.paid`, `payment.failed`, and set the same secret as `RAZORPAY_WEBHOOK_SECRET`. The webhook confirms bookings even if the patient closes the app right after paying.
3. Booking money flow: the patient pays the full fee (minus Health Points) to the platform account. `payments.platform_fee_paise` and `payments.meta.payout_paise` record the split per clinic; automatic payouts to clinics (Razorpay Route) are a later step. Cancelled paid bookings are flagged with `meta.refund_required` for now — refund them from the Razorpay dashboard.

## Security notes

- Secrets live only in `.env` files (git-ignored) and Vercel environment variables. Never commit them.
- Physios and Super Admins sign in with a password plus an authenticator app (TOTP). Patients and staff use phone OTP.
- Every clinic-scoped endpoint must use `require_clinic_member()` (`backend/app/core/deps.py`) so clinics can never see each other's data.
- Sensitive actions are written to `audit_logs`.
