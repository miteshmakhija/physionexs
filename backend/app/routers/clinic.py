"""Practice console endpoints. Every route is scoped to the clinic in the X-Clinic-Id header."""

import uuid
from datetime import date, datetime, time, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select

from app.core.deps import DB, CurrentUser, require_clinic_member
from app.models.billing import Payment, PaymentStatus
from app.models.clinic import Branch, ClinicMember, MembershipRole, PhysioProfile
from app.models.patient import Patient
from app.models.scheduling import Appointment, AppointmentStatus, Availability
from app.models.user import User
from app.schemas.booking import (
    AppointmentStatusIn,
    AvailabilityIn,
    AvailabilityItem,
    BranchBrief,
    ClinicAppointmentOut,
    PhysioProfileIn,
    PhysioProfileOut,
)
from app.services import audit

router = APIRouter(prefix="/clinic", tags=["clinic"])

Member = Annotated[ClinicMember, Depends(require_clinic_member())]
Clinician = Annotated[ClinicMember, Depends(require_clinic_member(MembershipRole.OWNER, MembershipRole.PHYSIO))]

# Allowed status changes from the console.
TRANSITIONS: dict[AppointmentStatus, set[AppointmentStatus]] = {
    AppointmentStatus.PENDING: {AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED},
    AppointmentStatus.CONFIRMED: {AppointmentStatus.CHECKED_IN, AppointmentStatus.NO_SHOW, AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED},
    AppointmentStatus.CHECKED_IN: {AppointmentStatus.COMPLETED},
}


