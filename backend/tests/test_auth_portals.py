"""Sign-in is by email only (phone codes are off, staff included), each sign-in page admits only its own kind of
account, and walk-ins show up on the Schedule page.

Opt-in (PNX_INTEGRATION=1). Runs inside one database transaction that is rolled back at the end, so it leaves nothing
behind — safe even on a shared database.
"""

import os
import uuid

import pytest


@pytest.fixture
def env():
    if os.getenv("PNX_INTEGRATION") != "1":
        pytest.skip("set PNX_INTEGRATION=1 to run")
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.core.security import hash_password
    from app.db.session import engine, get_db
    from app.main import app
    from app.models import Branch, Clinic, ClinicMember, Patient, User
    from app.models.clinic import MembershipRole
    from app.models.user import UserRole

    conn = engine.connect()
    outer = conn.begin()
    db = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    patient = User(full_name="PNX TEST Patient", email=f"pnx-portal-pt-{tag}@test.physionexs.com", phone=f"+9190{int(tag, 16) % 10**8:08d}",
                   password_hash=hash_password("patient-pass-1"), role=UserRole.PATIENT)
    physio = User(full_name="PNX TEST Physio", email=f"pnx-portal-doc-{tag}@test.physionexs.com", password_hash=hash_password("physio-pass-1"), role=UserRole.PHYSIO)
    db.add_all([patient, physio])
    db.flush()
    db.add(Patient(user_id=patient.id, full_name=patient.full_name, phone=patient.phone, email=patient.email))
    clinic = Clinic(name="PNX TEST Portal Clinic", slug=f"pnx-portal-{tag}", owner_user_id=physio.id)
    db.add(clinic)
    db.flush()
    db.add(ClinicMember(clinic_id=clinic.id, user_id=physio.id, role=MembershipRole.OWNER))
    db.add(Branch(clinic_id=clinic.id, name="PNX TEST Branch", city="Pune"))
    db.flush()

    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        client.db = db  # for tests that need to set up rows the API has no endpoint for
        yield client, patient, physio, tag
    finally:
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        conn.close()


def test_mobile_number_sign_in_is_off(env):
    c, patient, _, _ = env
    r = c.post("/auth/login", json={"identifier": patient.phone, "password": "patient-pass-1"})
    assert r.status_code == 400 and "email" in r.json()["detail"]
    assert c.post("/auth/otp/request", json={"phone": patient.phone}).status_code == 403
    assert c.post("/auth/otp/request", json={"phone": patient.phone, "intent": "staff"}).status_code == 403
    assert c.post("/auth/otp/verify", json={"phone": patient.phone, "code": "123456", "full_name": "X Y"}).status_code == 403


def test_each_page_admits_only_its_own_accounts(env):
    c, patient, physio, _ = env
    r = c.post("/auth/login", json={"identifier": patient.email, "password": "patient-pass-1", "intent": "clinic"})
    assert r.status_code == 403 and "patient portal" in r.json()["detail"]
    r = c.post("/auth/login", json={"identifier": physio.email, "password": "physio-pass-1", "intent": "patient"})
    assert r.status_code == 403 and "practice console" in r.json()["detail"]
    # A wrong password never reveals the role.
    assert c.post("/auth/login", json={"identifier": patient.email, "password": "nope", "intent": "clinic"}).status_code == 401
    assert c.post("/auth/login", json={"identifier": patient.email, "password": "patient-pass-1", "intent": "patient"}).json()["user"]["role"] == "patient"
    assert c.post("/auth/login", json={"identifier": physio.email, "password": "physio-pass-1", "intent": "clinic"}).json()["user"]["role"] == "physio"


def test_patient_email_cannot_become_a_physio_account(env):
    c, patient, physio, tag = env
    base = {"full_name": "Dr. PNX Test", "phone": f"+9191{int(tag, 16) % 10**8:08d}", "password": "physio-pass-2", "registration_no": "IAP-PNX-1",
            "council": "IAP", "qualification": "BPT", "clinic_name": "PNX Test Clinic", "city": "Pune"}
    r = c.post("/auth/register/physio", json={**base, "email": patient.email.upper()})
    assert r.status_code == 409 and "registered as a patient" in r.json()["detail"] and "different email" in r.json()["detail"]
    r = c.post("/auth/register/patient", json={"full_name": "PNX Test", "email": physio.email, "password": "patient-pass-2"})
    assert r.status_code == 409 and "clinic account" in r.json()["detail"]
    r = c.post("/auth/register/physio", json={**base, "email": f"pnx-portal-new-{tag}@test.physionexs.com"})
    assert r.status_code == 201, r.text


