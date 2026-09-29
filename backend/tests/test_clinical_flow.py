"""Phase 3: queue, patient files, consultations, care plans, patient logging.

Opt-in (writes to the configured database, cleans up afterwards):
    PNX_INTEGRATION=1 python -m pytest tests/test_clinical_flow.py
"""

import os
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import delete, select

pytestmark = pytest.mark.skipif(os.getenv("PNX_INTEGRATION") != "1", reason="set PNX_INTEGRATION=1 to run")

APP_PATIENT_PHONE = "+919000000921"
WALKIN_PHONE = "+919000000922"
TEST_PREFIX = "PNX TEST "


@pytest.fixture(scope="module")
def env():
    from fastapi.testclient import TestClient

    from app.core.security import hash_password
    from app.db.session import SessionLocal
    from app.devtools import DEMO_PASSWORD, purge_demo, purge_users, seed_demo
    from app.main import app
    from app.models import Exercise, User
    from app.models.exercise import ExerciseCategory, ExerciseSource, ExerciseStatus, ExerciseVisibility
    from app.models.user import UserRole
    from app.services import msg91

    codes: dict[str, str] = {}
    original = msg91.send_otp
    msg91.send_otp = lambda phone, code: codes.__setitem__(phone, code)

    with SessionLocal() as db:
        purge_demo(db)
        seed_demo(db)
        db.add(User(full_name="Demo Admin", email="admin@demo.physionexs.com", password_hash=hash_password("demo-admin-123"), role=UserRole.SUPER_ADMIN))
        ex = {}
        for i, (name, st) in enumerate([("Quad sets", ExerciseStatus.PUBLISHED), ("Heel slides", ExerciseStatus.PUBLISHED), ("Draft bridge", ExerciseStatus.IN_REVIEW)]):
            e = Exercise(slug=f"pnx-test-{i}", name=TEST_PREFIX + name, body_region="knee", category=ExerciseCategory.STRENGTH,
                         steps=["Step one", "Step two"], source=ExerciseSource.PLATFORM, visibility=ExerciseVisibility.PUBLIC, status=st)
            db.add(e)
            db.flush()
            ex[name] = str(e.id)
        db.commit()

    c = TestClient(app)
    pt = c.post("/auth/register/patient", json={"full_name": "Aarav Shah", "email": "aarav-clinical@demo.physionexs.com", "phone": APP_PATIENT_PHONE, "password": "patient-password-1"}).json()
    doc = c.post("/auth/login", json={"identifier": "iap-demo-1001@demo.physionexs.com", "password": DEMO_PASSWORD}).json()
    other = c.post("/auth/login", json={"identifier": "iap-demo-1002@demo.physionexs.com", "password": DEMO_PASSWORD}).json()
    admin = c.post("/auth/login", json={"identifier": "admin@demo.physionexs.com", "password": "demo-admin-123"}).json()
    clinic_id = doc["user"]["memberships"][0]["clinic_id"]
    h = {"Authorization": f"Bearer {doc['access_token']}", "X-Clinic-Id": clinic_id}
    branch_id = c.get("/clinic/branches", headers=h).json()[0]["id"]

    yield {
        "c": c, "ex": ex, "branch_id": branch_id, "doc": h,
        "patient": {"Authorization": f"Bearer {pt['access_token']}"},
        "patient_id": pt["user"]["patient_id"],
        "other": {"Authorization": f"Bearer {other['access_token']}", "X-Clinic-Id": other["user"]["memberships"][0]["clinic_id"]},
        "admin": {"Authorization": f"Bearer {admin['access_token']}"},
        "state": {},
    }

    msg91.send_otp = original
    with SessionLocal() as db:
        phones = [APP_PATIENT_PHONE, WALKIN_PHONE]
        purge_users(db, list(db.scalars(select(User.id).where(User.phone.in_(phones)))), phones)
        purge_demo(db)
        db.execute(delete(Exercise).where(Exercise.name.like(TEST_PREFIX + "%")))
        db.commit()


