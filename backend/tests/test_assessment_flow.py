"""Structured assessment on consultations: red-flag screening gates signing.

Opt-in (PNX_INTEGRATION=1), rolled back.
"""

import os
import uuid
from datetime import date

import pytest

pytestmark = pytest.mark.skipif(os.getenv("PNX_INTEGRATION") != "1", reason="set PNX_INTEGRATION=1 to run")


@pytest.fixture
def env():
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
    db = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    physio = User(full_name="PNX TEST Physio", email=f"pnx-assess-{tag}@test.physionexs.com", role=UserRole.PHYSIO)
    db.add(physio)
    db.flush()
    clinic = Clinic(name="PNX TEST Assessment Clinic", slug=f"pnx-assess-{tag}", owner_user_id=physio.id)
    db.add(clinic)
    db.flush()
    db.add(ClinicMember(clinic_id=clinic.id, user_id=physio.id, role=MembershipRole.OWNER))
    patient = Patient(full_name="PNX TEST Assessment Patient", phone="+919876509876", date_of_birth=date(1980, 1, 1))
    db.add(patient)
    db.flush()
    cp = ClinicPatient(clinic_id=clinic.id, patient_id=patient.id)
    db.add(cp)
    db.flush()
    app.dependency_overrides[get_db] = lambda: db
    h = {"Authorization": f"Bearer {create_access_token(physio.id, physio.role.value)}", "X-Clinic-Id": str(clinic.id)}
    try:
        yield TestClient(app), h, str(cp.id), clinic, db
    finally:
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        conn.close()


def test_red_flag_screening_gates_signing(env):
    c, h, cp_id, _clinic, _db = env
    form = c.get("/clinic/assessment-form", headers=h).json()
    codes = [f["code"] for f in form["red_flags"]]
    assert len(codes) == 12 and form["version"] == 1

    # Draft with incomplete screening is fine; signing it isn't.
    draft = c.post(f"/clinic/patients/{cp_id}/consultations", headers=h,
                   json={"subjective": "Low back pain", "assessment_form": {"visit_type": "initial", "red_flags": {"fever": "no"}}})
    assert draft.status_code == 201, draft.text
    note = draft.json()
    assert note["title"] == "Initial assessment" and note["red_flags"] == []
    r = c.put(f"/clinic/consultations/{note['id']}", headers=h, json={"sign": True})
    assert r.status_code == 422 and "Red-flag screening" in r.json()["detail"]

    # A positive flag needs a referral / review action.
    flags = {code: "no" for code in codes} | {"bladder_bowel": "yes"}
    r = c.put(f"/clinic/consultations/{note['id']}", headers=h, json={"assessment_form": {"visit_type": "initial", "red_flags": flags}, "sign": True})
    assert r.status_code == 422 and "referral" in r.json()["detail"]
    r = c.put(f"/clinic/consultations/{note['id']}", headers=h,
              json={"assessment_form": {"visit_type": "initial", "red_flags": flags, "red_flag_action": "referred", "red_flag_note": "Urgent ortho"}, "sign": True})
    assert r.status_code == 200, r.text
    assert r.json()["signed_at"] and r.json()["red_flags"] == ["bladder_bowel"]

    # Unknown flag codes are rejected; follow-ups don't need screening; plain SOAP notes still work.
    bad = c.post(f"/clinic/patients/{cp_id}/consultations", headers=h, json={"assessment_form": {"visit_type": "initial", "red_flags": {"nope": "no"}}})
    assert bad.status_code == 422
    fu = c.post(f"/clinic/patients/{cp_id}/consultations", headers=h, json={"assessment_form": {"visit_type": "follow_up"}, "sign": True})
    assert fu.status_code == 201 and fu.json()["title"] == "Follow-up"
    plain = c.post(f"/clinic/patients/{cp_id}/consultations", headers=h, json={"subjective": "Quick note", "sign": True})
    assert plain.status_code == 201 and plain.json()["assessment_form"] is None

    file = c.get(f"/clinic/patients/{cp_id}", headers=h).json()
    assert sorted(x["red_flags"] != [] for x in file["consultations"]) == [False, False, True]


KNEE_SECTIONS = {
    "visit": {"body_region": "knee", "side": "right"},
    "rom": {"degrees": {"flexion": {"right": 95}, "extension": {"right": 8}}},
    "strength": {"mrc": {"extension": {"right": 3}}},
}
ALL_NO = {code: "no" for code in ("weight_loss", "fever", "night_pain", "major_trauma", "cancer_history", "progressive_neuro", "bladder_bowel",
                                  "unexplained_weakness", "sensation_loss", "dizziness_syncope", "chest_breathless", "other")}


def test_signed_knee_assessment_feeds_recovery_twin(env):
    from sqlalchemy import select

    from app.models.twin import Measurement

    c, h, cp_id, clinic, db = env
    form = {"visit_type": "initial", "red_flags": ALL_NO, "sections": KNEE_SECTIONS}

    # Not a pilot clinic: signing works, nothing is recorded.
    r = c.post(f"/clinic/patients/{cp_id}/consultations", headers=h, json={"assessment_form": form, "sign": True})
    assert r.status_code == 201, r.text
    assert db.scalars(select(Measurement).where(Measurement.clinic_patient_id == cp_id)).all() == []

    clinic.twin_pilot = True
    db.flush()
    # Drafts don't record; signing does, once, linked to the note.
    draft = c.post(f"/clinic/patients/{cp_id}/consultations", headers=h, json={"assessment_form": form}).json()
    assert db.scalars(select(Measurement).where(Measurement.clinic_patient_id == cp_id)).all() == []
    r = c.put(f"/clinic/consultations/{draft['id']}", headers=h, json={"sign": True})
    assert r.status_code == 200, r.text
    rows = db.scalars(select(Measurement).where(Measurement.clinic_patient_id == cp_id)).all()
    assert sorted((m.code, m.side.value, float(m.value), str(m.consultation_id) == draft["id"]) for m in rows) == [
        ("knee_extension_lag", "right", 8.0, True), ("knee_extension_mrc", "right", 3.0, True), ("knee_flexion", "right", 95.0, True),
    ]
    twin = c.get(f"/clinic/patients/{cp_id}/twin", headers=h).json()
    assert {m["code"] for m in twin["measures"]} >= {"knee_flexion", "knee_extension_lag", "knee_extension_mrc"}

    # An impossible value blocks the sign and nothing is saved.
    bad = {**form, "sections": {**KNEE_SECTIONS, "rom": {"degrees": {"flexion": {"right": 175}}}}}
    r = c.post(f"/clinic/patients/{cp_id}/consultations", headers=h, json={"assessment_form": bad, "sign": True})
    assert r.status_code == 422 and "Knee flexion" in r.json()["detail"]
