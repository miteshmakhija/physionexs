"""Phase 4: billing, analytics, dashboard, clinic profile, subscription, staff/HR, cron.

Opt-in (writes to the configured database, cleans up afterwards):
    PNX_INTEGRATION=1 python -m pytest tests/test_business_flow.py
"""

import os
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

pytestmark = pytest.mark.skipif(os.getenv("PNX_INTEGRATION") != "1", reason="set PNX_INTEGRATION=1 to run")

PATIENT_PHONE = "+919000000951"
STAFF_PHONE = "+919000000952"
WALKIN_PHONE = "+919000000953"


@pytest.fixture(scope="module")
def env():
    from fastapi.testclient import TestClient

    from app.db.session import SessionLocal
    from app.devtools import DEMO_PASSWORD, purge_demo, purge_users, seed_demo
    from app.main import app
    from app.models import User
    from app.services import msg91

    codes: dict[str, str] = {}
    original = msg91.send_otp
    msg91.send_otp = lambda phone, code: codes.__setitem__(phone, code)
    with SessionLocal() as db:
        purge_demo(db)
        seed_demo(db)

    c = TestClient(app)

    pt = c.post("/auth/register/patient", json={"full_name": "Aarav Shah", "email": "aarav-business@demo.physionexs.com", "phone": PATIENT_PHONE, "password": "patient-password-1"}).json()
    doc = c.post("/auth/login", json={"identifier": "iap-demo-1001@demo.physionexs.com", "password": DEMO_PASSWORD}).json()
    clinic_id = doc["user"]["memberships"][0]["clinic_id"]
    h = {"Authorization": f"Bearer {doc['access_token']}", "X-Clinic-Id": clinic_id}
    walkin = c.post("/clinic/patients", headers=h, json={"full_name": "Kavya Rao", "phone": WALKIN_PHONE, "age": 34, "sex": "F"}).json()

    yield {"c": c, "h": h, "clinic_id": clinic_id, "walkin_cp": walkin["id"],
           "patient": {"Authorization": f"Bearer {pt['access_token']}"}, "state": {}}

    msg91.send_otp = original
    with SessionLocal() as db:
        phones = [PATIENT_PHONE, STAFF_PHONE, WALKIN_PHONE]
        purge_users(db, list(db.scalars(select(User.id).where(User.phone.in_(phones)))), phones)
        purge_demo(db)


def test_invoices_numbering_payment_and_void(env):
    c, h = env["c"], env["h"]
    year = datetime.now(UTC).year
    body = {"clinic_patient_id": env["walkin_cp"], "items": [{"description": "Physiotherapy session", "rate_paise": 80_000, "quantity": 2}, {"description": "Kinesio taping", "rate_paise": 30_000}]}
    first = c.post("/clinic/invoices", headers=h, json=body)
    assert first.status_code == 201, first.text
    inv = first.json()
    assert inv["number"] == f"INV-{year}-0001" and inv["total_paise"] == 190_000 and inv["status"] == "due"
    assert inv["clinic"]["name"].startswith("Sunrise") and inv["patient"]["name"] == "Kavya Rao"
    second = c.post("/clinic/invoices", headers=h, json={**body, "paid_via": "cash"}).json()
    assert second["number"] == f"INV-{year}-0002" and second["status"] == "paid"

    page = c.get("/clinic/invoices", headers=h).json()
    assert page["summary"]["outstanding_paise"] == 190_000 and page["summary"]["collected_today_paise"] == 190_000

    paid = c.post(f"/clinic/invoices/{inv['id']}/pay", headers=h, json={"method": "upi"}).json()
    assert paid["status"] == "paid" and paid["paid_via"] == "upi"
    assert c.post(f"/clinic/invoices/{inv['id']}/pay", headers=h, json={"method": "upi"}).status_code == 409
    third = c.post("/clinic/invoices", headers=h, json=body).json()
    assert c.post(f"/clinic/invoices/{third['id']}/void", headers=h).json()["status"] == "void"
    summary = c.get("/clinic/invoices", headers=h).json()["summary"]
    assert summary["collected_today_paise"] == 380_000 and summary["outstanding_paise"] == 0


def test_app_booking_creates_invoice_and_cancel_voids_it(env):
    c, h, p = env["c"], env["h"], env["patient"]
    physio = next(x for x in c.get("/physios", params={"city": "Pune"}).json()["items"] if x["full_name"] == "Dr. Ananya Sharma")
    slots = [s for d in c.get(f"/physios/{physio['id']}/slots").json() for s in d["slots"] if s["available"]]
    booked = c.post("/bookings", headers=p, json={"physio_id": physio["id"], "starts_at": slots[-1]["starts_at"], "mode": "in_clinic"}).json()
    c.post(f"/bookings/{booked['appointment_id']}/verify", headers=p, json={"razorpay_order_id": booked["razorpay"]["order_id"], "razorpay_payment_id": "pay_dev_biz", "razorpay_signature": "dev"})
    app_inv = next(i for i in c.get("/clinic/invoices", headers=h).json()["items"] if i["from_app"])
    assert app_inv["status"] == "paid" and app_inv["total_paise"] == 80_000 and app_inv["patient_name"] == "Aarav Shah"
    assert c.post(f"/clinic/invoices/{app_inv['id']}/void", headers=h).status_code == 409
    mine = c.get("/me/invoices", headers=p).json()
    assert [i["id"] for i in mine] == [app_inv["id"]]
    assert c.get(f"/me/invoices/{app_inv['id']}", headers=p).json()["number"] == app_inv["number"]

    c.post(f"/me/appointments/{booked['appointment_id']}/cancel", headers=p)
    voided = c.get(f"/clinic/invoices/{app_inv['id']}", headers=h).json()
    assert voided["status"] == "void"
    assert c.get("/me/invoices", headers=p).json() == []


