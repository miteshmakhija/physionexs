"""Digital twin, milestones A1–A4: measurements, targets, twin view, consent, check-ins, flag rules and plan suggestions.

Unit tests always run. The API test is opt-in (PNX_INTEGRATION=1) and runs inside one database transaction that is
rolled back at the end, so it leaves nothing behind — safe even on a shared database.
"""

import os
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.models.twin import Side
from app.models.twin import DailyCheckin, FlagSeverity
from app.services.adherence import DayStat
from app.services.checkins import advice_for
from app.services.settings import DEFAULT_SETTINGS
from app.services.suggestions import describe, is_reduction
from app.services.twin_rules import Reading, Timeline, evaluate, missed_sessions, no_checkin, pain_high, pain_rising, red_flag, rom_drop, rom_plateau
from app.services.twin import CODES, check, is_plausible, progress, weeks_since

# ── Unit ────────────────────────────────────────────────────────────────────


def test_check_rejects_unknown_code_wrong_side_and_out_of_range():
    assert check("knee_flexion", Side.RIGHT, 90).unit == "deg"
    for code, side, value in [("elbow_magic", Side.RIGHT, 10), ("knee_flexion", Side.NONE, 90), ("pain_nprs", Side.LEFT, 3), ("knee_flexion", Side.LEFT, 200), ("pain_nprs", Side.NONE, 11)]:
        with pytest.raises(HTTPException) as e:
            check(code, side, value)
        assert e.value.status_code == 422


def test_implausible_jump_is_held():
    flex = CODES["knee_flexion"]
    assert is_plausible(flex, 90, None)
    assert is_plausible(flex, 100, 75)
    assert not is_plausible(flex, 110, 75)  # > 30° in 48 h
    assert is_plausible(CODES["pain_nprs"], 9, 1)  # pain can swing; no jump rule


def test_progress_respects_direction():
    flex, lag = CODES["knee_flexion"], CODES["knee_extension_lag"]
    assert progress(flex, None, None, 120) == ("no_data", None)
    assert progress(flex, 60, 80, None) == ("no_target", None)
    assert progress(flex, 60, 90, 120) == ("in_progress", 50)
    assert progress(flex, 60, 125, 120) == ("target_met", 100)
    assert progress(flex, 60, 50, 120) == ("in_progress", 0)  # worse than baseline clamps to 0
    assert progress(lag, 20, 10, 0) == ("in_progress", 50)
    assert progress(lag, 20, 0, 0) == ("target_met", 100)


def test_weeks_since():
    today = date(2026, 9, 28)
    assert weeks_since(None, today) is None
    assert weeks_since(date(2026, 9, 7), today) == 3
    assert weeks_since(date(2026, 10, 5), today) is None  # surgery not yet done


def test_red_flag_advice_is_fixed_and_escalates():
    from app.models import Clinic

    clinic = Clinic(name="Knee Care", slug="x", phone="+912000000000")
    assert advice_for([], clinic) is None
    a = advice_for(["fever"], clinic)
    assert a.level == "urgent" and a.call_number == "+912000000000" and "fever or chills" in a.body
    a = advice_for(["calf_pain", "fever", "wound_redness"], clinic)
    assert "tenderness in the calf, fever or chills and wound redder" in a.body
    a = advice_for(["fever", "chest_breathless"], clinic)  # emergency wins
    assert a.level == "emergency" and a.call_number == "112"


# ── Flag rules (pure) ─

CFG = DEFAULT_SETTINGS["twin_rules"]
TODAY = date(2026, 9, 28)


def ck(days_ago: int, pain: int, flags: list[str] | None = None) -> DailyCheckin:
    return DailyCheckin(day=TODAY - timedelta(days=days_ago), pain=pain, stiffness=3, red_flags=flags or [])


def test_pain_rules():
    steady = Timeline(TODAY, checkins=[ck(d, 3) for d in range(9, -1, -1)])
    assert pain_rising(steady, CFG) is None and pain_high(steady, CFG) is None
    rising = Timeline(TODAY, checkins=[ck(d, 3) for d in range(9, 2, -1)] + [ck(1, 5), ck(0, 6)])
    h = pain_rising(rising, CFG)
    assert h and h.severity == FlagSeverity.WATCH and h.evidence == {"avg_3d": 5.5, "avg_prev_7d": 3.0, "threshold": 2}
    assert pain_rising(Timeline(TODAY, checkins=[ck(1, 9), ck(0, 9)]), CFG) is None  # not enough history to compare
    high = pain_high(Timeline(TODAY, checkins=[ck(4, 9), ck(1, 8)]), CFG)
    assert high.key == (TODAY - timedelta(days=1)).isoformat() and high.severity == FlagSeverity.ACT
    assert pain_high(Timeline(TODAY, checkins=[ck(3, 9)]), CFG) is None  # older than the window


def test_red_flag_rule_keys_by_day():
    assert red_flag(Timeline(TODAY, checkins=[ck(2, 4, ["fever"])]), CFG) is None
    h = red_flag(Timeline(TODAY, checkins=[ck(1, 4, ["fever"]), ck(0, 4)]), CFG)
    assert h.key == (TODAY - timedelta(days=1)).isoformat() and "Fever or chills" in h.summary


