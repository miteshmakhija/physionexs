"""Shared helpers for the practice console's clinical records."""

import secrets
import uuid
from datetime import UTC, date, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.clinic import Clinic, ClinicMember
from app.models.clinical import CarePlan, CarePlanExercise, Medication, TestOrder
from app.models.engagement import Notification
from app.models.exercise import Exercise, ExerciseMedia
from app.models.patient import ClinicPatient, Patient, Sex
from app.models.twin import CarePlanTarget
from app.models.user import User
from app.schemas.clinical import CarePlanOut, MedicationOut, PlanExerciseOut, TestOrderOut
from app.schemas.twin import TargetOut
from app.services.scope import check_patient

# Default reminder times for morning / afternoon / night doses (the design's 8:30 AM, 2:00 PM, 9:00 PM).
DOSE_SLOTS = ("08:30", "14:00", "21:00")


def reminder_times(frequency: str) -> list[str]:
    if frequency == "Once daily":
        return ["08:30"]
    if frequency == "Twice daily":
        return ["08:30", "21:00"]
    parts = frequency.split("-")
    if len(parts) == 3:
        return [slot for slot, n in zip(DOSE_SLOTS, parts) if n not in ("0", "")]
    return []  # SOS / weekly: no daily reminder


def age_of(dob: date | None, today: date | None = None) -> int | None:
    if dob is None:
        return None
    today = today or date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def dob_from_age(age: int | None, today: date | None = None) -> date | None:
    """Walk-ins usually give an age, not a birth date; store an approximate DOB."""
    if age is None:
        return None
    today = today or date.today()
    return date(today.year - age, 1, 1)


def ensure_clinic_patient(
    db: Session,
    clinic_id: uuid.UUID,
    *,
    patient_id: uuid.UUID | None = None,
    phone: str | None = None,
    full_name: str | None = None,
    age: int | None = None,
    sex: Sex | None = None,
    email: str | None = None,
    physio_id: uuid.UUID | None = None,
) -> ClinicPatient:
    """Find or create the patient (matched by phone) and their file at this clinic."""
    patient = None
    if patient_id:
        patient = db.get(Patient, patient_id)
        if patient is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    elif phone:
        # Prefer the record linked to an app account, then any record with this phone.
        patient = db.scalar(select(Patient).where(Patient.phone == phone).order_by(Patient.user_id.is_(None)).limit(1))
    if patient is None:
        if not full_name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter the patient's name")
        patient = Patient(full_name=full_name, phone=phone, email=email, sex=sex, date_of_birth=dob_from_age(age))
        db.add(patient)
        db.flush()
    else:
        if sex and not patient.sex:
            patient.sex = sex
        if age is not None and not patient.date_of_birth:
            patient.date_of_birth = dob_from_age(age)

    link = db.scalar(select(ClinicPatient).where(ClinicPatient.clinic_id == clinic_id, ClinicPatient.patient_id == patient.id))
    if link is None:
        link = ClinicPatient(clinic_id=clinic_id, patient_id=patient.id, primary_physio_id=physio_id, first_visit_on=date.today())
        db.add(link)
        db.flush()
    return link


def clinic_patient_or_404(db: Session, who: ClinicMember | uuid.UUID, clinic_patient_id: uuid.UUID) -> ClinicPatient:
    """The clinic's patient file. Given a team member (not just a clinic id), also enforces their branch scope."""
    clinic_id = who.clinic_id if isinstance(who, ClinicMember) else who
    cp = db.get(ClinicPatient, clinic_patient_id)
    if cp is None or cp.clinic_id != clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    if isinstance(who, ClinicMember):
        check_patient(db, who, cp)
    return cp


def care_plan_or_404(db: Session, who: ClinicMember | uuid.UUID, plan_id: uuid.UUID) -> CarePlan:
    clinic_id = who.clinic_id if isinstance(who, ClinicMember) else who
    plan = db.get(CarePlan, plan_id)
    cp = db.get(ClinicPatient, plan.clinic_patient_id) if plan else None
    if cp is None or cp.clinic_id != clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Care plan not found")
    if isinstance(who, ClinicMember):
        check_patient(db, who, cp)
    return plan