def test_analytics_and_dashboard(env):
    c, h = env["c"], env["h"]
    a = c.get("/clinic/analytics", headers=h, params={"days": 7}).json()
    assert len(a["revenue_by_day"]) == 7 and a["revenue_paise"] == 380_000  # the voided booking doesn't count
    assert a["revenue_by_day"][-1]["value"] == 380_000
    d = c.get("/clinic/dashboard", headers=h).json()
    assert d["revenue_week_paise"] == 380_000 and d["subscription"]["plan"] == "commission" and len(d["branches"]) == 1


def test_clinic_profile_and_branches(env):
    c, h = env["c"], env["h"]
    prof = c.get("/clinic/profile", headers=h).json()
    bad = c.put("/clinic/profile", headers=h, json={**prof, "gstin": "123"})
    assert bad.status_code == 422
    big = c.put("/clinic/profile", headers=h, json={**prof, "logo_url": "data:image/png;base64," + "A" * 500_000})
    assert big.status_code == 422
    good = c.put("/clinic/profile", headers=h, json={**prof, "gstin": "27abcde1234f1z5", "address": "Baner Road, Pune", "logo_url": "data:image/png;base64,iVBORw0KGgo="}).json()
    assert good["gstin"] == "27ABCDE1234F1Z5" and good["logo_url"].startswith("data:image/png")

    b = c.get("/clinic/branches", headers=h).json()[0]
    assert c.put(f"/clinic/branches/{b['id']}", headers=h, json={**b, "is_active": False}).status_code == 409
    new = c.post("/clinic/branches", headers=h, json={"name": "Sunrise · Aundh", "area": "Aundh", "city": "Pune", "hours": "Mon–Sat · 9–7", "therapy_rooms": 3})
    assert new.status_code == 201 and len(c.get("/clinic/branches", headers=h).json()) == 2
    closed = c.put(f"/clinic/branches/{new.json()['id']}", headers=h, json={**new.json(), "is_active": False}).json()
    assert closed["is_active"] is False and len(c.get("/clinic/branches", headers=h).json()) == 1


def test_plans_fees_and_switching(env):
    c, h = env["c"], env["h"]
    before = c.get("/clinic/subscription", headers=h).json()
    assert before["plan"] == "commission" and before["price_paise"] == 0
    assert c.post("/clinic/subscription/checkout", headers=h, json={}).status_code == 400  # nothing to pay on pay-per-booking
    assert c.get("/clinic/profile", headers=h).json()["platform_fee_bps"] == 300

    order = c.post("/clinic/subscription/checkout", headers=h, json={"plan": "monthly"}).json()
    assert order["amount"] == 50_000 and order["order_id"].startswith("order_dev_")
    after = c.post("/clinic/subscription/verify", headers=h, json={"razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_dev_sub", "razorpay_signature": "dev"}).json()
    assert after["status"] == "active" and after["plan"] == "monthly" and after["current_period_end"]
    assert c.get("/clinic/profile", headers=h).json()["platform_fee_bps"] == 0  # no booking fee on a subscription
    assert c.post("/clinic/subscription/checkout", headers=h, json={"plan": "yearly"}).json()["amount"] == 500_000

    back = c.post("/clinic/subscription/commission", headers=h).json()
    assert back["plan"] == "commission" and back["price_paise"] == 0 and back["current_period_end"] is None
    assert c.get("/clinic/profile", headers=h).json()["platform_fee_bps"] == 300


def test_new_clinic_plan_sets_booking_fee(env):
    c = env["c"]
    base = {"full_name": "Dr. Plan Test", "password": "plan-password-1", "registration_no": "IAP-DEMO-PLAN", "council": "IAP",
            "qualification": "BPT", "clinic_name": "Plan Clinic", "city": "Pune"}
    r = c.post("/auth/register/physio", json={**base, "email": "plan-commission@demo.physionexs.com", "phone": "+919000000954", "plan": "commission"}).json()
    ph = {"Authorization": f"Bearer {r['access_token']}", "X-Clinic-Id": r["user"]["memberships"][0]["clinic_id"]}
    assert c.get("/clinic/profile", headers=ph).json()["platform_fee_bps"] == 300
    sub = c.get("/clinic/subscription", headers=ph).json()
    assert sub["plan"] == "commission" and sub["status"] == "active" and sub["due_soon"] is False
    r2 = c.post("/auth/register/physio", json={**base, "email": "plan-monthly@demo.physionexs.com", "phone": "+919000000955", "plan": "monthly",
                                               "registration_no": "IAP-DEMO-PLAN2"}).json()
    ph2 = {"Authorization": f"Bearer {r2['access_token']}", "X-Clinic-Id": r2["user"]["memberships"][0]["clinic_id"]}
    assert c.get("/clinic/profile", headers=ph2).json()["platform_fee_bps"] == 0
    assert c.get("/clinic/subscription", headers=ph2).json()["status"] == "trial"


