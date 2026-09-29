"""Phase 5: reviews, Super Admin dashboard/analytics/subscriptions/settings/records/audit, 2FA guard.

Opt-in (writes to the configured database, cleans up afterwards):
    PNX_INTEGRATION=1 python -m pytest tests/test_admin_flow.py
"""

import os

import pytest
from sqlalchemy import select

pytestmark = pytest.mark.skipif(os.getenv("PNX_INTEGRATION") != "1", reason="set PNX_INTEGRATION=1 to run")

PATIENT_PHONE = "+919000000971"
ADMIN_EMAIL = "admin@demo.physionexs.com"


@pytest.fixture(scope="module")
def env():
    from fastapi.testclient import TestClient

    from app.core.security import hash_password
    from app.db.session import SessionLocal
    from app.devtools import DEMO_PASSWORD, purge_demo, purge_users, seed_demo
    from app.main import app
    from app.models import PlatformSetting, User
    from app.models.user import UserRole
    from app.services import msg91

    codes: dict[str, str] = {}
    original = msg91.send_otp
    msg91.send_otp = lambda phone, code: codes.__setitem__(phone, code)
    with SessionLocal() as db:
        purge_demo(db)
        seed_demo(db)
        db.add(User(full_name="Demo Admin", email=ADMIN_EMAIL, password_hash=hash_password("demo-admin-123"), role=UserRole.SUPER_ADMIN))
        saved = {k: (row.value if (row := db.get(PlatformSetting, k)) else None) for k in ("support", "rewards", "pms_pricing", "platform_fee")}
        db.commit()

    c = TestClient(app)
    pt = c.post("/auth/register/patient", json={"full_name": "Aarav Shah", "email": "aarav-admin@demo.physionexs.com", "phone": PATIENT_PHONE, "password": "patient-password-1"}).json()
    doc = c.post("/auth/login", json={"identifier": "iap-demo-1001@demo.physionexs.com", "password": DEMO_PASSWORD}).json()
    admin = c.post("/auth/login", json={"identifier": ADMIN_EMAIL, "password": "demo-admin-123"}).json()
    yield {
        "c": c,
        "patient": {"Authorization": f"Bearer {pt['access_token']}"},
        "patient_refresh": pt["refresh_token"],
        "patient_user_id": pt["user"]["id"],
        "doc": {"Authorization": f"Bearer {doc['access_token']}", "X-Clinic-Id": doc["user"]["memberships"][0]["clinic_id"]},
        "physio_id": doc["user"]["id"],
        "admin": {"Authorization": f"Bearer {admin['access_token']}"},
        "admin_id": admin["user"]["id"],
        "state": {},
    }

    msg91.send_otp = original
    with SessionLocal() as db:
        for key, value in saved.items():  # restore real platform settings
            row = db.get(PlatformSetting, key)
            if value is None and row:
                db.delete(row)
            elif value is not None:
                row.value = value
                row.updated_by = None
        db.commit()
        purge_users(db, list(db.scalars(select(User.id).where(User.phone == PATIENT_PHONE))), [PATIENT_PHONE])
        purge_demo(db)


def test_patient_reviews_completed_visit(env):
    c, p, h = env["c"], env["patient"], env["doc"]
    slots = [s for d in c.get(f"/physios/{env['physio_id']}/slots").json() for s in d["slots"] if s["available"]]
    b = c.post("/bookings", headers=p, json={"physio_id": env["physio_id"], "starts_at": slots[0]["starts_at"], "mode": "in_clinic"}).json()
    c.post(f"/bookings/{b['appointment_id']}/verify", headers=p, json={"razorpay_order_id": b["razorpay"]["order_id"], "razorpay_payment_id": "pay_dev_adm", "razorpay_signature": "dev"})
    appt = b["appointment_id"]
    env["state"]["appt"] = appt

    early = c.post(f"/me/appointments/{appt}/review", headers=p, json={"rating": 5})
    assert early.status_code == 400
    assert c.patch(f"/clinic/appointments/{appt}", headers=h, json={"status": "completed"}).status_code == 200
    r = c.post(f"/me/appointments/{appt}/review", headers=p, json={"rating": 4, "tags": ["On time", "made-up tag"], "comment": "  Very helpful  "})
    assert r.status_code == 200, r.text
    assert r.json()["review"] == {"rating": 4, "tags": ["On time"], "comment": "Very helpful"}
    assert c.post(f"/me/appointments/{appt}/review", headers=p, json={"rating": 1}).status_code == 409
    profile = c.get(f"/physios/{env['physio_id']}").json()
    assert profile["rating_avg"] == 4.0 and profile["reviews_count"] == 1 and profile["reviews"][0]["patient_name"] == "Aarav S."


def test_dashboard_and_analytics(env):
    c, a = env["c"], env["admin"]
    d = c.get("/admin/dashboard", headers=a).json()
    assert d["bookings"] >= 1 and d["patients"] >= 1 and d["physios"] >= 3 and d["reviews"] >= 1
    rev = d["revenue"]
    # Sunrise is on "pay per booking" (3%): ₹800 booking → ₹24 fee, ₹776 to the clinic.
    assert rev["commission_paise"] >= 2_400 and rev["gmv_paise"] >= 80_000 and rev["payout_paise"] >= 77_600 and rev["avg_fee_pct"] == 3.0
    assert any(s["label"] == "Knee" for s in d["by_speciality"])
    assert any(x["entity"] == "review" for x in d["activity"])
    an = c.get("/admin/analytics", headers=a, params={"months": 6}).json()
    assert len(an["months"]) == 6 and an["months"][-1]["bookings"] >= 1 and an["plan_monthly"] >= 2 and an["plan_commission"] >= 1
    assert c.get("/admin/dashboard", headers=env["doc"]).status_code == 403