def test_rom_rules():
    R = Side.RIGHT
    flat = Timeline(TODAY, flexion={R: [Reading(80, TODAY - timedelta(days=8)), Reading(81, TODAY - timedelta(days=4)), Reading(82, TODAY)]}, targets={R: 120})
    assert rom_plateau(flat, CFG, R).rule == "rom_plateau:right"
    assert rom_plateau(Timeline(TODAY, flexion=flat.flexion), CFG, R) is None  # no target, no plateau flag
    assert rom_plateau(Timeline(TODAY, flexion={R: flat.flexion[R][1:] + [Reading(90, TODAY)]}, targets={R: 120}), CFG, R) is None
    short = Timeline(TODAY, flexion={R: [Reading(80, TODAY - timedelta(days=3)), Reading(81, TODAY - timedelta(days=2)), Reading(82, TODAY)]}, targets={R: 120})
    assert rom_plateau(short, CFG, R) is None  # readings span < 7 days
    drop = Timeline(TODAY, flexion={R: [Reading(95, TODAY - timedelta(days=5)), Reading(84, TODAY)]})
    assert rom_drop(drop, CFG, R).evidence["best"] == 95
    assert rom_drop(Timeline(TODAY, flexion={R: [Reading(95, TODAY - timedelta(days=5)), Reading(88, TODAY)]}), CFG, R) is None


def test_adherence_and_checkin_gap_rules():
    days = lambda done: [DayStat(TODAY - timedelta(days=d), 1, x) for d, x in zip(range(5, 0, -1), done)]  # noqa: E731
    assert missed_sessions(Timeline(TODAY, days=days([1, 1, 0, 0, 0])), CFG).evidence["days"][0] == (TODAY - timedelta(days=3)).isoformat()
    assert missed_sessions(Timeline(TODAY, days=days([0, 0, 0, 1, 0])), CFG) is None
    rest = [DayStat(TODAY - timedelta(days=d), 0 if d % 2 else 1, 0) for d in range(8, 0, -1)]  # rest days don't count
    assert missed_sessions(Timeline(TODAY, days=rest), CFG) is not None
    assert no_checkin(Timeline(TODAY, checkins=[ck(3, 2)], consent_since=TODAY - timedelta(days=10)), CFG).evidence["days"] == 3
    assert no_checkin(Timeline(TODAY, checkins=[ck(2, 2)], consent_since=TODAY - timedelta(days=10)), CFG) is None
    assert no_checkin(Timeline(TODAY, checkins=[ck(9, 2)]), CFG) is None  # no consent, nothing expected
    hits, evaluated = evaluate(Timeline(TODAY, targets={Side.LEFT: 110}), CFG)
    assert hits == [] and {"rom_plateau:left", "rom_drop:left", "red_flag"} <= evaluated


def test_suggestion_guardrail_helpers():
    assert is_reduction("sets", 3, 2) and is_reduction("sets", 3, 3) and not is_reduction("sets", 2, 3)
    assert is_reduction("is_active", True, False) and not is_reduction("is_active", False, True)
    assert not is_reduction("reps", None, 5)  # can't add reps to a hold-dosed exercise
    assert describe({"field": "sets", "before": 3, "after": 2}, "Heel slides") == "Heel slides: 3 → 2 sets"
    assert describe({"field": "is_active", "before": True, "after": False}, "Quad sets") == "Quad sets: paused"


# ── API (rolled back) ───────────────────────────────────────────────────────


@pytest.fixture
def client():  # yields (TestClient, physio headers, clinic_patient id, patient headers, db session)
    if os.getenv("PNX_INTEGRATION") != "1":
        pytest.skip("set PNX_INTEGRATION=1 to run")
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.core.security import create_access_token
    from app.db.session import engine, get_db
    from app.main import app
    from app.models import Clinic, ClinicMember, ClinicPatient, Patient, User
    from app.models.clinic import MembershipRole
    from app.models.user import UserRole

    conn = engine.connect()
    outer = conn.begin()
    # Endpoints' commits become savepoints inside `outer`, which is rolled back below.
    db = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    physio = User(full_name="PNX TEST Physio", email=f"pnx-twin-{tag}@test.physionexs.com", role=UserRole.PHYSIO)
    db.add(physio)
    db.flush()
    clinic = Clinic(name="PNX TEST Twin Clinic", slug=f"pnx-twin-{tag}", owner_user_id=physio.id, twin_pilot=True)
    db.add(clinic)
    db.flush()
    db.add(ClinicMember(clinic_id=clinic.id, user_id=physio.id, role=MembershipRole.OWNER))
    patient_user = User(full_name="PNX TEST Twin Patient", email=f"pnx-twin-pt-{tag}@test.physionexs.com", role=UserRole.PATIENT)
    db.add(patient_user)
    db.flush()
    patient = Patient(full_name="PNX TEST Twin Patient", user_id=patient_user.id)
    db.add(patient)
    db.flush()
    cp = ClinicPatient(clinic_id=clinic.id, patient_id=patient.id)
    db.add(cp)
    db.flush()

    app.dependency_overrides[get_db] = lambda: db
    h = {"Authorization": f"Bearer {create_access_token(physio.id, physio.role.value)}", "X-Clinic-Id": str(clinic.id)}
    try:
        ph = {"Authorization": f"Bearer {create_access_token(patient_user.id, patient_user.role.value)}"}
        yield TestClient(app), h, str(cp.id), ph, db
    finally:
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        conn.close()