def test_staff_attendance_leave_and_payroll(env):
    c, h = env["c"], env["h"]
    patient_email = {"full_name": "Aarav", "email": "aarav-business@demo.physionexs.com", "password": "staff-password-1"}
    assert c.post("/clinic/staff", headers=h, json=patient_email).status_code == 409  # patient email
    added = c.post("/clinic/staff", headers=h, json={"full_name": "Riya Desai", "email": "riya-staff@demo.physionexs.com", "password": "staff-password-1",
                                                      "phone": STAFF_PHONE, "job_title": "Receptionist", "department": "Front desk", "monthly_salary_paise": 3_000_000})
    assert added.status_code == 201, added.text
    member_id = added.json()["id"]

    # Staff sign in with email; phone codes are off.
    assert c.post("/auth/otp/request", json={"phone": STAFF_PHONE, "intent": "staff"}).status_code == 403
    staff = c.post("/auth/login", json={"identifier": "riya-staff@demo.physionexs.com", "password": "staff-password-1", "intent": "clinic"}).json()
    assert staff["user"]["role"] == "staff" and staff["user"]["memberships"][0]["role"] == "staff"
    sh = {"Authorization": f"Bearer {staff['access_token']}", "X-Clinic-Id": env["clinic_id"]}
    assert c.get("/clinic/invoices", headers=sh).status_code == 403
    assert c.get("/clinic/dashboard", headers=sh).json()["revenue_week_paise"] is None
    assert c.post("/clinic/attendance/check-in", headers=sh).json()["today"] == "present"
    assert c.post("/clinic/attendance/check-in", headers=sh).status_code == 409

    # Leave on a future Monday–Tuesday: 2 working days, unpaid.
    d = date.today() + timedelta(days=(7 - date.today().weekday()) + 7)
    lr = c.post("/clinic/leave", headers=sh, json={"leave_type": "unpaid", "from_date": d.isoformat(), "to_date": (d + timedelta(days=1)).isoformat(), "reason": "Family function"}).json()
    assert lr["days"] == 2 and lr["status"] == "pending"
    assert c.post(f"/clinic/leave/{lr['id']}/approve", headers=sh).status_code == 403
    assert c.post(f"/clinic/leave/{lr['id']}/approve", headers=h).json()["status"] == "approved"
    att = c.get("/clinic/attendance", headers=h, params={"day": d.isoformat()}).json()
    assert next(r for r in att["rows"] if r["id"] == member_id)["today"] == "on_leave"

    month = d.strftime("%Y-%m")
    preview = next(r for r in c.get("/clinic/payroll", headers=h, params={"month": month}).json()["rows"] if r["member_id"] == member_id)
    assert preview["id"] is None and preview["unpaid_days"] == 2 and preview["deductions_paise"] > 0
    run = c.post("/clinic/payroll/run", headers=h, params={"month": month}).json()
    slip = next(r for r in run["rows"] if r["member_id"] == member_id)
    assert slip["id"] and slip["status"] == "pending" and slip["net_paise"] == slip["gross_paise"] - slip["deductions_paise"]
    paid = c.post(f"/clinic/payroll/{slip['id']}/pay", headers=h).json()
    assert paid["status"] == "paid"
    rerun = c.post("/clinic/payroll/run", headers=h, params={"month": month}).json()
    assert next(r for r in rerun["rows"] if r["member_id"] == member_id)["status"] == "paid"  # paid slips are left alone


def test_cron_jobs(env):
    from app.db.session import SessionLocal
    from app.models import Clinic, Subscription
    from app.models.clinic import SubscriptionStatus
    from app.routers import cron

    c = env["c"]
    assert c.get("/cron/daily").status_code == 401
    cron.settings.cron_secret = "test-secret"
    auth = {"Authorization": "Bearer test-secret"}
    try:
        with SessionLocal() as db:
            sub = db.scalar(select(Subscription).where(Subscription.clinic_id == env["clinic_id"]))
            sub.current_period_end = datetime.now(UTC) - timedelta(days=1)
            sub.status = SubscriptionStatus.ACTIVE
            db.commit()
        r = c.get("/cron/daily", headers=auth).json()
        assert r["overdue"] >= 1
        with SessionLocal() as db:
            assert db.scalar(select(Subscription.status).where(Subscription.clinic_id == env["clinic_id"])) == SubscriptionStatus.OVERDUE
            assert db.get(Clinic, env["clinic_id"]) is not None
        assert c.get("/cron/hourly", headers=auth).status_code == 200
    finally:
        cron.settings.cron_secret = None
