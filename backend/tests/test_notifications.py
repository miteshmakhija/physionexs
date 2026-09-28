"""Notification feed, push devices, after-commit push and the daily check-in reminder.

The end-to-end test is opt-in (PNX_INTEGRATION=1), rolled back, and never calls Expo (the sender is replaced).
"""

import os
import uuid

import pytest

from app.models.engagement import Notification
from app.services.push import push_text


def test_lock_screen_text_hides_health_details():
    plan = Notification(kind="plan_updated", title="Your physio updated your exercise program", body="Heel slides: 3 → 1 sets")
    assert push_text(plan) == ("Your physio updated your plan", "Open Physionexs to see what's changed.")
    red = Notification(kind="red_flag", title="Red flag: Asha Rao", body="Fever or chills")
    assert "Asha" not in " ".join(push_text(red)) and "Fever" not in " ".join(push_text(red))
    appt = Notification(kind="appointment_reminder", title="Appointment tomorrow", body="With Dr. Iyer · in-clinic")
    assert push_text(appt) == ("Appointment tomorrow", "With Dr. Iyer · in-clinic")


@pytest.fixture
def env(monkeypatch):
    if os.getenv("PNX_INTEGRATION") != "1":
        pytest.skip("set PNX_INTEGRATION=1 to run")
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.core.security import create_access_token
    from app.db.session import engine, get_db
    from app.main import app
    from app.models import Clinic, ClinicMember, ClinicPatient, Exercise, Patient, User
    from app.models.clinic import MembershipRole
    from app.models.exercise import ExerciseCategory, ExerciseSource, ExerciseStatus, ExerciseVisibility
    from app.models.user import UserRole
    from app.services import push

    sent: list[dict] = []
    monkeypatch.setattr(push, "_post_expo", lambda msgs: sent.extend(msgs) or [{"status": "ok"} for _ in msgs])
    conn = engine.connect()
    outer = conn.begin()
    db = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    physio = User(full_name="PNX TEST Physio", email=f"pnx-nt-{tag}@test.physionexs.com", role=UserRole.PHYSIO)
    pu = User(full_name="PNX TEST Asha Rao", email=f"pnx-nt-pt-{tag}@test.physionexs.com", role=UserRole.PATIENT)
    db.add_all([physio, pu])
    db.flush()
    clinic = Clinic(name="PNX TEST Clinic", slug=f"pnx-nt-{tag}", owner_user_id=physio.id, twin_pilot=True)
    db.add(clinic)
    db.flush()
    db.add(ClinicMember(clinic_id=clinic.id, user_id=physio.id, role=MembershipRole.OWNER))
    patient = Patient(full_name="PNX TEST Asha Rao", user_id=pu.id)
    db.add(patient)
    db.flush()
    cp = ClinicPatient(clinic_id=clinic.id, patient_id=patient.id)
    ex = Exercise(slug=f"pnx-nt-{tag}", name="PNX TEST Heel slides", body_region="knee", category=ExerciseCategory.STRENGTH, steps=["Step"],
                  source=ExerciseSource.PLATFORM, visibility=ExerciseVisibility.PUBLIC, status=ExerciseStatus.PUBLISHED)
    db.add_all([cp, ex])
    db.flush()
    app.dependency_overrides[get_db] = lambda: db
    h = {"Authorization": f"Bearer {create_access_token(physio.id, physio.role.value)}", "X-Clinic-Id": str(clinic.id)}
    ph = {"Authorization": f"Bearer {create_access_token(pu.id, pu.role.value)}"}
    try:
        yield TestClient(app), h, ph, str(cp.id), str(ex.id), sent, db
    finally:
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        conn.close()


def test_feed_devices_push_and_reminder(env):
    from app.services.reminders import send_checkin_reminders
    from app.services.twin_rules import local_today

    c, h, ph, cp_id, ex_id, sent, db = env
    token = "ExponentPushToken[pnx-test-" + uuid.uuid4().hex[:12] + "]"
    assert c.post("/me/devices", headers=ph, json={"token": "not-a-token", "platform": "android"}).status_code == 422
    assert c.post("/me/devices", headers=ph, json={"token": token, "platform": "android"}).status_code == 204

    # A plan change notifies the patient; the push (after commit) carries no health details.
    plan = c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Right TKA", "protocol": "tka", "affected_side": "right"}).json()
    c.put(f"/clinic/care-plans/{plan['id']}/exercises", headers=h, json=[{"exercise_id": ex_id, "sets": 3, "reps": 10}])
    assert [(m["to"], m["title"], m["body"], m["data"]["kind"]) for m in sent] == [
        (token, "Your physio updated your plan", "Open Physionexs to see what's changed.", "plan_updated")]

    # Nothing is pushed for a change that's rolled back.
    sent.clear()
    patient_user = uuid.UUID(c.get("/auth/me", headers=ph).json()["id"])
    db.add(Notification(user_id=patient_user, kind="plan_updated", title="x"))
    db.flush()
    db.rollback()
    assert sent == []

    # The feed: full text in-app, unread count, mark as read.
    feed = c.get("/me/notifications", headers=ph).json()
    assert feed["unread"] == 1 and feed["items"][0]["title"] == "Your exercise program was updated"
    assert c.post("/me/notifications/read", headers=ph, json={}).status_code == 204
    assert c.get("/me/notifications", headers=ph).json()["unread"] == 0

    # Daily reminder: only once consented and not yet checked in today.
    sent.clear()
    today = local_today()
    assert send_checkin_reminders(db, today) == 0
    version = c.get("/me/checkin", headers=ph).json()["consent"]["version"]
    c.post("/me/consents", headers=ph, json={"purpose": "twin_tracking", "version": version})
    assert send_checkin_reminders(db, today) == 1 and sent[-1]["data"] == {"kind": "checkin_reminder"}
    c.post("/me/checkins", headers=ph, json={"day": today.isoformat(), "pain": 3, "stiffness": 3, "swelling": "none", "sleep": "good", "exercises": "all"})
    assert send_checkin_reminders(db, today) == 0

    # Signing out removes the device.
    assert c.request("DELETE", "/me/devices", headers=ph, json={"token": token, "platform": "android"}).status_code == 204
    sent.clear()
    c.put(f"/clinic/care-plans/{plan['id']}/exercises", headers=h, json=[{"exercise_id": ex_id, "sets": 2, "reps": 10}])
    assert sent == []
