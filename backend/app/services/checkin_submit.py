"""Saving a daily check-in, shared by the patient apps and WhatsApp so both follow exactly the same path:
one row per patient per day (re-submitting edits it), physio notified of new red flags, flag rules re-run.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.clinic import Clinic
from app.models.clinical import CarePlan
from app.models.patient import ClinicPatient, Patient
from app.models.twin import CheckinSource, DailyCheckin
from app.schemas.twin import AdviceOut, CheckinIn
from app.services.checkins import advice_for, notify_physio
from app.services.twin_rules import evaluate_plan


def clinic_of(db: Session, plan: CarePlan) -> Clinic:
    return db.get(Clinic, db.get(ClinicPatient, plan.clinic_patient_id).clinic_id)


def save_checkin(db: Session, patient: Patient, plan: CarePlan, body: CheckinIn, source: CheckinSource) -> tuple[DailyCheckin, AdviceOut | None]:
    """Insert or update the day's check-in inside the caller's transaction (the caller commits)."""
    flags = list(dict.fromkeys(body.red_flags))
    c = db.scalar(select(DailyCheckin).where(DailyCheckin.patient_id == patient.id, DailyCheckin.day == body.day).with_for_update())
    new_flags = [f for f in flags if c is None or f not in (c.red_flags or [])]
    fields = body.model_dump(exclude={"day", "red_flags"}) | {"red_flags": flags, "care_plan_id": plan.id}
    if c is None:
        c = DailyCheckin(patient_id=patient.id, day=body.day, source=source, **fields)
        db.add(c)
    else:
        for k, v in fields.items():
            setattr(c, k, v)
    if new_flags:
        notify_physio(db, plan, patient, new_flags)
    db.flush()
    evaluate_plan(db, plan)
    return c, advice_for(flags, clinic_of(db, plan))