def _owner(c, physio):
    tokens = c.post("/auth/login", json={"identifier": physio.email, "password": "physio-pass-1", "intent": "clinic"}).json()
    clinic_id = tokens["user"]["memberships"][0]["clinic_id"]
    return {"Authorization": f"Bearer {tokens['access_token']}", "X-Clinic-Id": clinic_id}


def test_staff_are_added_by_email_and_sign_in_with_it(env):
    c, patient, physio, tag = env
    h = _owner(c, physio)
    r = c.post("/clinic/staff", headers=h, json={"full_name": "PNX Staff", "email": patient.email, "password": "staff-pass-1"})
    assert r.status_code == 409 and "patient" in r.json()["detail"]
    email = f"pnx-portal-staff-{tag}@test.physionexs.com"
    r = c.post("/clinic/staff", headers=h, json={"full_name": "PNX Staff", "email": email, "password": "staff-pass-1", "job_title": "Receptionist"})
    assert r.status_code == 201, r.text
    assert r.json()["email"] == email
    staff = c.post("/auth/login", json={"identifier": email.upper(), "password": "staff-pass-1", "intent": "clinic"})
    assert staff.status_code == 200 and staff.json()["user"]["role"] == "staff"
    assert c.post("/auth/login", json={"identifier": email, "password": "staff-pass-1", "intent": "patient"}).status_code == 403


def test_walk_ins_are_listed_for_the_schedule(env):
    c, _, physio, _ = env
    h = _owner(c, physio)
    branch_id = c.get("/clinic/branches", headers=h).json()[0]["id"]
    token = c.post("/clinic/queue", headers=h, json={"branch_id": branch_id, "full_name": "PNX Walk In", "phone": "+919111122233", "reason": "Knee pain"}).json()
    assert token["label"]
    day = c.get("/clinic/queue", headers=h, params={"branch_id": branch_id}).json()["service_date"]  # the branch's local day
    listed = c.get("/clinic/walk-ins", headers=h, params={"day": day}).json()
    assert [t["patient_name"] for t in listed] == ["PNX Walk In"] and listed[0]["reason"] == "Knee pain"


def test_dashboard_active_patients_follow_the_selected_branch(env):
    c, _, physio, _ = env
    h = _owner(c, physio)
    seen = c.get("/clinic/branches", headers=h).json()[0]["id"]
    empty = c.post("/clinic/branches", headers=h, json={"name": "PNX TEST Empty", "city": "Pune"}).json()["id"]
    c.post("/clinic/queue", headers=h, json={"branch_id": seen, "full_name": "PNX Walk In", "phone": "+919111122244"})
    assert c.get("/clinic/dashboard", headers=h, params={"branch_id": empty}).json()["active_patients"] == 0
    assert c.get("/clinic/dashboard", headers=h, params={"branch_id": seen}).json()["active_patients"] == 1
    assert c.get("/clinic/dashboard", headers=h).json()["active_patients"] == 1

    # Staff on roll follows the branch too; members with no branch count everywhere.
    tag = empty[:8]
    c.post("/clinic/staff", headers=h, json={"full_name": "PNX Seen Staff", "email": f"pnx-seen-{tag}@test.physionexs.com", "password": "staff-pass-1", "branch_id": seen})
    c.post("/clinic/staff", headers=h, json={"full_name": "PNX Floater", "email": f"pnx-float-{tag}@test.physionexs.com", "password": "staff-pass-1"})
    by_branch = {b: c.get("/clinic/dashboard", headers=h, params={"branch_id": b}).json()["staff_on_roll"] for b in (seen, empty)}
    assert by_branch == {seen: 3, empty: 2}  # owner (no branch) + floater everywhere; the assigned one only at `seen`
    assert c.get("/clinic/dashboard", headers=h).json()["staff_on_roll"] == 3