def test_twin_flow(client):
    c, h, cp_id, _, _ = client

    # A TKA plan on the right knee, surgery 3 weeks ago.
    surgery = (date.today() - timedelta(days=21)).isoformat()
    r = c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Right TKA", "protocol": "tka", "surgery_date": surgery, "affected_side": "right"})
    assert r.status_code == 201, r.text
    plan = r.json()
    assert plan["protocol"] == "tka" and plan["affected_side"] == "right" and plan["targets"] == []

    # Before any reading the protocol's measures appear with no data.
    twin = c.get(f"/clinic/patients/{cp_id}/twin", headers=h).json()
    assert twin["weeks_since_surgery"] == 3 and twin["protocol_label"] == "Knee replacement (TKA)"
    assert [(m["code"], m["side"], m["status"]) for m in twin["measures"]] == [("knee_flexion", "right", "no_data"), ("knee_extension_lag", "right", "no_data")]

    # Targets: validated, one per measure+side.
    assert c.put(f"/clinic/care-plans/{plan['id']}/targets", headers=h, json=[{"code": "knee_flexion", "side": "right", "target_value": 200}]).status_code == 422
    assert c.put(f"/clinic/care-plans/{plan['id']}/targets", headers=h, json=[{"code": "knee_flexion", "side": "right", "target_value": 120}] * 2).status_code == 422
    r = c.put(f"/clinic/care-plans/{plan['id']}/targets", headers=h, json=[{"code": "knee_flexion", "side": "right", "target_value": 120, "by_week": 8}, {"code": "knee_extension_lag", "side": "right", "target_value": 0}])
    assert r.status_code == 200 and len(r.json()) == 2

    # Editing the plan from an older screen that doesn't send twin fields keeps them.
    r = c.put(f"/clinic/care-plans/{plan['id']}", headers=h, json={"condition": "Right TKA", "goal": "Stairs by week 8"})
    assert r.json()["protocol"] == "tka" and r.json()["surgery_date"] == surgery and len(r.json()["targets"]) == 2

    # Readings: baseline 60°, then 90° → half-way to 120°.
    t0 = datetime.now(UTC) - timedelta(days=7)
    r = c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[
        {"code": "knee_flexion", "side": "right", "value": 60, "measured_at": t0.isoformat()},
        {"code": "pain_nprs", "side": "none", "value": 5, "method": "self_report", "measured_at": t0.isoformat()},
    ])
    assert r.status_code == 201, r.text
    assert c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[{"code": "knee_flexion", "side": "right", "value": 90}]).json()[0]["trusted"] is True

    # A 90 → 125 jump within 48 h is saved but held back.
    held = c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[{"code": "knee_flexion", "side": "right", "value": 125}]).json()[0]
    assert held["trusted"] is False
    flex = next(m for m in c.get(f"/clinic/patients/{cp_id}/twin", headers=h).json()["measures"] if m["code"] == "knee_flexion")
    assert (flex["latest"]["value"], flex["baseline"], flex["target"], flex["status"], flex["progress_pct"]) == (90, 60, 120, "in_progress", 50)

    # Confirming it makes it count: target met.
    assert c.patch(f"/clinic/measurements/{held['id']}", headers=h, json={"trusted": True}).json()["trusted"] is True
    twin = c.get(f"/clinic/patients/{cp_id}/twin", headers=h).json()
    flex = next(m for m in twin["measures"] if m["code"] == "knee_flexion")
    assert flex["status"] == "target_met" and flex["latest"]["recorded_by_name"] == "PNX TEST Physio"
    assert any(m["code"] == "pain_nprs" for m in twin["measures"]) and len(twin["measurements"]) == 4

    # Bad input.
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    assert c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[{"code": "knee_flexion", "side": "right", "value": 90, "measured_at": future}]).status_code == 422
    assert c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[{"code": "knee_flexion", "side": "right", "value": 90, "consultation_id": str(uuid.uuid4())}]).status_code == 400

    # Discard removes it.
    assert c.delete(f"/clinic/measurements/{held['id']}", headers=h).status_code == 204
    assert len(c.get(f"/clinic/patients/{cp_id}/twin", headers=h).json()["measurements"]) == 3

    # Other clinics can't see or touch it.
    other = {**h, "X-Clinic-Id": str(uuid.uuid4())}
    assert c.get(f"/clinic/patients/{cp_id}/twin", headers=other).status_code == 403


