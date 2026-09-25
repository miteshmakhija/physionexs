"""Patient app: care plans, today's exercises & medicines, logging and progress."""

import uuid
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import DB, require_roles
from app.models.clinical import (
    CarePlan,
    CarePlanExercise,
    CarePlanStatus,
    Consultation,
    ExerciseLog,
    Medication,
    MedicationLog,
    Prescription,
)
from app.models.exercise import Exercise, ExerciseMedia
from app.models.patient import ClinicPatient, Patient
from app.models.user import User, UserRole
from app.schemas.clinical import (
    CarePlanOut,
    DoseLogIn,
    ExerciseLogIn,
    ExerciseLogOut,
    PrescriptionOut,
    ProgressDay,
    ProgressOut,
    TodayDose,
    TodayExercise,
    TodayOut,
)
from app.services.adherence import day_stats, refresh_streak_and_reward, scheduled_times
from app.services.clinical import plan_out

router = APIRouter(prefix="/me", tags=["care"])

PatientUser = Annotated[User, Depends(require_roles(UserRole.PATIENT))]
# Clients send the patient's local date; accept yesterday..tomorrow to allow for timezones.
DATE_SLACK = timedelta(days=1)


def _patient(db: Session, user: User) -> Patient:
    p = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient profile not found")
    return p


def _check_day(day: date) -> None:
    if abs(day - date.today()) > DATE_SLACK:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can only log for today")


def _active_plans(db: Session, patient: Patient) -> list[CarePlan]:
    return list(
        db.scalars(
            select(CarePlan)
            .join(ClinicPatient, ClinicPatient.id == CarePlan.clinic_patient_id)
            .where(ClinicPatient.patient_id == patient.id, CarePlan.status == CarePlanStatus.ACTIVE)
            .order_by(CarePlan.created_at.desc())
        )
    )


