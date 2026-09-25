"""End-to-end booking flow against a real Postgres database.

Opt-in because it writes to the configured database (all rows are removed afterwards):
    PNX_INTEGRATION=1 python -m pytest tests/test_booking_flow.py
"""

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

pytestmark = pytest.mark.skipif(os.getenv("PNX_INTEGRATION") != "1", reason="set PNX_INTEGRATION=1 to run")

PATIENT_PHONE = "+919000000901"
PHYSIO_PHONE = "+919000000902"
ADMIN_EMAIL = "admin@demo.physionexs.com"


@pytest.fixture(scope="module")
def env():
    from fastapi.testclient import TestClient

    from app.core.security import hash_password
    from app.db.session import SessionLocal
    from app.devtools import DEMO_PASSWORD, purge_demo, purge_users, seed_demo
    from app.main import app
    from app.models import User
    from app.models.user import UserRole
    from app.services import msg91

    codes: dict[str, str] = {}
    original = msg91.send_otp
    msg91.send_otp = lambda phone, code: codes.__setitem__(phone, code)

    with SessionLocal() as db:
        purge_demo(db)
        seed_demo(db)
        db.add(User(full_name="Demo Admin", email=ADMIN_EMAIL, password_hash=hash_password("demo-admin-123"), role=UserRole.SUPER_ADMIN))
        db.commit()

    client = TestClient(app)
    client.post("/auth/otp/request", json={"phone": PATIENT_PHONE})
    patient = client.post("/auth/otp/verify", json={"phone": PATIENT_PHONE, "code": codes[PATIENT_PHONE], "full_name": "Aarav Shah"}).json()
    physio = client.post("/auth/login", json={"identifier": "iap-demo-1001@demo.physionexs.com", "password": DEMO_PASSWORD}).json()
    admin = client.post("/auth/login", json={"identifier": ADMIN_EMAIL, "password": "demo-admin-123"}).json()

    yield {
        "client": client,
        "patient": {"Authorization": f"Bearer {patient['access_token']}"},
        "physio": {"Authorization": f"Bearer {physio['access_token']}", "X-Clinic-Id": physio["user"]["memberships"][0]["clinic_id"]},
        "admin": {"Authorization": f"Bearer {admin['access_token']}"},
        "patient_id": patient["user"]["patient_id"],
    }

    msg91.send_otp = original
    with SessionLocal() as db:
        extra = list(db.scalars(select(User.id).where(User.phone.in_([PATIENT_PHONE, PHYSIO_PHONE]))))
        purge_users(db, extra, [PATIENT_PHONE, PHYSIO_PHONE])
        purge_demo(db)


def _ananya(c):
    return next(p for p in c.get("/physios", params={"city": "pune"}).json()["items"] if p["full_name"] == "Dr. Ananya Sharma")


def _free_slots(c, physio_id, n=3):
    days = c.get(f"/physios/{physio_id}/slots", params={"days": 7}).json()
    free = [s for d in days for s in d["slots"] if s["available"]]
    assert len(free) >= n
    return free


def test_directory_search(env):
    c = env["client"]
    page = c.get("/physios", params={"city": "Pune"}).json()
    assert page["total"] == 3
    assert all(p["next_slot_at"] for p in page["items"])

    knee = c.get("/physios", params={"q": "knee"}).json()["items"]
    assert [p["full_name"] for p in knee] == ["Dr. Ananya Sharma"]

    online = {p["full_name"] for p in c.get("/physios", params={"city": "Pune", "mode": "online"}).json()["items"]}
    assert "Dr. Rohan Mehta" not in online

    near_kothrud = c.get("/physios", params={"lat": 18.507, "lng": 73.807, "radius_km": 25}).json()["items"]
    assert near_kothrud[0]["full_name"] == "Dr. Priya Nair"
    assert near_kothrud[0]["distance_km"] < 1

    detail = c.get(f"/physios/{knee[0]['id']}").json()
    assert detail["languages"] and detail["branches"][0]["city"] == "Pune"