def is_clinic_physio(db: Session, clinic_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return db.scalar(select(ClinicMember.id).where(ClinicMember.clinic_id == clinic_id, ClinicMember.user_id == user_id, ClinicMember.is_active.is_(True))) is not None


def plan_out(db: Session, plan: CarePlan) -> CarePlanOut:
    physio = db.get(User, plan.physio_user_id)
    clinic = db.get(Clinic, db.get(ClinicPatient, plan.clinic_patient_id).clinic_id)
    rows = db.execute(
        select(CarePlanExercise, Exercise)
        .join(Exercise, Exercise.id == CarePlanExercise.exercise_id)
        .where(CarePlanExercise.care_plan_id == plan.id, CarePlanExercise.is_active.is_(True))
        .order_by(CarePlanExercise.position)
    ).all()
    thumbs = _thumbnails(db, [e.id for _, e in rows])
    meds = db.scalars(select(Medication).where(Medication.care_plan_id == plan.id, Medication.is_active.is_(True)).order_by(Medication.created_at))
    tests = db.scalars(select(TestOrder).where(TestOrder.care_plan_id == plan.id).order_by(TestOrder.created_at))
    return CarePlanOut(
        id=plan.id,
        status=plan.status,
        starts_on=plan.starts_on,
        condition=plan.condition,
        condition_detail=plan.condition_detail,
        goal=plan.goal,
        stage=plan.stage,
        notes=plan.notes,
        sessions_planned=plan.sessions_planned,
        ends_on=plan.ends_on,
        protocol=plan.protocol,
        surgery_date=plan.surgery_date,
        affected_side=plan.affected_side,
        targets=targets_out(db, plan.id),
        physio_name=physio.full_name,
        clinic_name=clinic.name,
        exercises=[
            PlanExerciseOut(
                id=pe.id, exercise_id=e.id, name=e.name, body_region=e.body_region, dose_unit=e.dose_unit,
                sets=pe.sets, reps=pe.reps, hold_seconds=pe.hold_seconds, rest_seconds=pe.rest_seconds,
                frequency=pe.frequency, times_per_day=pe.times_per_day, notes=pe.notes, thumbnail_url=thumbs.get(e.id),
            )
            for pe, e in rows
        ],
        medications=[
            MedicationOut(id=m.id, name=m.name, dose=m.dose, frequency=m.frequency, timing=m.timing, duration_days=m.duration_days,
                          instructions=m.instructions, reminder_times=m.reminder_times or [], starts_on=m.starts_on)
            for m in meds
        ],
        tests=[TestOrderOut(id=t.id, name=t.name, status=t.status, result_note=t.result_note, created_at=t.created_at, result_at=t.result_at) for t in tests],
    )


def notify_plan_update(db: Session, plan: CarePlan, title: str, body: str | None = None) -> None:
    """In-app notification to the patient that their plan changed."""
    patient = db.get(Patient, db.get(ClinicPatient, plan.clinic_patient_id).patient_id)
    if patient.user_id:
        db.add(Notification(user_id=patient.user_id, kind="plan_updated", title=title, body=body or plan.condition, data={"care_plan_id": str(plan.id)}))


def targets_out(db: Session, plan_id: uuid.UUID) -> list[TargetOut]:
    rows = db.scalars(select(CarePlanTarget).where(CarePlanTarget.care_plan_id == plan_id).order_by(CarePlanTarget.code, CarePlanTarget.side))
    return [TargetOut(id=t.id, code=t.code, side=t.side, target_value=float(t.target_value), by_week=t.by_week) for t in rows]


def _thumbnails(db: Session, exercise_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not exercise_ids:
        return {}
    out: dict[uuid.UUID, str] = {}
    for m in db.scalars(select(ExerciseMedia).where(ExerciseMedia.exercise_id.in_(exercise_ids)).order_by(ExerciseMedia.position)):
        out.setdefault(m.exercise_id, m.thumbnail_url or m.url)
    return out


def exercise_detail_text(sets: int, reps: int | None, hold: int | None, frequency: str) -> str:
    dose = f"{sets} × {reps}" if reps else f"{sets} × {hold}s hold"
    return f"{dose} · {frequency.replace('_', ' ')}"


def new_rx_no(now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    return f"RX-{now:%Y%m}-{secrets.token_hex(3).upper()}"