def _login(c, email, password, clinic_id):
    t = c.post("/auth/login", json={"identifier": email, "password": password, "intent": "clinic"}).json()
    return {"Authorization": f"Bearer {t['access_token']}", "X-Clinic-Id": clinic_id}


def test_branch_staff_see_only_their_branch_and_can_print_invoices(env):
    c, _, physio, tag = env
    h = _owner(c, physio)
    clinic_id = h["X-Clinic-Id"]
    kharadi = c.get("/clinic/branches", headers=h).json()[0]["id"]
    karve = c.post("/clinic/branches", headers=h, json={"name": "PNX TEST Karve", "city": "Pune"}).json()["id"]

    # One patient walks in at each branch; each gets an invoice there.
    at_kharadi = c.post("/clinic/queue", headers=h, json={"branch_id": kharadi, "full_name": "PNX Kharadi Pt", "phone": "+919111122255"}).json()
    at_karve = c.post("/clinic/queue", headers=h, json={"branch_id": karve, "full_name": "PNX Karve Pt", "phone": "+919111122266"}).json()
    line = [{"description": "Physiotherapy session", "quantity": 1, "rate_paise": 60000}]
    inv_kharadi = c.post("/clinic/invoices", headers=h, json={"clinic_patient_id": at_kharadi["clinic_patient_id"], "branch_id": kharadi, "items": line}).json()
    inv_karve = c.post("/clinic/invoices", headers=h, json={"clinic_patient_id": at_karve["clinic_patient_id"], "branch_id": karve, "items": line}).json()

    email = f"pnx-karve-{tag}@test.physionexs.com"
    staff = c.post("/clinic/staff", headers=h, json={"full_name": "PNX Karve Staff", "email": email, "password": "staff-pass-1", "branch_id": karve}).json()
    sh = _login(c, email, "staff-pass-1", clinic_id)

    assert [b["id"] for b in c.get("/clinic/branches", headers=sh).json()] == [karve]
    assert c.get("/clinic/queue", headers=sh, params={"branch_id": kharadi}).status_code == 404
    assert c.get("/clinic/queue", headers=sh, params={"branch_id": karve}).status_code == 200
    assert [t["patient_name"] for t in c.get("/clinic/walk-ins", headers=sh, params={"day": c.get("/clinic/queue", headers=sh, params={"branch_id": karve}).json()["service_date"]}).json()] == ["PNX Karve Pt"]
    names = {p["full_name"] for p in c.get("/clinic/patients", headers=sh, params={"limit": 200}).json()}
    assert "PNX Karve Pt" in names and "PNX Kharadi Pt" not in names
    assert c.get(f"/clinic/patients/{at_kharadi['clinic_patient_id']}", headers=sh).status_code == 404
    assert c.get("/clinic/dashboard", headers=sh, params={"branch_id": kharadi}).status_code == 404

    # Staff can open and print their branch's invoices, not the other branch's, and can't void.
    assert c.get(f"/clinic/invoices/{inv_karve['id']}", headers=sh).status_code == 200
    assert c.get(f"/clinic/invoices/{inv_kharadi['id']}", headers=sh).status_code == 404
    assert [i["id"] for i in c.get(f"/clinic/invoices/patient/{at_karve['clinic_patient_id']}", headers=sh).json()] == [inv_karve["id"]]
    assert c.post(f"/clinic/invoices/{inv_karve['id']}/void", headers=sh).status_code == 403

    # The owner moves them to all branches and edits their details; they then see both branches.
    r = c.put(f"/clinic/staff/{staff['id']}", headers=h, json={"branch_id": None, "full_name": "PNX Floater", "job_title": "Front desk", "password": "staff-pass-2"})
    assert r.status_code == 200, r.text
    assert r.json()["full_name"] == "PNX Floater" and r.json()["branch_id"] is None
    assert c.post("/auth/login", json={"identifier": email, "password": "staff-pass-1", "intent": "clinic"}).status_code == 401
    sh = _login(c, email, "staff-pass-2", clinic_id)
    assert {b["id"] for b in c.get("/clinic/branches", headers=sh).json()} == {kharadi, karve}
    assert c.get(f"/clinic/patients/{at_kharadi['clinic_patient_id']}", headers=sh).status_code == 200
    # The owner's own sign-in details aren't editable from the team list.
    owner_row = next(m for m in c.get("/clinic/staff", headers=h).json() if m["role"] == "owner")
    assert c.put(f"/clinic/staff/{owner_row['id']}", headers=h, json={"email": "x@test.physionexs.com"}).status_code == 409