def _my_profile(db: DB, user: User) -> PhysioProfile:
    profile = db.scalar(select(PhysioProfile).where(PhysioProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Only physiotherapists have a public profile")
    return profile


def _profile_out(p: PhysioProfile) -> PhysioProfileOut:
    return PhysioProfileOut(
        qualification=p.qualification,
        bio=p.bio,
        college=p.college,
        experience_years=p.experience_years,
        specializations=p.specializations or [],
        languages=p.languages or [],
        offers_in_clinic=p.offers_in_clinic,
        offers_online=p.offers_online,
        fee_in_clinic_paise=p.fee_in_clinic_paise,
        fee_online_paise=p.fee_online_paise,
        registration_no=p.registration_no,
        council=p.council,
        verification_status=p.verification_status.value,
    )


@router.get("/physio-profile", response_model=PhysioProfileOut)
def get_profile(member: Clinician, user: CurrentUser, db: DB) -> PhysioProfileOut:
    return _profile_out(_my_profile(db, user))


@router.put("/physio-profile", response_model=PhysioProfileOut)
def update_profile(body: PhysioProfileIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> PhysioProfileOut:
    profile = _my_profile(db, user)
    if body.offers_in_clinic and not body.fee_in_clinic_paise:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Set an in-clinic fee")
    if body.offers_online and not body.fee_online_paise:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Set an online fee")
    for field, value in body.model_dump().items():
        setattr(profile, field, value)
    audit.record(db, action="update", entity="physio_profile", entity_id=profile.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return _profile_out(profile)


@router.get("/branches", response_model=list[BranchBrief])
def branches(member: Member, db: DB) -> list[BranchBrief]:
    rows = db.scalars(select(Branch).where(Branch.clinic_id == member.clinic_id, Branch.is_active.is_(True)).order_by(Branch.name))
    return [BranchBrief(id=b.id, name=b.name, area=b.area, city=b.city, address=b.address) for b in rows]


@router.get("/availability", response_model=list[AvailabilityItem])
def get_availability(member: Clinician, user: CurrentUser, db: DB) -> list[AvailabilityItem]:
    rows = db.scalars(
        select(Availability)
        .join(Branch, Branch.id == Availability.branch_id)
        .where(Availability.physio_user_id == user.id, Branch.clinic_id == member.clinic_id)
        .order_by(Availability.weekday, Availability.start_time)
    )
    return [AvailabilityItem(branch_id=a.branch_id, weekday=a.weekday, start_time=a.start_time, end_time=a.end_time, slot_minutes=a.slot_minutes) for a in rows]


@router.put("/availability", response_model=list[AvailabilityItem])
def set_availability(body: AvailabilityIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> list[AvailabilityItem]:
    """Replace the signed-in physio's weekly hours at this clinic."""
    clinic_branches = set(db.scalars(select(Branch.id).where(Branch.clinic_id == member.clinic_id)))
    for item in body.items:
        if item.branch_id not in clinic_branches:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown branch")
    by_day: dict[int, list[AvailabilityItem]] = {}
    for item in body.items:
        by_day.setdefault(item.weekday, []).append(item)
    for items in by_day.values():
        items.sort(key=lambda i: i.start_time)
        for a, b in zip(items, items[1:]):
            if b.start_time < a.end_time:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Working hours overlap on the same day")

    db.execute(delete(Availability).where(Availability.physio_user_id == user.id, Availability.branch_id.in_(clinic_branches)))
    for item in body.items:
        db.add(Availability(physio_user_id=user.id, **item.model_dump()))
    audit.record(db, action="update", entity="availability", actor_user_id=user.id, clinic_id=member.clinic_id, summary=f"{len(body.items)} weekly blocks", request=request)
    db.commit()
    return get_availability(member, user, db)


@router.get("/appointments", response_model=list[ClinicAppointmentOut])
def appointments(
    member: Member,
    db: DB,
    day: date,
    branch_id: uuid.UUID | None = None,
    physio_id: uuid.UUID | None = None,
) -> list[ClinicAppointmentOut]:
    branch_q = select(Branch).where(Branch.clinic_id == member.clinic_id)
    if branch_id:
        branch_q = branch_q.where(Branch.id == branch_id)
    first = db.scalars(branch_q).first()
    tz = ZoneInfo(first.timezone if first else "Asia/Kolkata")
    start = datetime.combine(day, time.min, tz)

    stmt = (
        select(Appointment, Patient, User, Branch)
        .join(Patient, Patient.id == Appointment.patient_id)
        .join(User, User.id == Appointment.physio_user_id)
        .join(Branch, Branch.id == Appointment.branch_id)
        .where(
            Appointment.clinic_id == member.clinic_id,
            Appointment.starts_at >= start,
            Appointment.starts_at < start + timedelta(days=1),
            Appointment.status != AppointmentStatus.PENDING,  # unpaid holds aren't real bookings yet
        )
        .order_by(Appointment.starts_at)
    )
    if branch_id:
        stmt = stmt.where(Appointment.branch_id == branch_id)
    if physio_id:
        stmt = stmt.where(Appointment.physio_user_id == physio_id)
    return [_clinic_appt(db, a, p, u, b) for a, p, u, b in db.execute(stmt).all()]


@router.patch("/appointments/{appointment_id}", response_model=ClinicAppointmentOut)
def update_appointment(appointment_id: uuid.UUID, body: AppointmentStatusIn, member: Member, user: CurrentUser, db: DB, request: Request) -> ClinicAppointmentOut:
    appt = db.get(Appointment, appointment_id)
    if appt is None or appt.clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    if body.status not in TRANSITIONS.get(appt.status, set()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Can't change a {appt.status.value} appointment to {body.status.value}")
    previous = appt.status
    appt.status = body.status
    if body.status == AppointmentStatus.CANCELLED and appt.payment_id:
        payment = db.get(Payment, appt.payment_id)
        if payment and payment.status == PaymentStatus.PAID and payment.amount_paise > 0:
            payment.meta = {**payment.meta, "refund_required": True, "refund_reason": "cancelled by clinic"}
    audit.record(db, action="update", entity="appointment", entity_id=appt.id, actor_user_id=user.id, clinic_id=member.clinic_id, changes={"status": [previous.value, body.status.value]}, request=request)
    db.commit()
    patient = db.get(Patient, appt.patient_id)
    return _clinic_appt(db, appt, patient, db.get(User, appt.physio_user_id), db.get(Branch, appt.branch_id))


def _clinic_appt(db: DB, a: Appointment, p: Patient, physio: User, b: Branch) -> ClinicAppointmentOut:
    payment = db.get(Payment, a.payment_id) if a.payment_id else None
    return ClinicAppointmentOut(
        id=a.id,
        starts_at=a.starts_at,
        ends_at=a.ends_at,
        mode=a.mode,
        kind=a.kind,
        status=a.status,
        source=a.source.value,
        patient_name=p.full_name,
        patient_phone=p.phone,
        physio_name=physio.full_name,
        branch_name=b.name,
        reason=a.reason,
        fee_paise=a.fee_paise,
        paid=payment is not None and payment.status == PaymentStatus.PAID,
    )