def test_checkin_flow(client):
    c, h, cp_id, ph, _ = client
    today = date.today().isoformat()
    answers = {"day": today, "pain": 4, "stiffness": 5, "swelling": "mild", "sleep": "ok", "exercises": "all"}

    # No TKA plan yet: the card doesn't apply and check-ins are refused.
    state = c.get("/me/checkin", headers=ph, params={"day": today}).json()
    assert state["eligible"] is False
    assert c.post("/me/checkins", headers=ph, json=answers).status_code == 409

    plan = c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Left TKA", "protocol": "tka", "affected_side": "left"}).json()
    state = c.get("/me/checkin", headers=ph, params={"day": today}).json()
    assert state["eligible"] and state["plan"]["care_plan_id"] == plan["id"] and state["consent"]["granted"] is False
    assert len(state["red_flag_options"]) == 4

    # Consent first; an outdated version is refused.
    assert c.post("/me/checkins", headers=ph, json=answers).status_code == 403
    assert c.post("/me/consents", headers=ph, json={"purpose": "twin_tracking", "version": "old"}).status_code == 409
    version = state["consent"]["version"]
    assert c.post("/me/consents", headers=ph, json={"purpose": "twin_tracking", "version": version}).json()["granted"] is True

    # Check in, then edit the same day: still one row.
    r = c.post("/me/checkins", headers=ph, json=answers)
    assert r.status_code == 200 and r.json()["advice"] is None and r.json()["checkin"]["source"] == "app"
    r = c.post("/me/checkins", headers=ph, json={**answers, "pain": 6, "red_flags": ["fever"]})
    assert r.json()["checkin"]["pain"] == 6 and r.json()["advice"]["level"] == "urgent"
    state = c.get("/me/checkin", headers=ph, params={"day": today}).json()
    assert state["today"]["pain"] == 6 and state["advice"]["level"] == "urgent" and len(state["recent"]) == 1

    # Chest pain escalates to 112.
    r = c.post("/me/checkins", headers=ph, json={**answers, "red_flags": ["fever", "chest_breathless"]})
    assert r.json()["advice"]["call_number"] == "112"

    # Out-of-range answers and far-off days are refused.
    assert c.post("/me/checkins", headers=ph, json={**answers, "pain": 11}).status_code == 422
    assert c.post("/me/checkins", headers=ph, json={**answers, "day": (date.today() - timedelta(days=5)).isoformat()}).status_code == 400

    # The clinic sees the check-in in the twin and a red flag in its flags inbox.
    twin = c.get(f"/clinic/patients/{cp_id}/twin", headers=h).json()
    assert len(twin["checkins"]) == 1 and twin["checkins"][0]["red_flags"] == ["fever", "chest_breathless"]
    red = next(f for f in c.get("/clinic/flags", headers=h).json() if f["rule"] == "red_flag")
    assert red["clinic_patient_id"] == cp_id and red["severity"] == "act" and red["evidence"]["red_flags"] == ["fever", "chest_breathless"]

    # Withdrawing consent stops new check-ins.
    assert c.delete("/me/consents/twin_tracking", headers=ph).status_code == 204
    assert c.post("/me/checkins", headers=ph, json=answers).status_code == 403