def test_patient_picks_a_branch_and_can_pay_at_the_clinic(env):
    from datetime import time as clock

    from app.models import Availability, PhysioProfile
    from app.models.clinic import VerificationStatus

    c, patient, physio, tag = env
    db = c.db
    h = _owner(c, physio)
    kharadi = c.get("/clinic/branches", headers=h).json()[0]["id"]
    karve = c.post("/clinic/branches", headers=h, json={"name": "PNX TEST Karve", "city": "Pune"}).json()["id"]
    db.add(PhysioProfile(user_id=physio.id, registration_no="IAP-PNX-B", verification_status=VerificationStatus.APPROVED,
                         offers_in_clinic=True, fee_in_clinic_paise=50000, offers_online=True, fee_online_paise=40000))
    for b in (kharadi, karve):
        for wd in range(7):
            db.add(Availability(physio_user_id=physio.id, branch_id=b, weekday=wd, start_time=clock(0, 0), end_time=clock(23, 30), slot_minutes=30))
    db.flush()

    days = c.get(f"/physios/{physio.id}/slots", params={"branch_id": karve, "days": 2}).json()
    slots = [s for d in days for s in d["slots"] if s["available"]]
    assert slots and {s["branch_id"] for s in slots} == {karve}
    starts = slots[0]["starts_at"]

    pt = c.post("/auth/login", json={"identifier": patient.email, "password": "patient-pass-1", "intent": "patient"}).json()
    ph = {"Authorization": f"Bearer {pt['access_token']}"}
    base = {"physio_id": str(physio.id), "starts_at": starts, "mode": "in_clinic"}
    r = c.post("/bookings", headers=ph, json={**base, "pay_at_clinic": True})
    assert r.status_code == 400 and "branch" in r.json()["detail"]  # works at two branches: must choose
    assert c.post("/bookings", headers=ph, json={**base, "mode": "online", "branch_id": karve, "pay_at_clinic": True}).status_code == 400

    r = c.post("/bookings", headers=ph, json={**base, "branch_id": karve, "pay_at_clinic": True})
    assert r.status_code == 201, r.text
    booked = r.json()
    assert booked["status"] == "confirmed" and booked["razorpay"] is None
    mine = c.get(f"/me/appointments/{booked['appointment_id']}", headers=ph).json()
    assert mine["pay_at_clinic"] is True and mine["paid"] is False

    # Karve reception sees it, collects the fee, and the booking shows as paid.
    email = f"pnx-desk-{tag}@test.physionexs.com"
    c.post("/clinic/staff", headers=h, json={"full_name": "PNX Desk", "email": email, "password": "staff-pass-1", "branch_id": karve})
    sh = _login(c, email, "staff-pass-1", h["X-Clinic-Id"])
    appts = c.get("/clinic/appointments", headers=sh, params={"day": c.get("/clinic/queue", headers=sh, params={"branch_id": karve}).json()["service_date"]}).json()
    appts += c.get("/clinic/appointments", headers=sh, params={"day": days[1]["date"]}).json()
    appt = next(a for a in appts if a["id"] == booked["appointment_id"])
    assert appt["pay_at_clinic"] is True and appt["paid"] is False and appt["branch_name"] == "PNX TEST Karve"
    cp_id = next(p["id"] for p in c.get("/clinic/patients", headers=sh, params={"limit": 200}).json() if p["full_name"] == patient.full_name)
    inv = c.get(f"/clinic/invoices/patient/{cp_id}", headers=sh).json()[0]
    assert inv["status"] == "due"
    assert c.post(f"/clinic/invoices/{inv['id']}/pay", headers=sh, json={"method": "cash"}).json()["status"] == "paid"
    assert c.get(f"/me/appointments/{booked['appointment_id']}", headers=ph).json()["paid"] is True
