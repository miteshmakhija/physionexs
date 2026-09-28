"""Patient app: consent and the daily recovery check-in (milestone A2 of docs/digital-twin/A-knee-twin.md)."""

from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import DB, require_roles
from app.models.clinic import Clinic
from app.models.patient import ClinicPatient, Patient
from app.models.twin import CheckinSource, Consent, DailyCheckin
from app.models.user import User, UserRole
from app.schemas.twin import CheckinIn, CheckinPlanOut, CheckinResultOut, CheckinStateOut, ConsentIn, ConsentStateOut
from app.services import audit
from app.services.checkins import (
    CONSENTS,
    TWIN_TRACKING,
    active_consent,
    advice_for,
    checkin_out,
    consent_state,
    eligible_plan,
    notify_physio,
    red_flag_options,
    withdraw,
)
from app.services.twin_rules import evaluate_plan

router = APIRouter(prefix="/me", tags=["checkins"])

PatientUser = Annotated[User, Depends(require_roles(UserRole.PATIENT))]
# Clients send the patient's local date; accept yesterday..tomorrow to allow for timezones.
DATE_SLACK = timedelta(days=1)


def _patient(db: Session, user: User) -> Patient:
    p = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient profile not found")
    return p


def _clinic_of(db: Session, clinic_patient_id) -> Clinic:
    return db.get(Clinic, db.get(ClinicPatient, clinic_patient_id).clinic_id)


@router.get("/checkin", response_model=CheckinStateOut)
def checkin_state(user: PatientUser, db: DB, day: Annotated[date | None, Query()] = None) -> CheckinStateOut:
    """State of today's check-in card: whether it applies, consent, today's answers and any safety advice."""
    patient = _patient(db, user)
    day = day or date.today()
    plan = eligible_plan(db, patient.id)
    consent = consent_state(active_consent(db, patient.id, TWIN_TRACKING))
    if plan is None:
        return CheckinStateOut(eligible=False, plan=None, consent=consent, today=None, advice=None, recent=[], red_flag_options=red_flag_options())
    clinic = _clinic_of(db, plan.clinic_patient_id)
    rows = list(db.scalars(
        select(DailyCheckin).where(DailyCheckin.patient_id == patient.id, DailyCheckin.day <= day, DailyCheckin.day > day - timedelta(days=7))
        .order_by(DailyCheckin.day.desc())
    ))
    today = next((c for c in rows if c.day == day), None)
    return CheckinStateOut(
        eligible=True,
        plan=CheckinPlanOut(care_plan_id=plan.id, condition=plan.condition, clinic_name=clinic.name),
        consent=consent,
        today=checkin_out(today) if today else None,
        advice=advice_for(today.red_flags or [], clinic) if today else None,
        recent=[checkin_out(c) for c in rows],
        red_flag_options=red_flag_options(),
    )


@router.post("/consents", response_model=ConsentStateOut, status_code=status.HTTP_201_CREATED)
def grant_consent(body: ConsentIn, user: PatientUser, db: DB, request: Request) -> ConsentStateOut:
    patient = _patient(db, user)
    if body.version != CONSENTS[body.purpose]["version"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "The consent text has changed. Please review it again.")
    current = active_consent(db, patient.id, body.purpose)
    if current and current.version == body.version:
        return consent_state(current, body.purpose)
    if current:
        withdraw(current)  # superseded by the new version
        db.flush()
    consent = Consent(patient_id=patient.id, purpose=body.purpose, version=body.version)
    db.add(consent)
    db.flush()
    audit.record(db, action="consent", entity="consent", entity_id=consent.id, actor_user_id=user.id, summary=f"{body.purpose} {body.version}", request=request)
    db.commit()
    return consent_state(consent, body.purpose)


@router.delete("/consents/{purpose}", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_consent(purpose: Literal["twin_tracking"], user: PatientUser, db: DB, request: Request) -> None:
    patient = _patient(db, user)
    current = active_consent(db, patient.id, purpose)
    if current:
        withdraw(current)
        audit.record(db, action="withdraw", entity="consent", entity_id=current.id, actor_user_id=user.id, summary=purpose, request=request)
        db.commit()


@router.post("/checkins", response_model=CheckinResultOut)
def submit_checkin(
    body: CheckinIn,
    user: PatientUser,
    db: DB,
    x_client: Annotated[str | None, Header(alias="X-Client")] = None,
) -> CheckinResultOut:
    """Save the day's check-in (re-submitting the same day edits it). Red flags return fixed safety advice at once."""
    if abs(body.day - date.today()) > DATE_SLACK:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can only check in for today")
    patient = _patient(db, user)
    plan = eligible_plan(db, patient.id)
    if plan is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Daily check-ins aren't turned on for your care plan")
    consent = active_consent(db, patient.id, TWIN_TRACKING)
    if consent is None or consent.version != CONSENTS[TWIN_TRACKING]["version"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "consent_required")

    flags = list(dict.fromkeys(body.red_flags))
    c = db.scalar(select(DailyCheckin).where(DailyCheckin.patient_id == patient.id, DailyCheckin.day == body.day).with_for_update())
    new_flags = [f for f in flags if c is None or f not in (c.red_flags or [])]
    fields = body.model_dump(exclude={"day", "red_flags"}) | {"red_flags": flags, "care_plan_id": plan.id}
    if c is None:
        c = DailyCheckin(patient_id=patient.id, day=body.day, source=CheckinSource.WEB if x_client == "web" else CheckinSource.APP, **fields)
        db.add(c)
    else:
        for k, v in fields.items():
            setattr(c, k, v)
    if new_flags:
        notify_physio(db, plan, patient, new_flags)
    try:
        db.flush()
        evaluate_plan(db, plan)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Check-in already saved — please refresh")
    db.refresh(c)
    return CheckinResultOut(checkin=checkin_out(c), advice=advice_for(flags, _clinic_of(db, plan.clinic_patient_id)))