def test_flag_flow(client):
    from sqlalchemy import select

    from app.models import CarePlan, Patient
    from app.models.twin import FlagStatus, TwinFlag
    from app.services.twin_rules import evaluate_all, evaluate_plan, local_today

    c, h, cp_id, ph, db = client
    today = local_today()
    plan = c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Right TKA", "protocol": "tka", "affected_side": "right"}).json()
    c.put(f"/clinic/care-plans/{plan['id']}/targets", headers=h, json=[{"code": "knee_flexion", "side": "right", "target_value": 120}])
    version = c.get("/me/checkin", headers=ph).json()["consent"]["version"]
    c.post("/me/consents", headers=ph, json={"purpose": "twin_tracking", "version": version})
    pid = c.get("/me/checkin", headers=ph).json()["plan"]["care_plan_id"]

    # A week of low pain (backdated), then 6 yesterday and 9 today.
    patient_id = db.scalar(select(Patient.id).where(Patient.full_name == "PNX TEST Twin Patient"))
    for d in range(9, 2, -1):
        db.add(DailyCheckin(patient_id=patient_id, care_plan_id=uuid.UUID(pid), day=today - timedelta(days=d), pain=3, stiffness=3,
                            swelling="mild", sleep="ok", exercises="all", red_flags=[], source="app"))
    db.flush()
    base = {"stiffness": 4, "swelling": "mild", "sleep": "ok", "exercises": "all"}
    c.post("/me/checkins", headers=ph, json={**base, "day": (today - timedelta(days=1)).isoformat(), "pain": 6})
    c.post("/me/checkins", headers=ph, json={**base, "day": today.isoformat(), "pain": 9})
    flags = c.get("/clinic/flags", headers=h).json()
    assert [(f["rule"], f["severity"]) for f in flags] == [("pain_high", "act"), ("pain_rising", "watch")]
    assert flags[0]["summary"].startswith("9/10 reported")

    # A red flag opens an act flag; a physio must close it, and the same day's report doesn't re-open it.
    c.post("/me/checkins", headers=ph, json={**base, "day": today.isoformat(), "pain": 9, "red_flags": ["fever"]})
    red = next(f for f in c.get("/clinic/flags", headers=h).json() if f["rule"] == "red_flag")
    assert c.post(f"/clinic/flags/{red['id']}/dismiss", headers=h, json={"note": ""}).status_code == 422  # needs a reason
    r = c.post(f"/clinic/flags/{red['id']}/resolve", headers=h, json={"note": "Called patient, GP visit booked"})
    assert r.json()["status"] == "resolved" and r.json()["resolved_by_name"] == "PNX TEST Physio"
    assert c.post(f"/clinic/flags/{red['id']}/resolve", headers=h, json={}).status_code == 409
    c.post("/me/checkins", headers=ph, json={**base, "day": today.isoformat(), "pain": 9, "red_flags": ["fever"]})
    assert "red_flag" not in [f["rule"] for f in c.get("/clinic/flags", headers=h).json()]

    # Dismissing quiets a condition flag while the condition persists.
    rising = next(f for f in c.get("/clinic/flags", headers=h).json() if f["rule"] == "pain_rising")
    c.post(f"/clinic/flags/{rising['id']}/dismiss", headers=h, json={"note": "Expected after manipulation under anaesthesia"})
    c.post("/me/checkins", headers=ph, json={**base, "day": today.isoformat(), "pain": 9})
    assert "pain_rising" not in [f["rule"] for f in c.get("/clinic/flags", headers=h).json()]

    # Knee readings: a plateau below target, then a drop.
    at = lambda d: (datetime.now(UTC) - timedelta(days=d)).isoformat()  # noqa: E731
    for d, v in [(8, 80), (4, 81), (0, 82)]:
        c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[{"code": "knee_flexion", "side": "right", "value": v, "measured_at": at(d)}])
    assert "rom_plateau:right" in [f["rule"] for f in c.get("/clinic/flags", headers=h).json()]
    c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[{"code": "knee_flexion", "side": "right", "value": 65}])
    rules = {f["rule"]: f for f in c.get("/clinic/flags", headers=h).json()}
    assert rules["rom_drop:right"]["severity"] == "act" and "rom_plateau:right" in rules

    # Acknowledged flags stay active, listed after unseen ones.
    c.post(f"/clinic/flags/{rules['pain_high']['id']}/acknowledge", headers=h)
    flags = c.get("/clinic/flags", headers=h).json()
    assert flags[-1]["rule"] == "pain_high" and flags[-1]["status"] == "acknowledged"

    # The plateau no longer holds (65 broke it): it resolves itself after 3 clear days; the twin shows it closed.
    plan_row = db.get(CarePlan, uuid.UUID(pid))
    evaluate_plan(db, plan_row, today + timedelta(days=3))
    db.flush()
    plateau = db.scalar(select(TwinFlag).where(TwinFlag.rule == "rom_plateau:right", TwinFlag.care_plan_id == uuid.UUID(pid)))
    assert plateau.status == FlagStatus.RESOLVED and plateau.resolved_by is None and "automatically" in plateau.resolution_note
    twin = c.get(f"/clinic/patients/{cp_id}/twin", headers=h).json()
    assert any(f["rule"] == "rom_plateau:right" and f["status"] == "resolved" for f in twin["flags"])
    assert any(f["rule"] == "red_flag" and f["status"] == "resolved" for f in c.get("/clinic/flags", headers=h, params={"state": "closed"}).json())

    # Daily cron evaluates active plans; ending the plan closes its flags.
    assert evaluate_all(db, today)["plans_evaluated"] >= 1
    c.post(f"/clinic/care-plans/{pid}/complete", headers=h)
    evaluate_all(db, today)
    db.flush()
    assert c.get("/clinic/flags", headers=h).json() == []

    # Other clinics can't touch flags.
    other = {**h, "X-Clinic-Id": str(uuid.uuid4())}
    assert c.post(f"/clinic/flags/{rules['rom_drop:right']['id']}/acknowledge", headers=other).status_code == 403