def test_walk_in_queue_and_live_token(env):
    c, h, b = env["c"], env["doc"], env["branch_id"]
    t1 = c.post("/clinic/queue", headers=h, json={"branch_id": b, "phone": WALKIN_PHONE, "full_name": "Kavya Rao", "age": 34, "sex": "F", "reason": "Back pain"})
    assert t1.status_code == 201, t1.text
    assert t1.json()["label"] == "T-01" and t1.json()["patient_age"] == 34
    # The app patient walks in: matched by phone to their existing record.
    t2 = c.post("/clinic/queue", headers=h, json={"branch_id": b, "phone": APP_PATIENT_PHONE, "full_name": "ignored", "reason": "Knee follow-up"}).json()
    assert t2["label"] == "T-02" and t2["patient_id"] == env["patient_id"] and t2["patient_name"] == "Aarav Shah"

    mine = c.get("/me/tokens", headers=env["patient"]).json()
    assert mine[0]["label"] == "T-02" and mine[0]["ahead"] == 1

    q = c.post("/clinic/queue/call-next", headers=h, params={"branch_id": b}).json()
    assert q["now_serving"]["label"] == "T-01" and [t["label"] for t in q["waiting"]] == ["T-02"]
    mine = c.get("/me/tokens", headers=env["patient"]).json()[0]
    assert mine["ahead"] == 0 and mine["now_serving"] == "T-01" and mine["est_wait_minutes"] > 0

    q = c.post("/clinic/queue/call-next", headers=h, params={"branch_id": b}).json()
    assert q["now_serving"]["label"] == "T-02" and [t["label"] for t in q["done"]] == ["T-01"]
    env["state"]["cp_id"] = q["now_serving"]["clinic_patient_id"]

    # Another clinic can't see this branch's queue.
    assert c.get("/clinic/queue", headers=env["other"], params={"branch_id": b}).status_code == 404


def test_patient_file_background_and_soap(env):
    c, h = env["c"], env["doc"]
    names = {p["full_name"] for p in c.get("/clinic/patients", headers=h).json()}
    assert {"Aarav Shah", "Kavya Rao"} <= names
    assert [p["full_name"] for p in c.get("/clinic/patients", headers=h, params={"q": "kavya"}).json()] == ["Kavya Rao"]

    cp = env["state"]["cp_id"]
    bg = c.put(f"/clinic/patients/{cp}/background", headers=h, json={
        "past_history": "2019 right ankle sprain.", "conditions": ["Hypertension"], "prior_medicines": [{"name": "Telmisartan 40", "frequency": "1-0-0"}],
        "core_strengths": "Good quad activation", "weaknesses": "VMO lag", "core_grade": "good",
    })
    assert bg.status_code == 200 and bg.json()["core_grade"] == "good"

    note = c.post(f"/clinic/patients/{cp}/consultations", headers=h, json={"subjective": "Pain 6/10", "objective": "Flexion 0–100°", "pain_vas": 6, "vitals": {"knee_flexion_deg": 100}}).json()
    assert note["title"] == "Initial assessment" and note["signed_at"] is None
    signed = c.put(f"/clinic/consultations/{note['id']}", headers=h, json={"assessment": "Grade II MCL sprain", "sign": True}).json()
    assert signed["signed_at"] and signed["subjective"] == "Pain 6/10"
    assert c.put(f"/clinic/consultations/{note['id']}", headers=h, json={"plan": "edit"}).status_code == 409

    # Other clinics can't open this file.
    assert c.get(f"/clinic/patients/{cp}", headers=env["other"]).status_code == 404


