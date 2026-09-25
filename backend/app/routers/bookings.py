"""Patient-side booking, payment and appointments."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import DB, require_roles
from app.models.billing import Payment, PaymentStatus
from app.models.clinic import Branch, Clinic, PhysioProfile
from app.models.patient import Patient
from app.models.scheduling import Appointment, AppointmentStatus
from app.models.user import User, UserRole
from app.schemas.booking import (
    AppointmentOut,
    BookingIn,
    BranchBrief,
    CheckoutOut,
    PhysioBrief,
    PointsOut,
    RazorpayCheckout,
    VerifyPaymentIn,
)
from app.services import booking, razorpay
from app.services.settings import paise_per_point

router = APIRouter(tags=["bookings"])

PatientUser = Annotated[User, Depends(require_roles(UserRole.PATIENT))]


def _patient(db: Session, user: User) -> Patient:
    patient = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient profile not found")
    return patient


def _own_appointment(db: Session, patient: Patient, appointment_id: uuid.UUID) -> Appointment:
    appt = db.get(Appointment, appointment_id)
    if appt is None or appt.patient_id != patient.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    return appt


@router.post("/bookings", response_model=CheckoutOut, status_code=status.HTTP_201_CREATED)
def create_booking(body: BookingIn, user: PatientUser, db: DB) -> CheckoutOut:
    patient = _patient(db, user)
    appt, payment = booking.create_booking(
        db,
        user=user,
        patient=patient,
        physio_user_id=body.physio_id,
        starts_at=body.starts_at,
        mode=body.mode,
        referral_source=body.referral_source,
        redeem_points=body.redeem_points,
    )
    physio = db.get(User, appt.physio_user_id)
    checkout = None
    if payment.status != PaymentStatus.PAID:
        checkout = RazorpayCheckout(
            key_id=razorpay.public_key_id(),
            order_id=payment.razorpay_order_id,
            amount=payment.amount_paise,
            description=f"Consultation with {physio.full_name}",
            prefill={k: v for k, v in {"name": user.full_name, "contact": user.phone, "email": user.email}.items() if v},
        )
    return CheckoutOut(
        appointment_id=appt.id,
        status=appt.status,
        fee_paise=appt.fee_paise,
        discount_paise=payment.meta.get("discount_paise", 0),
        points_redeemed=payment.points_redeemed,
        amount_paise=payment.amount_paise,
        hold_expires_at=appt.hold_expires_at,
        razorpay=checkout,
    )


@router.post("/bookings/{appointment_id}/verify", response_model=AppointmentOut)
def verify_payment(appointment_id: uuid.UUID, body: VerifyPaymentIn, user: PatientUser, db: DB) -> AppointmentOut:
    """Called by the client after Razorpay checkout succeeds. The webhook confirms too, whichever arrives first."""
    appt = _own_appointment(db, _patient(db, user), appointment_id)
    payment = db.scalar(select(Payment).where(Payment.id == appt.payment_id).with_for_update())
    if payment is None or payment.razorpay_order_id != body.razorpay_order_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment does not match this booking")
    if not razorpay.verify_payment_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment could not be verified")
    booking.finalize_payment(db, payment, razorpay_payment_id=body.razorpay_payment_id, method="razorpay")
    db.commit()
    db.refresh(appt)
    return appointment_out(db, appt)


@router.get("/me/appointments", response_model=list[AppointmentOut])
def my_appointments(
    user: PatientUser,
    db: DB,
    scope: Literal["upcoming", "past"] = "upcoming",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[AppointmentOut]:
    patient = _patient(db, user)
    now = datetime.now(UTC)
    stmt = select(Appointment).where(Appointment.patient_id == patient.id)
    if scope == "upcoming":
        stmt = stmt.where(
            Appointment.ends_at >= now,
            Appointment.status.in_([AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN]),
        ).order_by(Appointment.starts_at)
    else:
        stmt = stmt.where(
            (Appointment.ends_at < now) | Appointment.status.in_([AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW, AppointmentStatus.COMPLETED])
        ).where(
            # hide abandoned checkouts
            ~((Appointment.status == AppointmentStatus.CANCELLED) & (Appointment.notes == "Payment hold expired"))
        ).order_by(Appointment.starts_at.desc())
    return [appointment_out(db, a) for a in db.scalars(stmt.limit(limit))]


@router.get("/me/appointments/{appointment_id}", response_model=AppointmentOut)
def my_appointment(appointment_id: uuid.UUID, user: PatientUser, db: DB) -> AppointmentOut:
    return appointment_out(db, _own_appointment(db, _patient(db, user), appointment_id))


@router.post("/me/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel(appointment_id: uuid.UUID, user: PatientUser, db: DB) -> AppointmentOut:
    appt = _own_appointment(db, _patient(db, user), appointment_id)
    return appointment_out(db, booking.cancel_by_patient(db, appt, user))


@router.get("/me/points", response_model=PointsOut)
def my_points(user: PatientUser, db: DB) -> PointsOut:
    return PointsOut(balance=_patient(db, user).points_balance, paise_per_point=paise_per_point(db))


def appointment_out(db: Session, appt: Appointment) -> AppointmentOut:
    physio = db.get(User, appt.physio_user_id)
    profile = db.scalar(select(PhysioProfile).where(PhysioProfile.user_id == appt.physio_user_id))
    branch = db.get(Branch, appt.branch_id)
    clinic = db.get(Clinic, appt.clinic_id)
    payment = db.get(Payment, appt.payment_id) if appt.payment_id else None
    paid = payment is not None and payment.status == PaymentStatus.PAID
    return AppointmentOut(
        id=appt.id,
        starts_at=appt.starts_at,
        ends_at=appt.ends_at,
        mode=appt.mode,
        kind=appt.kind,
        status=appt.status,
        physio=PhysioBrief(id=physio.id, full_name=physio.full_name, qualification=profile.qualification if profile else None),
        clinic_name=clinic.name,
        branch=BranchBrief(id=branch.id, name=branch.name, area=branch.area, city=branch.city, address=branch.address),
        fee_paise=appt.fee_paise,
        amount_paid_paise=payment.amount_paise if paid else 0,
        points_redeemed=payment.points_redeemed if payment else 0,
        paid=paid,
        hold_expires_at=appt.hold_expires_at if appt.status == AppointmentStatus.PENDING else None,
    )