def test_suggestion_flow(client):
    from sqlalchemy import select

    from app.models import CarePlan, Exercise, Notification, Patient, PlanSuggestion
    from app.models.exercise import ExerciseCategory, ExerciseSource, ExerciseStatus, ExerciseVisibility
    from app.models.twin import SuggestionAuthor
    from app.services.suggestions import InvalidChange, check_changes
    from app.services.twin_rules import evaluate_plan, local_today

    c, h, cp_id, ph, db = client
    today = local_today()
    ex = []
    for name in ("Heel slides", "Quad sets"):
        e = Exercise(slug=f"pnx-twin-{uuid.uuid4().hex[:8]}", name=f"PNX TEST {name}", body_region="knee", category=ExerciseCategory.STRENGTH,
                     steps=["Step"], source=ExerciseSource.PLATFORM, visibility=ExerciseVisibility.PUBLIC, status=ExerciseStatus.PUBLISHED)
        db.add(e)
        db.flush()
        ex.append(str(e.id))
    plan = c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Right TKA", "protocol": "tka", "affected_side": "right"}).json()
    plan = c.put(f"/clinic/care-plans/{plan['id']}/exercises", headers=h, json=[
        {"exercise_id": ex[0], "sets": 3, "reps": 10}, {"exercise_id": ex[1], "sets": 2, "reps": 10}]).json()
    heel, quad = plan["exercises"][0]["id"], plan["exercises"][1]["id"]
    version = c.get("/me/checkin", headers=ph).json()["consent"]["version"]
    c.post("/me/consents", headers=ph, json={"purpose": "twin_tracking", "version": version})
    base = {"day": today.isoformat(), "stiffness": 4, "swelling": "mild", "sleep": "ok", "exercises": "all"}

    # Heel slides logged as hard, then high pain: suggest one set fewer on heel slides only.
    assert c.post("/me/exercise-logs", headers=ph, json={"plan_exercise_id": heel, "logged_on": today.isoformat(), "feel": "hard"}).status_code == 201
    c.post("/me/checkins", headers=ph, json={**base, "pain": 9})
    flag = next(f for f in c.get("/clinic/flags", headers=h).json() if f["rule"] == "pain_high")
    sug = flag["suggestion"]
    assert sug["author"] == "rules" and sug["title"] == "Reduce sets on 1 exercise" and not sug["stale"]
    assert [(x["plan_exercise_id"], x["field"], x["before"], x["after"]) for x in sug["changes"]] == [(heel, "sets", 3, 2)]
    assert sug["changes"][0]["exercise_name"] == "PNX TEST Heel slides"

    # Rules can never propose an increase.
    with pytest.raises(InvalidChange):
        check_changes(db, uuid.UUID(plan["id"]), [{"plan_exercise_id": heel, "field": "sets", "before": 3, "after": 4}], SuggestionAuthor.RULES)

    # The physio edits (down to 1 set) and approves: plan updated, flag resolved, patient told.
    r = c.post(f"/clinic/suggestions/{sug['id']}/approve", headers=h,
               json={"changes": [{"plan_exercise_id": heel, "field": "sets", "before": 3, "after": 1}], "note": "Ice after exercises"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["changes"][0]["after"] == 1 and r.json()["decided_by_name"] == "PNX TEST Physio"
    mine = c.get("/me/care-plans", headers=ph).json()[0]
    assert next(e for e in mine["exercises"] if e["id"] == heel)["sets"] == 1
    closed = next(f for f in c.get("/clinic/flags", headers=h, params={"state": "closed"}).json() if f["id"] == flag["id"])
    assert closed["resolution_note"] == "Plan change approved: Reduce sets on 1 exercise"
    patient_user = db.scalar(select(Patient.user_id).where(Patient.full_name == "PNX TEST Twin Patient"))
    note = db.scalar(select(Notification).where(Notification.user_id == patient_user, Notification.title == "Your physio updated your exercise program"))
    assert note.body == "PNX TEST Heel slides: 3 → 1 sets. Ice after exercises"
    assert c.post(f"/clinic/suggestions/{sug['id']}/approve", headers=h, json={}).status_code == 409

    # A red flag suggests pausing the program; if the plan changes first, approving expires it instead.
    c.post("/me/checkins", headers=ph, json={**base, "pain": 5, "red_flags": ["fever"]})
    red = next(f for f in c.get("/clinic/flags", headers=h).json() if f["rule"] == "red_flag")
    assert red["suggestion"]["title"] == "Pause home exercises until reviewed" and len(red["suggestion"]["changes"]) == 2
    c.put(f"/clinic/care-plans/{plan['id']}/exercises", headers=h, json=[{"exercise_id": ex[0], "sets": 1, "reps": 10}])  # quad sets removed
    assert next(f for f in c.get("/clinic/flags", headers=h).json() if f["rule"] == "red_flag")["suggestion"]["stale"] is True
    r = c.post(f"/clinic/suggestions/{red['suggestion']['id']}/approve", headers=h, json={})
    assert r.status_code == 409
    assert db.get(PlanSuggestion, uuid.UUID(red["suggestion"]["id"])).status.value == "expired"
    red = next(f for f in c.get("/clinic/flags", headers=h).json() if f["rule"] == "red_flag")
    assert red["status"] == "open" and red["suggestion"] is None  # the flag stays for the physio

    # A new red flag the next day re-opens it with a fresh suggestion; rejecting keeps the flag open.
    tomorrow = today + timedelta(days=1)
    plan_row = db.get(CarePlan, uuid.UUID(plan["id"]))
    c.post("/me/checkins", headers=ph, json={**base, "day": tomorrow.isoformat(), "pain": 5, "red_flags": ["wound_redness"]})
    evaluate_plan(db, plan_row, tomorrow)  # rules see tomorrow's check-in once it's tomorrow
    db.flush()
    red = next(f for f in c.get("/clinic/flags", headers=h).json() if f["rule"] == "red_flag")
    assert [x["plan_exercise_id"] for x in red["suggestion"]["changes"]] == [heel] and quad not in str(red["suggestion"])
    other = {**h, "X-Clinic-Id": str(uuid.uuid4())}
    assert c.post(f"/clinic/suggestions/{red['suggestion']['id']}/reject", headers=other, json={}).status_code == 403
    r = c.post(f"/clinic/suggestions/{red['suggestion']['id']}/reject", headers=h, json={"note": "Wound checked, fine to continue"})
    assert r.json()["status"] == "rejected"
    c.post("/me/checkins", headers=ph, json={**base, "day": tomorrow.isoformat(), "pain": 4, "red_flags": ["wound_redness"]})
    evaluate_plan(db, plan_row, tomorrow)
    db.flush()
    red = next(f for f in c.get("/clinic/flags", headers=h).json() if f["rule"] == "red_flag")
    assert red["status"] == "open" and red["suggestion"] is None  # not re-proposed for the same occurrence


def test_camera_validation_flow(client):
    from app.core.security import create_access_token
    from app.models import User
    from app.models.user import UserRole

    c, h, cp_id, _, db = client
    c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Right TKA", "protocol": "tka", "affected_side": "right"})
    base = {"code": "knee_flexion", "side": "right", "posture": "supine", "confidence": 0.93, "frames": 28, "spread": 2.1, "fps": 24.5,
            "model": "mediapipe-pose-full-f16-v1", "lighting": "good", "clothing": "shorts", "patient_consented": True}

    # Pairs: camera saved as an unvalidated estimate, goniometer as a normal clinic reading.
    r = c.post(f"/clinic/patients/{cp_id}/camera-measurements", headers=h, json={**base, "camera_value": 92.0, "camera_value_3d": 95.0, "goniometer_value": 90})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["difference"] == 2.0
    assert (out["camera"]["source"], out["camera"]["method"], out["camera"]["trusted"], out["camera"]["confidence"]) == ("camera", "camera_v1", False, 0.93)
    assert (out["goniometer"]["source"], out["goniometer"]["trusted"]) == ("clinic", True)
    for cam, gon in [(84.5, 86), (101.0, 98)]:
        c.post(f"/clinic/patients/{cp_id}/camera-measurements", headers=h, json={**base, "camera_value": cam, "goniometer_value": gon})

    # Camera readings never become clinical data, and the twin uses the goniometer.
    assert c.patch(f"/clinic/measurements/{out['camera']['id']}", headers=h, json={"trusted": True}).status_code == 409
    flex = next(m for m in c.get(f"/clinic/patients/{cp_id}/twin", headers=h).json()["measures"] if m["code"] == "knee_flexion")
    assert flex["latest"]["method"] == "goniometer" and flex["latest"]["value"] == 98

    # Consent is required; impossible angles are refused.
    assert c.post(f"/clinic/patients/{cp_id}/camera-measurements", headers=h, json={**base, "patient_consented": False, "camera_value": 90, "goniometer_value": 90}).status_code == 422
    assert c.post(f"/clinic/patients/{cp_id}/camera-measurements", headers=h, json={**base, "camera_value": 175, "goniometer_value": 90}).status_code == 422

    # Agreement: differences +2, −1.5, +3 → bias 1.2, SD 2.36, limits −3.5 … 5.8.
    v = c.get("/clinic/validation", headers=h).json()
    s = v["summary"][0]
    assert (s["code"], s["posture"], s["n"], s["patients"], s["bias"], s["sd"], s["lower"], s["upper"]) == ("knee_flexion", "supine", 3, 1, 1.2, 2.4, -3.5, 5.8)
    assert s["bias_3d"] is None  # only one pair has a 3D value
    assert len(v["pairs"]) == 3 and v["pairs"][0]["patient_name"] == "PNX TEST Twin Patient"

    # Physionexs-wide view for the Super Admin, without patient names.
    admin = User(full_name="PNX TEST Admin", email=f"pnx-twin-admin-{uuid.uuid4().hex[:8]}@test.physionexs.com", role=UserRole.SUPER_ADMIN, totp_enabled=True)
    db.add(admin)
    db.flush()
    ah = {"Authorization": f"Bearer {create_access_token(admin.id, admin.role.value)}"}
    allv = c.get("/admin/twin/validation", headers=ah).json()
    assert any(p["id"] == v["pairs"][0]["id"] and p["patient_name"] is None for p in allv["pairs"])
    assert c.get("/admin/twin/validation", headers=h).status_code == 403


def test_pilot_switch(client):
    from app.core.security import create_access_token
    from app.models import Clinic, User
    from app.models.user import UserRole

    c, h, cp_id, ph, db = client
    clinic = db.get(Clinic, uuid.UUID(h["X-Clinic-Id"]))
    plan = c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Right TKA", "protocol": "tka", "affected_side": "right"}).json()
    version = c.get("/me/checkin", headers=ph).json()["consent"]["version"]
    c.post("/me/consents", headers=ph, json={"purpose": "twin_tracking", "version": version})

    # Super Admin switches the pilot off for this clinic (audited action in Records → Clinics).
    admin = User(full_name="PNX TEST Admin", email=f"pnx-twin-admin-{uuid.uuid4().hex[:8]}@test.physionexs.com", role=UserRole.SUPER_ADMIN, totp_enabled=True)
    db.add(admin)
    db.flush()
    ah = {"Authorization": f"Bearer {create_access_token(admin.id, admin.role.value)}"}
    assert c.post(f"/admin/records/clinics/{clinic.id}/action", headers=ah, json={"action": "pilot_off"}).status_code == 200
    db.refresh(clinic)
    assert clinic.twin_pilot is False

    # Everything recovery-twin is refused or hidden for the clinic and its patients.
    assert c.get(f"/clinic/patients/{cp_id}/twin", headers=h).status_code == 403
    assert c.get("/clinic/flags", headers=h).status_code == 403
    assert c.get("/clinic/validation", headers=h).status_code == 403
    assert c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[{"code": "knee_flexion", "side": "right", "value": 90}]).status_code == 403
    assert c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Left TKA", "protocol": "tka"}).status_code == 403
    assert c.put(f"/clinic/care-plans/{plan['id']}", headers=h, json={"condition": "Right TKA", "goal": "Stairs"}).status_code == 200  # other edits still work
    assert c.get("/me/checkin", headers=ph).json()["eligible"] is False
    me = c.get("/auth/me", headers=h).json()
    assert me["memberships"][0]["twin_pilot"] is False

    # Switched back on, it all works again.
    c.post(f"/admin/records/clinics/{clinic.id}/action", headers=ah, json={"action": "pilot_on"})
    assert c.get(f"/clinic/patients/{cp_id}/twin", headers=h).status_code == 200
    assert c.get("/me/checkin", headers=ph).json()["eligible"] is True
    assert c.get("/auth/me", headers=h).json()["memberships"][0]["twin_pilot"] is True


def test_patient_recovery_view(client):
    from app.models import Clinic

    c, h, cp_id, ph, db = client
    assert c.get("/me/recovery", headers=ph).json() == {"available": False, "condition": None, "clinic_name": None, "surgery_date": None,
                                                         "weeks_since_surgery": None, "measures": [], "readings": [], "checkins": []}
    surgery = (date.today() - timedelta(days=21)).isoformat()
    plan = c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Right TKA", "protocol": "tka", "surgery_date": surgery, "affected_side": "right"}).json()
    c.put(f"/clinic/care-plans/{plan['id']}/targets", headers=h, json=[{"code": "knee_flexion", "side": "right", "target_value": 120, "by_week": 8}])
    at = lambda d: (datetime.now(UTC) - timedelta(days=d)).isoformat()  # noqa: E731
    c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[
        {"code": "knee_flexion", "side": "right", "value": 60, "measured_at": at(7), "note": "Guarding, apprehensive"},
        {"code": "pain_nprs", "side": "none", "value": 6, "method": "self_report", "measured_at": at(7)},
    ])
    c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[{"code": "knee_flexion", "side": "right", "value": 90}])
    held = c.post(f"/clinic/patients/{cp_id}/measurements", headers=h, json=[{"code": "knee_flexion", "side": "right", "value": 125}]).json()[0]
    assert held["trusted"] is False
    r = c.post(f"/clinic/patients/{cp_id}/camera-measurements", headers=h, json={
        "code": "knee_flexion", "side": "right", "posture": "supine", "camera_value": 88, "confidence": 0.9, "frames": 20, "spread": 1,
        "model": "mediapipe-pose-full-f16-v1", "goniometer_value": 91, "patient_consented": True})
    assert r.status_code == 201, r.text
    version = c.get("/me/checkin", headers=ph).json()["consent"]["version"]
    c.post("/me/consents", headers=ph, json={"purpose": "twin_tracking", "version": version})
    c.post("/me/checkins", headers=ph, json={"day": date.today().isoformat(), "pain": 4, "stiffness": 5, "swelling": "mild", "sleep": "ok", "exercises": "all"})

    r = c.get("/me/recovery", headers=ph).json()
    assert r["available"] and r["weeks_since_surgery"] == 3 and r["clinic_name"] == "PNX TEST Twin Clinic"
    flex = next(m for m in r["measures"] if m["code"] == "knee_flexion")
    assert (flex["label"], flex["latest"], flex["baseline"], flex["target"], flex["by_week"], flex["progress_pct"]) == ("Knee bend", 91, 60, 120, 8, 52)
    assert [m["code"] for m in r["measures"]] == ["knee_flexion", "knee_extension_lag"]  # no clinic pain score
    # Only confirmed clinic readings: not the held 125°, not the camera's 88°; and no notes.
    assert [x["value"] for x in r["readings"]] == [60, 90, 91]
    assert "note" not in str(r) and "Guarding" not in str(r)
    assert r["checkins"] == [{"day": date.today().isoformat(), "pain": 4, "stiffness": 5}]

    db.get(Clinic, uuid.UUID(h["X-Clinic-Id"])).twin_pilot = False
    db.flush()
    assert c.get("/me/recovery", headers=ph).json()["available"] is False