def test_care_plan_prescribing(env):
    c, h, ex = env["c"], env["doc"], env["ex"]
    cp = env["state"]["cp_id"]
    plan = c.post(f"/clinic/patients/{cp}/care-plans", headers=h, json={"condition": "Grade II MCL sprain", "goal": "Pain-free stairs", "stage": "Week 1 of 6", "notes": "Avoid pivoting."})
    assert plan.status_code == 201, plan.text
    pid = plan.json()["id"]
    env["state"]["plan_id"] = pid

    draft = c.put(f"/clinic/care-plans/{pid}/exercises", headers=h, json=[{"exercise_id": ex["Draft bridge"], "sets": 3, "reps": 10}])
    assert draft.status_code == 400  # unreviewed exercises can't be prescribed

    r = c.put(f"/clinic/care-plans/{pid}/exercises", headers=h, json=[
        {"exercise_id": ex["Quad sets"], "sets": 3, "hold_seconds": 5},
        {"exercise_id": ex["Heel slides"], "sets": 2, "reps": 15, "frequency": "daily"},
    ])
    assert r.status_code == 200 and [e["name"] for e in r.json()["exercises"]] == [TEST_PREFIX + "Quad sets", TEST_PREFIX + "Heel slides"]

    meds = c.put(f"/clinic/care-plans/{pid}/medications", headers=h, json=[
        {"name": "Ibuprofen 400 mg", "dose": "1 tablet", "frequency": "1-0-1", "timing": "After food", "duration_days": 5},
        {"name": "Diclofenac gel", "frequency": "SOS"},
    ]).json()
    assert meds["medications"][0]["reminder_times"] == ["08:30", "21:00"] and meds["medications"][1]["reminder_times"] == []

    t = c.post(f"/clinic/care-plans/{pid}/tests", headers=h, json={"name": "MRI knee"}).json()
    ready = c.patch(f"/clinic/tests/{t['id']}", headers=h, json={"status": "result_ready", "result_note": "No tear."}).json()
    assert ready["status"] == "result_ready" and ready["result_at"]

    file = c.get(f"/clinic/patients/{cp}", headers=h).json()
    assert file["active_plan"]["id"] == pid and file["latest_pain"] == 6 and file["background"]["conditions"] == ["Hypertension"]


def test_patient_logs_and_progress(env):
    c, p = env["c"], env["patient"]
    today = date.today().isoformat()
    plans = c.get("/me/care-plans", headers=p).json()
    assert plans[0]["condition"] == "Grade II MCL sprain"

    t = c.get("/me/today", headers=p, params={"day": today}).json()
    assert len(t["exercises"]) == 2 and t["exercise_pct"] == 0
    assert [d["slot"] for d in t["doses"]] == ["08:30", "21:00"]

    first = t["exercises"][0]["plan_exercise_id"]
    r = c.post("/me/exercise-logs", headers=p, json={"plan_exercise_id": first, "logged_on": today, "feel": "ok", "pain": 4}).json()
    assert r["done"] == 1 and r["scheduled"] == 1
    assert c.post("/me/exercise-logs", headers=p, json={"plan_exercise_id": first, "logged_on": today}).status_code == 409
    assert c.post("/me/exercise-logs", headers=p, json={"plan_exercise_id": first, "logged_on": "2020-01-01"}).status_code == 400

    dose = t["doses"][0]
    for _ in range(2):  # idempotent
        assert c.post("/me/dose-logs", headers=p, json={"medication_id": dose["medication_id"], "logged_on": today, "dose_slot": dose["slot"]}).status_code == 201
    t = c.get("/me/today", headers=p, params={"day": today}).json()
    assert t["exercise_pct"] == 50 and t["dose_pct"] == 50

    prog = c.get("/me/progress", headers=p).json()
    assert len(prog["days"]) == 7 and prog["days"][-1]["pct"] == 50 and prog["pain_now"] == 4 and prog["unlogged_doses_today"] == 1