def _own_plan_exercise(db: Session, patient: Patient, pe_id: uuid.UUID) -> tuple[CarePlanExercise, CarePlan]:
    row = db.execute(
        select(CarePlanExercise, CarePlan)
        .join(CarePlan, CarePlan.id == CarePlanExercise.care_plan_id)
        .join(ClinicPatient, ClinicPatient.id == CarePlan.clinic_patient_id)
        .where(CarePlanExercise.id == pe_id, ClinicPatient.patient_id == patient.id, CarePlan.status == CarePlanStatus.ACTIVE)
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not in your active plan")
    return row[0], row[1]


@router.get("/care-plans", response_model=list[CarePlanOut])
def my_plans(user: PatientUser, db: DB) -> list[CarePlanOut]:
    return [plan_out(db, p) for p in _active_plans(db, _patient(db, user))]


@router.get("/today", response_model=TodayOut)
def today(user: PatientUser, db: DB, day: date | None = None) -> TodayOut:
    patient = _patient(db, user)
    day = day or date.today()
    _check_day(day)
    plans = _active_plans(db, patient)
    plan_ids = [p.id for p in plans]
    starts = {p.id: p.starts_on for p in plans}

    exercises: list[TodayExercise] = []
    if plan_ids:
        rows = db.execute(
            select(CarePlanExercise, Exercise)
            .join(Exercise, Exercise.id == CarePlanExercise.exercise_id)
            .where(CarePlanExercise.care_plan_id.in_(plan_ids), CarePlanExercise.is_active.is_(True))
            .order_by(CarePlanExercise.care_plan_id, CarePlanExercise.position)
        ).all()
        done = dict(
            db.execute(
                select(ExerciseLog.plan_exercise_id, func.count())
                .where(ExerciseLog.plan_exercise_id.in_([pe.id for pe, _ in rows] or [uuid.uuid4()]), ExerciseLog.logged_on == day)
                .group_by(ExerciseLog.plan_exercise_id)
            ).all()
        )
        media = _media(db, [e.id for _, e in rows])
        for pe, e in rows:
            n = scheduled_times(pe, max(starts[pe.care_plan_id], pe.created_at.date()), day)
            if n == 0:
                continue
            exercises.append(
                TodayExercise(
                    plan_exercise_id=pe.id, exercise_id=e.id, name=e.name, body_region=e.body_region, sets=pe.sets, reps=pe.reps,
                    hold_seconds=pe.hold_seconds, rest_seconds=pe.rest_seconds, dose_unit=e.dose_unit, notes=pe.notes,
                    steps=e.steps or [], cues=e.cues, precautions=e.precautions, media=media.get(e.id, []),
                    scheduled=n, done=min(n, done.get(pe.id, 0)),
                )
            )

    doses = _doses(db, patient, plan_ids, day)
    ex_sched = sum(e.scheduled for e in exercises)
    return TodayOut(
        day=day,
        exercises=exercises,
        doses=doses,
        exercise_pct=None if not ex_sched else round(100 * sum(e.done for e in exercises) / ex_sched),
        dose_pct=None if not doses else round(100 * sum(d.taken for d in doses) / len(doses)),
        streak_days=patient.current_streak_days,
    )


def _media(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    out: dict[uuid.UUID, list[dict]] = {}
    if ids:
        for m in db.scalars(select(ExerciseMedia).where(ExerciseMedia.exercise_id.in_(ids)).order_by(ExerciseMedia.position)):
            out.setdefault(m.exercise_id, []).append({"kind": m.kind.value, "url": m.url, "thumbnail_url": m.thumbnail_url})
    return out


def _doses(db: Session, patient: Patient, plan_ids: list[uuid.UUID], day: date) -> list[TodayDose]:
    if not plan_ids:
        return []
    meds = list(db.scalars(select(Medication).where(Medication.care_plan_id.in_(plan_ids), Medication.is_active.is_(True)).order_by(Medication.created_at)))
    taken = {
        (m_id, slot)
        for m_id, slot in db.execute(
            select(MedicationLog.medication_id, MedicationLog.dose_slot).where(MedicationLog.patient_id == patient.id, MedicationLog.logged_on == day)
        ).all()
    }
    doses = []
    for m in meds:
        if day < m.starts_on or (m.duration_days and day >= m.starts_on + timedelta(days=m.duration_days)):
            continue
        for slot in m.reminder_times or []:
            doses.append(TodayDose(medication_id=m.id, name=m.name, dose=m.dose, timing=m.timing, slot=slot, taken=(m.id, slot) in taken))
    return sorted(doses, key=lambda d: d.slot)


@router.post("/exercise-logs", response_model=ExerciseLogOut, status_code=status.HTTP_201_CREATED)
def log_exercise(body: ExerciseLogIn, user: PatientUser, db: DB) -> ExerciseLogOut:
    _check_day(body.logged_on)
    patient = db.scalar(select(Patient).where(Patient.user_id == user.id).with_for_update())
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient profile not found")
    pe, plan = _own_plan_exercise(db, patient, body.plan_exercise_id)
    scheduled = scheduled_times(pe, max(plan.starts_on, pe.created_at.date()), body.logged_on)
    done = db.scalar(select(func.count()).select_from(ExerciseLog).where(ExerciseLog.plan_exercise_id == pe.id, ExerciseLog.logged_on == body.logged_on)) or 0
    if scheduled and done >= scheduled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already logged for today")
    db.add(ExerciseLog(plan_exercise_id=pe.id, patient_id=patient.id, **body.model_dump(exclude={"plan_exercise_id"})))
    db.flush()
    awarded = refresh_streak_and_reward(db, patient, body.logged_on)
    db.commit()
    return ExerciseLogOut(done=done + 1, scheduled=scheduled, streak_days=patient.current_streak_days, points_awarded=sum(awarded))


@router.delete("/exercise-logs/{plan_exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
def undo_exercise(plan_exercise_id: uuid.UUID, logged_on: date, user: PatientUser, db: DB) -> None:
    """Undo the latest completion (for mis-taps). Points already awarded are kept."""
    _check_day(logged_on)
    patient = _patient(db, user)
    pe, _ = _own_plan_exercise(db, patient, plan_exercise_id)
    last = db.scalar(select(ExerciseLog).where(ExerciseLog.plan_exercise_id == pe.id, ExerciseLog.logged_on == logged_on).order_by(ExerciseLog.logged_at.desc()).limit(1))
    if last:
        db.delete(last)
        db.flush()
        refresh_streak_and_reward(db, patient, logged_on)
        db.commit()


@router.post("/dose-logs", status_code=status.HTTP_201_CREATED)
def log_dose(body: DoseLogIn, user: PatientUser, db: DB) -> dict:
    _check_day(body.logged_on)
    patient = _patient(db, user)
    med = db.get(Medication, body.medication_id)
    if med is None or med.care_plan_id not in {p.id for p in _active_plans(db, patient)} or body.dose_slot not in (med.reminder_times or []):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dose not in your plan")
    try:
        with db.begin_nested():
            db.add(MedicationLog(medication_id=med.id, patient_id=patient.id, logged_on=body.logged_on, dose_slot=body.dose_slot))
    except IntegrityError:
        pass  # already logged — idempotent
    db.commit()
    return {"ok": True}


@router.delete("/dose-logs", status_code=status.HTTP_204_NO_CONTENT)
def undo_dose(medication_id: uuid.UUID, logged_on: date, dose_slot: str, user: PatientUser, db: DB) -> None:
    patient = _patient(db, user)
    db.execute(delete(MedicationLog).where(MedicationLog.patient_id == patient.id, MedicationLog.medication_id == medication_id, MedicationLog.logged_on == logged_on, MedicationLog.dose_slot == dose_slot))
    db.commit()


@router.get("/progress", response_model=ProgressOut)
def progress(user: PatientUser, db: DB, range_: Annotated[Literal["week", "month"], Query(alias="range")] = "week") -> ProgressOut:
    patient = _patient(db, user)
    end = date.today()
    start = end - timedelta(days=6 if range_ == "week" else 29)
    stats = day_stats(db, patient.id, start, end)
    pain_rows = db.execute(
        select(ExerciseLog.logged_on, func.avg(ExerciseLog.pain))
        .where(ExerciseLog.patient_id == patient.id, ExerciseLog.pain.is_not(None), ExerciseLog.logged_on >= start)
        .group_by(ExerciseLog.logged_on)
    ).all()
    pain = {d: round(float(v), 1) for d, v in pain_rows}
    clinic_pains = [
        c.pain_vas
        for c in db.scalars(
            select(Consultation).join(ClinicPatient, ClinicPatient.id == Consultation.clinic_patient_id)
            .where(ClinicPatient.patient_id == patient.id, Consultation.pain_vas.is_not(None)).order_by(Consultation.created_at)
        )
    ]
    series = [pain[d] for d in sorted(pain)]
    plan_ids = [p.id for p in _active_plans(db, patient)]
    unlogged = sum(1 for d in _doses(db, patient, plan_ids, end) if not d.taken)
    scheduled = sum(s.scheduled for s in stats)
    return ProgressOut(
        days=[ProgressDay(day=s.day, scheduled=s.scheduled, done=s.done, pct=s.pct, pain=pain.get(s.day)) for s in stats],
        adherence_pct=None if not scheduled else round(100 * sum(s.done for s in stats) / scheduled),
        streak_days=patient.current_streak_days,
        best_streak_days=patient.best_streak_days,
        pain_now=series[-1] if series else (clinic_pains[-1] if clinic_pains else None),
        pain_start=clinic_pains[0] if clinic_pains else (series[0] if series else None),
        unlogged_doses_today=unlogged,
    )


@router.get("/prescriptions", response_model=list[PrescriptionOut])
def my_prescriptions(user: PatientUser, db: DB) -> list[PrescriptionOut]:
    patient = _patient(db, user)
    rows = db.scalars(
        select(Prescription).join(ClinicPatient, ClinicPatient.id == Prescription.clinic_patient_id)
        .where(ClinicPatient.patient_id == patient.id).order_by(Prescription.issued_at.desc())
    )
    return [PrescriptionOut(id=r.id, rx_no=r.rx_no, issued_at=r.issued_at, snapshot=r.snapshot) for r in rows]