def test_book_pay_and_clinic_sees_it(env):
    c = env["client"]
    physio = _ananya(c)
    slot = _free_slots(c, physio["id"])[0]

    r = c.post("/bookings", headers=env["patient"], json={"physio_id": physio["id"], "starts_at": slot["starts_at"], "mode": "in_clinic", "referral_source": "search"})
    assert r.status_code == 201, r.text
    checkout = r.json()
    assert checkout["status"] == "pending" and checkout["amount_paise"] == 80_000
    assert checkout["razorpay"]["order_id"].startswith("order_dev_")

    # Same slot again is refused while the hold is live.
    again = c.post("/bookings", headers=env["patient"], json={"physio_id": physio["id"], "starts_at": slot["starts_at"], "mode": "in_clinic"})
    assert again.status_code == 409

    bad = c.post(f"/bookings/{checkout['appointment_id']}/verify", headers=env["patient"], json={"razorpay_order_id": checkout["razorpay"]["order_id"], "razorpay_payment_id": "pay_x", "razorpay_signature": "forged"})
    assert bad.status_code == 400

    ok = c.post(f"/bookings/{checkout['appointment_id']}/verify", headers=env["patient"], json={"razorpay_order_id": checkout["razorpay"]["order_id"], "razorpay_payment_id": "pay_dev_1", "razorpay_signature": "dev"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "confirmed" and ok.json()["paid"]

    upcoming = c.get("/me/appointments", headers=env["patient"]).json()
    assert [a["id"] for a in upcoming] == [checkout["appointment_id"]]

    day = datetime.fromisoformat(slot["starts_at"]).astimezone(__import__("zoneinfo").ZoneInfo("Asia/Kolkata")).date().isoformat()
    schedule = c.get("/clinic/appointments", headers=env["physio"], params={"day": day}).json()
    assert any(a["id"] == checkout["appointment_id"] and a["patient_name"] == "Aarav Shah" for a in schedule)

    moved = c.patch(f"/clinic/appointments/{checkout['appointment_id']}", headers=env["physio"], json={"status": "checked_in"})
    assert moved.status_code == 200 and moved.json()["status"] == "checked_in"
    backwards = c.patch(f"/clinic/appointments/{checkout['appointment_id']}", headers=env["physio"], json={"status": "confirmed"})
    assert backwards.status_code == 400


def test_points_cover_full_fee(env):
    from app.db.session import SessionLocal
    from app.models import Patient

    with SessionLocal() as db:
        db.get(Patient, env["patient_id"]).points_balance = 1_000
        db.commit()
    c = env["client"]
    physio = _ananya(c)
    slot = _free_slots(c, physio["id"])[1]
    r = c.post("/bookings", headers=env["patient"], json={"physio_id": physio["id"], "starts_at": slot["starts_at"], "mode": "online", "redeem_points": True}).json()
    assert r["status"] == "confirmed" and r["amount_paise"] == 0 and r["points_redeemed"] == 600 and r["razorpay"] is None
    assert c.get("/me/points", headers=env["patient"]).json()["balance"] == 400


def test_expired_hold_frees_slot(env):
    from app.db.session import SessionLocal
    from app.models import Appointment

    c = env["client"]
    physio = _ananya(c)
    slot = _free_slots(c, physio["id"])[2]
    first = c.post("/bookings", headers=env["patient"], json={"physio_id": physio["id"], "starts_at": slot["starts_at"], "mode": "in_clinic"}).json()
    with SessionLocal() as db:
        db.get(Appointment, first["appointment_id"]).hold_expires_at = datetime.now(UTC) - timedelta(minutes=1)
        db.commit()
    second = c.post("/bookings", headers=env["patient"], json={"physio_id": physio["id"], "starts_at": slot["starts_at"], "mode": "in_clinic"})
    assert second.status_code == 201, second.text


def test_physio_hours_and_admin_verification(env):
    c = env["client"]
    # A new physio registers → pending → not in the directory until approved.
    reg = c.post("/auth/register/physio", json={"full_name": "Dr. Test Pending", "email": "pending@demo.physionexs.com", "phone": PHYSIO_PHONE, "password": "supersecret1", "registration_no": "IAP-DEMO-9999", "clinic_name": "Pending Clinic", "city": "Nagpur"}).json()
    h = {"Authorization": f"Bearer {reg['access_token']}", "X-Clinic-Id": reg["user"]["memberships"][0]["clinic_id"]}

    prof = c.put("/clinic/physio-profile", headers=h, json={"qualification": "BPT", "offers_in_clinic": True, "fee_in_clinic_paise": 50_000, "specializations": ["Knee"]})
    assert prof.status_code == 200, prof.text
    branch_id = c.get("/clinic/branches", headers=h).json()[0]["id"]
    overlap = c.put("/clinic/availability", headers=h, json={"items": [
        {"branch_id": branch_id, "weekday": 0, "start_time": "09:00", "end_time": "12:00"},
        {"branch_id": branch_id, "weekday": 0, "start_time": "11:00", "end_time": "13:00"},
    ]})
    assert overlap.status_code == 422
    hours = c.put("/clinic/availability", headers=h, json={"items": [{"branch_id": branch_id, "weekday": d, "start_time": "09:00", "end_time": "12:00"} for d in range(7)]})
    assert hours.status_code == 200 and len(hours.json()) == 7

    assert c.get("/physios", params={"city": "Nagpur"}).json()["total"] == 0
    pending = c.get("/admin/verifications", headers=env["admin"]).json()
    assert any(p["registration_no"] == "IAP-DEMO-9999" for p in pending)
    assert c.get("/admin/verifications", headers=env["patient"]).status_code == 403

    approved = c.post(f"/admin/verifications/{reg['user']['id']}/approve", headers=env["admin"]).json()
    assert approved["status"] == "approved"
    assert c.get("/physios", params={"city": "Nagpur"}).json()["total"] == 1

    # Another clinic's id is refused.
    other = {**h, "X-Clinic-Id": env["physio"]["X-Clinic-Id"]}
    assert c.get("/clinic/branches", headers=other).status_code == 403


def test_patient_cancel_restores_points_and_lists_in_past(env):
    from app.db.session import SessionLocal
    from app.models import Payment

    c = env["client"]
    physio = _ananya(c)
    slot = _free_slots(c, physio["id"], n=6)[-1]  # latest free slot, well outside the 4-hour cut-off
    before = c.get("/me/points", headers=env["patient"]).json()["balance"]
    booked = c.post("/bookings", headers=env["patient"], json={"physio_id": physio["id"], "starts_at": slot["starts_at"], "mode": "in_clinic", "redeem_points": True}).json()
    if booked["razorpay"]:
        c.post(f"/bookings/{booked['appointment_id']}/verify", headers=env["patient"], json={"razorpay_order_id": booked["razorpay"]["order_id"], "razorpay_payment_id": "pay_dev_cancel", "razorpay_signature": "dev"})
    assert c.get("/me/points", headers=env["patient"]).json()["balance"] == before - booked["points_redeemed"]

    cancelled = c.post(f"/me/appointments/{booked['appointment_id']}/cancel", headers=env["patient"])
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert c.get("/me/points", headers=env["patient"]).json()["balance"] == before
    past = c.get("/me/appointments", headers=env["patient"], params={"scope": "past"}).json()
    assert booked["appointment_id"] in [a["id"] for a in past]
    assert c.post(f"/me/appointments/{booked['appointment_id']}/cancel", headers=env["patient"]).status_code == 400

    with SessionLocal() as db:
        payment = db.scalar(select(Payment).where(Payment.razorpay_payment_id == "pay_dev_cancel"))
        if payment:  # paid part is flagged for refund
            assert payment.meta.get("refund_required") is True

    # the slot is bookable again
    assert any(s["starts_at"] == slot["starts_at"] and s["available"] for d in c.get(f"/physios/{physio['id']}/slots").json() for s in d["slots"])