def test_seven_day_streak_awards_points(env):
    from app.db.session import SessionLocal
    from app.models import CarePlan, CarePlanExercise, ExerciseLog, Patient

    c, p = env["c"], env["patient"]
    today = date.today()
    with SessionLocal() as db:
        plan = db.get(CarePlan, env["state"]["plan_id"])
        plan.starts_on = today - timedelta(days=10)
        pes = list(db.scalars(select(CarePlanExercise).where(CarePlanExercise.care_plan_id == plan.id, CarePlanExercise.is_active.is_(True))))
        for pe in pes:
            pe.created_at = datetime.now(UTC) - timedelta(days=10)
            for d in range(1, 7):  # the previous 6 days fully done
                db.add(ExerciseLog(plan_exercise_id=pe.id, patient_id=env["patient_id"], logged_on=today - timedelta(days=d)))
        before = db.get(Patient, env["patient_id"]).points_balance
        db.commit()
        remaining = [pe.id for pe in pes]

    t = c.get("/me/today", headers=p, params={"day": today.isoformat()}).json()
    todo = [e["plan_exercise_id"] for e in t["exercises"] if e["done"] < e["scheduled"]]
    assert len(todo) == 1 and todo[0] in {str(x) for x in remaining}
    r = c.post("/me/exercise-logs", headers=p, json={"plan_exercise_id": todo[0], "logged_on": today.isoformat(), "feel": "easy"}).json()
    assert r["streak_days"] == 7 and r["points_awarded"] == 50
    assert c.get("/me/points", headers=p).json()["balance"] == before + 50

    # Undo + redo on the same day doesn't pay the tier twice.
    c.delete(f"/me/exercise-logs/{todo[0]}", headers=p, params={"logged_on": today.isoformat()})
    again = c.post("/me/exercise-logs", headers=p, json={"plan_exercise_id": todo[0], "logged_on": today.isoformat()}).json()
    assert again["streak_days"] == 7 and again["points_awarded"] == 0


def test_prescription_issue_and_patient_view(env):
    c, h = env["c"], env["doc"]
    rx = c.post(f"/clinic/care-plans/{env['state']['plan_id']}/prescriptions", headers=h)
    assert rx.status_code == 201, rx.text
    snap = rx.json()["snapshot"]
    assert rx.json()["rx_no"].startswith("RX-")
    assert snap["physio"]["registration_no"] == "IAP-DEMO-1001" and snap["diagnosis"]["condition"] == "Grade II MCL sprain"
    assert snap["medications"][0]["frequency"] == "1-0-1" and len(snap["exercises"]) == 2 and snap["tests"] == ["MRI knee"]
    mine = c.get("/me/prescriptions", headers=env["patient"]).json()
    assert mine[0]["rx_no"] == rx.json()["rx_no"]
    assert c.get(f"/clinic/prescriptions/{rx.json()['id']}", headers=env["other"]).status_code == 404


def test_exercise_library_and_review(env):
    c, h = env["c"], env["doc"]
    lib = c.get("/clinic/exercises", headers=h, params={"q": "PNX TEST"}).json()
    names = {e["name"] for e in lib["items"]}
    assert TEST_PREFIX + "Quad sets" in names and TEST_PREFIX + "Draft bridge" not in names

    body = {"name": TEST_PREFIX + "Clinic step drill", "body_region": "knee", "category": "functional", "steps": ["Step up", "Step down"], "default_reps": 10}
    mine = c.post("/clinic/exercises", headers=h, json=body).json()
    assert mine["visibility"] == "clinic" and mine["status"] == "published"
    assert TEST_PREFIX + "Clinic step drill" not in {e["name"] for e in c.get("/clinic/exercises", headers=env["other"], params={"q": "PNX TEST"}).json()["items"]}

    sub = c.post(f"/clinic/exercises/{mine['id']}/submit", headers=h).json()
    assert sub["status"] == "in_review"
    queue = c.get("/admin/exercises", headers=env["admin"], params={"status": "in_review", "q": "PNX TEST"}).json()
    assert {TEST_PREFIX + "Clinic step drill", TEST_PREFIX + "Draft bridge"} <= {e["name"] for e in queue["items"]}
    assert c.post(f"/admin/exercises/{mine['id']}/reject", headers=env["admin"], json={}).status_code == 422
    pub = c.post(f"/admin/exercises/{mine['id']}/publish", headers=env["admin"], json={"note": "Reviewed"}).json()
    assert pub["visibility"] == "public" and pub["status"] == "published"
    assert TEST_PREFIX + "Clinic step drill" in {e["name"] for e in c.get("/clinic/exercises", headers=env["other"], params={"q": "PNX TEST"}).json()["items"]}
    assert c.get("/admin/exercises", headers=h).status_code == 403
