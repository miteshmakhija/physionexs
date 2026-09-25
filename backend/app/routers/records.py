"""Practice console: patient files, consultations, care plans and prescribing."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser, require_clinic_member
from app.models.clinic import Branch, Clinic, ClinicMember, MembershipRole, PhysioProfile
from app.models.clinical import (
    CarePlan,
    CarePlanExercise,
    CarePlanStatus,
    Consultation,
    Medication,
    Prescription,
    TestOrder,
    TestOrderStatus,
)
from app.models.engagement import Notification
from app.models.exercise import Exercise, ExerciseStatus, ExerciseVisibility
from app.models.patient import ClinicPatient, MedicalBackground, Patient
from app.models.scheduling import Appointment, AppointmentStatus
from app.models.user import User
from app.schemas.clinical import (
    BackgroundIn,
    BackgroundOut,
    CarePlanIn,
    CarePlanOut,
    ConsultationIn,
    ConsultationOut,
    MedicationIn,
    PatientFileOut,
    PatientIn,
    PatientListItem,
    PlanExerciseIn,
    PrescriptionOut,
    TestOrderIn,
    TestOrderOut,
    TestOrderUpdate,
)
from app.services import audit
from app.services.adherence import adherence_pct, day_stats
from app.services.clinical import (
    age_of,
    care_plan_or_404,
    clinic_patient_or_404,
    ensure_clinic_patient,
    exercise_detail_text,
    new_rx_no,
    plan_out,
    reminder_times,
)

router = APIRouter(prefix="/clinic", tags=["records"])

Member = Annotated[ClinicMember, Depends(require_clinic_member())]
# Clinical records are written by physiotherapists; staff can read and register patients.
Clinician = Annotated[ClinicMember, Depends(require_clinic_member(MembershipRole.OWNER, MembershipRole.PHYSIO))]


def _adherence_7d(db: Session, cp: ClinicPatient) -> int | None:
    plan_ids = list(db.scalars(select(CarePlan.id).where(CarePlan.clinic_patient_id == cp.id, CarePlan.status == CarePlanStatus.ACTIVE)))
    if not plan_ids:
        return None
    today = date.today()
    return adherence_pct(day_stats(db, cp.patient_id, today - timedelta(days=6), today, plan_ids))


def _active_plan(db: Session, cp_id: uuid.UUID) -> CarePlan | None:
    return db.scalar(select(CarePlan).where(CarePlan.clinic_patient_id == cp_id, CarePlan.status == CarePlanStatus.ACTIVE).order_by(CarePlan.created_at.desc()).limit(1))


# ── Patients ────────────────────────────────────────────────────────────────


@router.get("/patients", response_model=list[PatientListItem])
def list_patients(
    member: Member,
    db: DB,
    q: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[PatientListItem]:
    stmt = select(ClinicPatient, Patient).join(Patient, Patient.id == ClinicPatient.patient_id).where(ClinicPatient.clinic_id == member.clinic_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.outerjoin(CarePlan, (CarePlan.clinic_patient_id == ClinicPatient.id) & (CarePlan.status == CarePlanStatus.ACTIVE)).where(
            or_(Patient.full_name.ilike(like), Patient.phone.ilike(like), CarePlan.condition.ilike(like))
        ).distinct()
    rows = db.execute(stmt.order_by(ClinicPatient.last_visit_on.desc().nulls_last(), ClinicPatient.updated_at.desc()).limit(limit).offset(offset)).all()
    items = []
    for cp, p in rows:
        plan = _active_plan(db, cp.id)
        items.append(
            PatientListItem(
                id=cp.id, patient_id=p.id, full_name=p.full_name, phone=p.phone, age=age_of(p.date_of_birth), sex=p.sex,
                condition=plan.condition if plan else None, last_visit_on=cp.last_visit_on, adherence_7d=_adherence_7d(db, cp),
                status=cp.status, has_app=p.user_id is not None,
            )
        )
    return items


@router.post("/patients", response_model=PatientListItem, status_code=status.HTTP_201_CREATED)
def create_patient(body: PatientIn, member: Member, user: CurrentUser, db: DB, request: Request) -> PatientListItem:
    cp = ensure_clinic_patient(db, member.clinic_id, phone=body.phone, full_name=body.full_name, age=body.age, sex=body.sex, email=body.email)
    audit.record(db, action="create", entity="clinic_patient", entity_id=cp.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    p = db.get(Patient, cp.patient_id)
    return PatientListItem(id=cp.id, patient_id=p.id, full_name=p.full_name, phone=p.phone, age=age_of(p.date_of_birth), sex=p.sex,
                           condition=None, last_visit_on=cp.last_visit_on, adherence_7d=None, status=cp.status, has_app=p.user_id is not None)


@router.get("/patients/{cp_id}", response_model=PatientFileOut)
def patient_file(cp_id: uuid.UUID, member: Member, db: DB) -> PatientFileOut:
    cp = clinic_patient_or_404(db, member.clinic_id, cp_id)
    p = db.get(Patient, cp.patient_id)
    bg = db.scalar(select(MedicalBackground).where(MedicalBackground.clinic_patient_id == cp.id))
    plan = _active_plan(db, cp.id)
    consults = list(db.scalars(select(Consultation).where(Consultation.clinic_patient_id == cp.id).order_by(Consultation.created_at.desc())))
    pains = [c.pain_vas for c in sorted(consults, key=lambda c: c.created_at) if c.pain_vas is not None]
    past = db.scalars(select(CarePlan).where(CarePlan.clinic_patient_id == cp.id, CarePlan.status != CarePlanStatus.ACTIVE).order_by(CarePlan.created_at.desc()))
    sessions_done = db.scalar(
        select(func.count()).select_from(Appointment).where(Appointment.clinic_id == cp.clinic_id, Appointment.patient_id == cp.patient_id, Appointment.status == AppointmentStatus.COMPLETED)
    ) or 0
    return PatientFileOut(
        id=cp.id, patient_id=p.id, full_name=p.full_name, phone=p.phone, email=p.email, age=age_of(p.date_of_birth), sex=p.sex,
        has_app=p.user_id is not None, status=cp.status, first_visit_on=cp.first_visit_on, last_visit_on=cp.last_visit_on,
        adherence_7d=_adherence_7d(db, cp), latest_pain=pains[-1] if pains else None, first_pain=pains[0] if pains else None,
        sessions_done=max(sessions_done, sum(1 for c in consults if c.signed_at)),
        background=_bg_out(bg) if bg else None,
        active_plan=plan_out(db, plan) if plan else None,
        past_plans=[{"id": str(x.id), "condition": x.condition, "status": x.status.value, "starts_on": x.starts_on.isoformat()} for x in past],
        consultations=[_consult_out(db, c) for c in consults],
    )


def _bg_out(bg: MedicalBackground) -> BackgroundOut:
    return BackgroundOut(past_history=bg.past_history, conditions=bg.conditions or [], prior_medicines=bg.prior_medicines or [],
                         core_strengths=bg.core_strengths, weaknesses=bg.weaknesses, core_grade=bg.core_grade, updated_at=bg.updated_at)


@router.put("/patients/{cp_id}/background", response_model=BackgroundOut)
def update_background(cp_id: uuid.UUID, body: BackgroundIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> BackgroundOut:
    cp = clinic_patient_or_404(db, member.clinic_id, cp_id)
    bg = db.scalar(select(MedicalBackground).where(MedicalBackground.clinic_patient_id == cp.id))
    if bg is None:
        bg = MedicalBackground(clinic_patient_id=cp.id)
        db.add(bg)
    for k, v in body.model_dump().items():
        setattr(bg, k, v)
    audit.record(db, action="update", entity="medical_background", entity_id=cp.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    db.refresh(bg)
    return _bg_out(bg)


# ── Consultations (SOAP) ────────────────────────────────────────────────────


def _consult_out(db: Session, c: Consultation) -> ConsultationOut:
    return ConsultationOut(
        id=c.id, title=c.title, physio_name=db.get(User, c.physio_user_id).full_name, subjective=c.subjective, objective=c.objective,
        assessment=c.assessment, plan=c.plan, vitals=c.vitals or {}, pain_vas=c.pain_vas, signed_at=c.signed_at, created_at=c.created_at,
    )


@router.post("/patients/{cp_id}/consultations", response_model=ConsultationOut, status_code=status.HTTP_201_CREATED)
def create_consultation(cp_id: uuid.UUID, body: ConsultationIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> ConsultationOut:
    cp = clinic_patient_or_404(db, member.clinic_id, cp_id)
    if body.appointment_id:
        appt = db.get(Appointment, body.appointment_id)
        if appt is None or appt.clinic_id != member.clinic_id or appt.patient_id != cp.patient_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Appointment doesn't belong to this patient")
    plan = _active_plan(db, cp.id)
    first = db.scalar(select(Consultation.id).where(Consultation.clinic_patient_id == cp.id).limit(1)) is None
    c = Consultation(
        clinic_patient_id=cp.id, appointment_id=body.appointment_id, care_plan_id=plan.id if plan else None, physio_user_id=user.id,
        title=body.title or ("Initial assessment" if first else "Follow-up"),
        **body.model_dump(include={"subjective", "objective", "assessment", "plan", "vitals", "pain_vas"}),
        signed_at=datetime.now(UTC) if body.sign else None,
    )
    db.add(c)
    cp.last_visit_on = date.today()
    if body.sign and body.appointment_id:
        db.execute(update(Appointment).where(Appointment.id == body.appointment_id, Appointment.status.in_([AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN])).values(status=AppointmentStatus.COMPLETED))
    db.flush()
    audit.record(db, action="sign" if body.sign else "create", entity="consultation", entity_id=c.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return _consult_out(db, c)


@router.put("/consultations/{consultation_id}", response_model=ConsultationOut)
def update_consultation(consultation_id: uuid.UUID, body: ConsultationIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> ConsultationOut:
    c = db.get(Consultation, consultation_id)
    if c is None or db.get(ClinicPatient, c.clinic_patient_id).clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Consultation not found")
    if c.signed_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Signed notes can't be edited")
    if c.physio_user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the author can edit this note")
    for k, v in body.model_dump(include={"title", "subjective", "objective", "assessment", "plan", "vitals", "pain_vas"}).items():
        if v is not None:
            setattr(c, k, v)
    if body.sign:
        c.signed_at = datetime.now(UTC)
    audit.record(db, action="sign" if body.sign else "update", entity="consultation", entity_id=c.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return _consult_out(db, c)


# ── Care plans ──────────────────────────────────────────────────────────────


@router.post("/patients/{cp_id}/care-plans", response_model=CarePlanOut, status_code=status.HTTP_201_CREATED)
def create_plan(cp_id: uuid.UUID, body: CarePlanIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> CarePlanOut:
    """Start a new plan. Any current plan at this clinic is marked completed."""
    cp = clinic_patient_or_404(db, member.clinic_id, cp_id)
    db.execute(update(CarePlan).where(CarePlan.clinic_patient_id == cp.id, CarePlan.status == CarePlanStatus.ACTIVE).values(status=CarePlanStatus.COMPLETED))
    plan = CarePlan(clinic_patient_id=cp.id, physio_user_id=user.id, **body.model_dump())
    db.add(plan)
    db.flush()
    audit.record(db, action="create", entity="care_plan", entity_id=plan.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=body.condition, request=request)
    db.commit()
    return plan_out(db, plan)


@router.put("/care-plans/{plan_id}", response_model=CarePlanOut)
def update_plan(plan_id: uuid.UUID, body: CarePlanIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> CarePlanOut:
    plan = care_plan_or_404(db, member.clinic_id, plan_id)
    for k, v in body.model_dump().items():
        setattr(plan, k, v)
    audit.record(db, action="update", entity="care_plan", entity_id=plan.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return plan_out(db, plan)


@router.post("/care-plans/{plan_id}/complete", response_model=CarePlanOut)
def complete_plan(plan_id: uuid.UUID, member: Clinician, user: CurrentUser, db: DB) -> CarePlanOut:
    plan = care_plan_or_404(db, member.clinic_id, plan_id)
    plan.status = CarePlanStatus.COMPLETED
    plan.ends_on = plan.ends_on or date.today()
    db.commit()
    return plan_out(db, plan)


@router.put("/care-plans/{plan_id}/exercises", response_model=CarePlanOut)
def set_plan_exercises(plan_id: uuid.UUID, items: list[PlanExerciseIn], member: Clinician, user: CurrentUser, db: DB, request: Request) -> CarePlanOut:
    """Replace the exercise program. Removed exercises are deactivated so their logs stay intact."""
    plan = care_plan_or_404(db, member.clinic_id, plan_id)
    if len(items) > 30:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A program can have at most 30 exercises")
    ids = {i.exercise_id for i in items}
    allowed = set(
        db.scalars(
            select(Exercise.id).where(
                Exercise.id.in_(ids),
                or_(
                    (Exercise.visibility == ExerciseVisibility.PUBLIC) & (Exercise.status == ExerciseStatus.PUBLISHED),
                    Exercise.owner_clinic_id == member.clinic_id,
                ),
            )
        )
    )
    if ids - allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "One or more exercises aren't available to this clinic")

    existing = {pe.exercise_id: pe for pe in db.scalars(select(CarePlanExercise).where(CarePlanExercise.care_plan_id == plan.id))}
    for pe in existing.values():
        pe.is_active = False
    for pos, item in enumerate(items):
        pe = existing.get(item.exercise_id)
        if pe is None:
            pe = CarePlanExercise(care_plan_id=plan.id, exercise_id=item.exercise_id)
            db.add(pe)
        pe.position = pos
        pe.is_active = True
        for k, v in item.model_dump(exclude={"exercise_id"}).items():
            setattr(pe, k, v)
    _notify_plan_update(db, plan, "Your exercise program was updated")
    audit.record(db, action="prescribe", entity="care_plan_exercises", entity_id=plan.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=f"{len(items)} exercises", request=request)
    db.commit()
    return plan_out(db, plan)


@router.put("/care-plans/{plan_id}/medications", response_model=CarePlanOut)
def set_plan_medications(plan_id: uuid.UUID, items: list[MedicationIn], member: Clinician, user: CurrentUser, db: DB, request: Request) -> CarePlanOut:
    plan = care_plan_or_404(db, member.clinic_id, plan_id)
    if len(items) > 20:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "At most 20 medicines")
    db.execute(update(Medication).where(Medication.care_plan_id == plan.id).values(is_active=False))
    for item in items:
        db.add(Medication(care_plan_id=plan.id, reminder_times=reminder_times(item.frequency), **item.model_dump()))
    _notify_plan_update(db, plan, "Your medicines were updated")
    audit.record(db, action="prescribe", entity="medications", entity_id=plan.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=", ".join(i.name for i in items)[:200], request=request)
    db.commit()
    return plan_out(db, plan)


@router.post("/care-plans/{plan_id}/tests", response_model=TestOrderOut, status_code=status.HTTP_201_CREATED)
def order_test(plan_id: uuid.UUID, body: TestOrderIn, member: Clinician, user: CurrentUser, db: DB) -> TestOrderOut:
    plan = care_plan_or_404(db, member.clinic_id, plan_id)
    t = TestOrder(clinic_patient_id=plan.clinic_patient_id, care_plan_id=plan.id, ordered_by=user.id, name=body.name)
    db.add(t)
    db.commit()
    return TestOrderOut(id=t.id, name=t.name, status=t.status, result_note=t.result_note, created_at=t.created_at, result_at=t.result_at)


@router.patch("/tests/{test_id}", response_model=TestOrderOut)
def update_test(test_id: uuid.UUID, body: TestOrderUpdate, member: Clinician, db: DB) -> TestOrderOut:
    t = db.get(TestOrder, test_id)
    if t is None or db.get(ClinicPatient, t.clinic_patient_id).clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test not found")
    t.status = body.status
    t.result_note = body.result_note
    t.result_at = datetime.now(UTC) if body.status == TestOrderStatus.RESULT_READY else None
    if body.status == TestOrderStatus.RESULT_READY:
        plan = db.get(CarePlan, t.care_plan_id) if t.care_plan_id else None
        if plan:
            _notify_plan_update(db, plan, f"Result ready: {t.name}")
    db.commit()
    return TestOrderOut(id=t.id, name=t.name, status=t.status, result_note=t.result_note, created_at=t.created_at, result_at=t.result_at)


def _notify_plan_update(db: Session, plan: CarePlan, title: str) -> None:
    patient = db.get(Patient, db.get(ClinicPatient, plan.clinic_patient_id).patient_id)
    if patient.user_id:
        db.add(Notification(user_id=patient.user_id, kind="plan_updated", title=title, body=plan.condition, data={"care_plan_id": str(plan.id)}))


# ── Prescriptions ───────────────────────────────────────────────────────────


@router.post("/care-plans/{plan_id}/prescriptions", response_model=PrescriptionOut, status_code=status.HTTP_201_CREATED)
def issue_prescription(plan_id: uuid.UUID, member: Clinician, user: CurrentUser, db: DB, request: Request) -> PrescriptionOut:
    """Freeze the current plan into a numbered prescription (what gets printed and shown in the app)."""
    plan = care_plan_or_404(db, member.clinic_id, plan_id)
    cp = db.get(ClinicPatient, plan.clinic_patient_id)
    patient = db.get(Patient, cp.patient_id)
    clinic = db.get(Clinic, cp.clinic_id)
    branch = db.scalar(select(Branch).where(Branch.clinic_id == clinic.id).order_by(Branch.created_at).limit(1))
    physio = db.get(User, user.id)
    profile = db.scalar(select(PhysioProfile).where(PhysioProfile.user_id == user.id))
    out = plan_out(db, plan)
    latest = db.scalar(select(Consultation).where(Consultation.clinic_patient_id == cp.id).order_by(Consultation.created_at.desc()).limit(1))
    now = datetime.now(UTC)
    snapshot = {
        "clinic": {"name": clinic.name, "logo_url": clinic.logo_url, "phone": clinic.phone, "email": clinic.email, "gstin": clinic.gstin,
                   "address": clinic.address or ", ".join(x for x in [branch.address, branch.area, branch.city] if x) if branch else clinic.address},
        "physio": {"name": physio.full_name, "qualification": profile.qualification if profile else None,
                   "registration_no": profile.registration_no if profile else None, "council": profile.council if profile else None},
        "patient": {"name": patient.full_name, "age": age_of(patient.date_of_birth), "sex": patient.sex.value if patient.sex else None, "phone": patient.phone},
        "diagnosis": {"condition": plan.condition, "detail": plan.condition_detail},
        "medications": [{"name": m.name, "dose": m.dose, "frequency": m.frequency, "timing": m.timing,
                         "duration": f"{m.duration_days} days" if m.duration_days else None, "instructions": m.instructions} for m in out.medications],
        "exercises": [{"name": e.name, "detail": exercise_detail_text(e.sets, e.reps, e.hold_seconds, e.frequency.value), "notes": e.notes} for e in out.exercises],
        "tests": [t.name for t in out.tests if t.status != TestOrderStatus.CANCELLED],
        "advice": plan.notes,
        "next_review": plan.stage,
        "consultation_id": str(latest.id) if latest else None,
    }
    rx = Prescription(clinic_patient_id=cp.id, care_plan_id=plan.id, consultation_id=latest.id if latest else None,
                      physio_user_id=user.id, rx_no=new_rx_no(now), snapshot=snapshot, issued_at=now)
    db.add(rx)
    _notify_plan_update(db, plan, "New prescription from your physio")
    audit.record(db, action="issue", entity="prescription", entity_id=rx.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=rx.rx_no, request=request)
    db.commit()
    return PrescriptionOut(id=rx.id, rx_no=rx.rx_no, issued_at=rx.issued_at, snapshot=rx.snapshot)


@router.get("/patients/{cp_id}/prescriptions", response_model=list[PrescriptionOut])
def list_prescriptions(cp_id: uuid.UUID, member: Member, db: DB) -> list[PrescriptionOut]:
    cp = clinic_patient_or_404(db, member.clinic_id, cp_id)
    rows = db.scalars(select(Prescription).where(Prescription.clinic_patient_id == cp.id).order_by(Prescription.issued_at.desc()))
    return [PrescriptionOut(id=r.id, rx_no=r.rx_no, issued_at=r.issued_at, snapshot=r.snapshot) for r in rows]


@router.get("/prescriptions/{rx_id}", response_model=PrescriptionOut)
def get_prescription(rx_id: uuid.UUID, member: Member, db: DB) -> PrescriptionOut:
    rx = db.get(Prescription, rx_id)
    if rx is None or db.get(ClinicPatient, rx.clinic_patient_id).clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prescription not found")
    return PrescriptionOut(id=rx.id, rx_no=rx.rx_no, issued_at=rx.issued_at, snapshot=rx.snapshot)