def test_subscriptions_management(env):
    c, a = env["c"], env["admin"]
    page = c.get("/admin/subscriptions", headers=a).json()
    row = next(r for r in page["rows"] if r["clinic_name"].startswith("Sunrise"))
    assert page["kpis"]["active"] >= 3 and page["kpis"]["mrr_paise"] >= 100_000
    body = {"plan": "monthly", "price_paise": 40_000, "status": "active", "platform_fee_bps": 500}
    upd = c.put(f"/admin/subscriptions/{row['clinic_id']}", headers=a, json=body)
    assert upd.status_code == 200 and upd.json()["price_paise"] == 40_000 and upd.json()["platform_fee_bps"] == 500
    assert c.put(f"/admin/subscriptions/{row['clinic_id']}", headers=a, json={**body, "platform_fee_bps": 1234}).status_code == 422
    assert c.get("/clinic/subscription", headers=env["doc"]).json()["price_paise"] == 40_000


def test_settings_validation_and_effect(env):
    c, a = env["c"], env["admin"]
    keys = {s["key"] for s in c.get("/admin/settings", headers=a).json()}
    assert keys == {"rewards", "support", "pms_pricing", "platform_fee"}
    support = {"email": "help@example.com", "phone": "+91 90000 00000", "address": "Test address", "hours": "Daily"}
    assert c.put("/admin/settings/support", headers=a, json={**support, "email": "not-an-email"}).status_code == 422
    assert c.put("/admin/settings/support", headers=a, json=support).json()["value"]["email"] == "help@example.com"
    assert c.get("/platform/support").json()["email"] == "help@example.com"
    dup = {"tiers": [{"days": 7, "points": 50}, {"days": 7, "points": 60}], "paise_per_point": 100}
    assert c.put("/admin/settings/rewards", headers=a, json=dup).status_code == 422
    ok = c.put("/admin/settings/rewards", headers=a, json={"tiers": [{"days": 14, "points": 100}, {"days": 7, "points": 50}], "paise_per_point": 100}).json()
    assert [t["days"] for t in ok["value"]["tiers"]] == [7, 14]
    assert c.put("/admin/settings/platform_fee", headers=a, json={"default_bps": 2000, "allowed_bps": [1000, 1500]}).status_code == 422
    assert c.put("/admin/settings/unknown", headers=a, json={}).status_code == 404
    audit = c.get("/admin/audit", headers=a, params={"entity": "setting"}).json()
    assert audit["total"] >= 2 and audit["rows"][0]["actor"] == "Demo Admin"


def test_records_actions(env):
    c, a = env["c"], env["admin"]
    cols = {x["key"]: x for x in c.get("/admin/records", headers=a).json()}
    assert cols["clinics"]["count"] >= 3 and "set_fee" in cols["clinics"]["actions"]
    patients = c.get("/admin/records/patients", headers=a, params={"q": "Aarav"}).json()
    assert patients["total"] == 1 and patients["rows"][0]["active"] is True

    uid = env["patient_user_id"]
    assert c.post(f"/admin/records/patients/{uid}/action", headers=a, json={"action": "set_fee"}).status_code == 400
    assert c.post(f"/admin/records/patients/{uid}/action", headers=a, json={"action": "deactivate"}).status_code == 200
    assert c.get("/auth/me", headers=env["patient"]).status_code == 401
    assert c.post("/auth/refresh", json={"refresh_token": env["patient_refresh"]}).status_code == 401  # sessions revoked
    assert c.post(f"/admin/records/patients/{uid}/action", headers=a, json={"action": "activate"}).status_code == 200
    assert c.post(f"/admin/records/staff/{env['admin_id']}/action", headers=a, json={"action": "deactivate"}).status_code == 409

    review = c.get("/admin/records/reviews", headers=a).json()["rows"][0]
    c.post(f"/admin/records/reviews/{review['id']}/action", headers=a, json={"action": "hide"})
    assert c.get(f"/physios/{env['physio_id']}").json()["reviews_count"] == 0
    c.post(f"/admin/records/reviews/{review['id']}/action", headers=a, json={"action": "unhide"})
    assert c.get(f"/physios/{env['physio_id']}").json()["reviews_count"] == 1

    clinic = next(r for r in c.get("/admin/records/clinics", headers=a).json()["rows"] if r["name"].startswith("NeuroMove"))
    assert c.post(f"/admin/records/clinics/{clinic['id']}/action", headers=a, json={"action": "set_fee", "value": 999}).status_code == 422
    c.post(f"/admin/records/clinics/{clinic['id']}/action", headers=a, json={"action": "deactivate"})
    assert "Dr. Rohan Mehta" not in {p["full_name"] for p in c.get("/physios", params={"city": "Pune"}).json()["items"]}
    c.post(f"/admin/records/clinics/{clinic['id']}/action", headers=a, json={"action": "activate"})


def test_admin_requires_2fa_in_production(env):
    from app.core.config import get_settings

    settings = get_settings()
    original = settings.environment
    settings.environment = "production"
    try:
        r = env["c"].get("/admin/dashboard", headers=env["admin"])
        assert r.status_code == 403 and r.json()["detail"] == "totp_setup_required"
    finally:
        settings.environment = original
