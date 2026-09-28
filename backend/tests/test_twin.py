"""Digital twin, milestone A1: measurements, targets and the twin view.

Unit tests always run. The API test is opt-in (PNX_INTEGRATION=1) and runs inside one database transaction that is
rolled back at the end, so it leaves nothing behind — safe even on a shared database.
"""

import os
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.models.twin import Side
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


# ── API (rolled back) ───────────────────────────────────────────────────────


@pytest.fixture
def client():
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
    clinic = Clinic(name="PNX TEST Twin Clinic", slug=f"pnx-twin-{tag}", owner_user_id=physio.id)
    db.add(clinic)
    db.flush()
    db.add(ClinicMember(clinic_id=clinic.id, user_id=physio.id, role=MembershipRole.OWNER))
    patient = Patient(full_name="PNX TEST Twin Patient")
    db.add(patient)
    db.flush()
    cp = ClinicPatient(clinic_id=clinic.id, patient_id=patient.id)
    db.add(cp)
    db.flush()

    app.dependency_overrides[get_db] = lambda: db
    h = {"Authorization": f"Bearer {create_access_token(physio.id, physio.role.value)}", "X-Clinic-Id": str(clinic.id)}
    try:
        yield TestClient(app), h, str(cp.id)
    finally:
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        conn.close()


def test_twin_flow(client):
    c, h, cp_id = client

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
