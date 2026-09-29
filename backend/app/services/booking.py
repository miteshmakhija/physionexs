"""Patient app bookings: hold a slot, take payment through Razorpay (or at the clinic), confirm."""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.billing import Payment, PaymentPurpose, PaymentStatus
from app.models.clinic import Branch, Clinic, PhysioProfile, VerificationStatus
from app.models.engagement import Notification, PointsLedger
from app.models.patient import ClinicPatient, Patient
from app.models.scheduling import (
    Appointment,
    Availability,
    AppointmentKind,
    AppointmentSource,
    AppointmentStatus,
    ConsultMode,
)
from app.models.user import User
from app.services import audit, razorpay
from app.services.billing import invoice_for_clinic_booking, invoice_for_paid_booking, void_booking_invoice
from app.services.settings import paise_per_point
from app.services.slots import find_slot

log = logging.getLogger(__name__)

HOLD = timedelta(minutes=15)
CANCEL_CUTOFF = timedelta(hours=4)


def create_booking(
    db: Session,
    *,
    user: User,
    patient: Patient,
    physio_user_id: uuid.UUID,
    starts_at: datetime,
    mode: ConsultMode,
    referral_source: str | None,
    redeem_points: bool,
    branch_id: uuid.UUID | None = None,
    pay_at_clinic: bool = False,
) -> tuple[Appointment, Payment]:
    now = datetime.now(UTC)
    if pay_at_clinic and mode == ConsultMode.ONLINE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Online consultations are paid in advance. Choose an in-clinic visit to pay at the clinic.")
    if pay_at_clinic and redeem_points:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Health Points can be redeemed only when paying online")
    profile = db.scalar(select(PhysioProfile).where(PhysioProfile.user_id == physio_user_id))
    if profile is None or profile.verification_status != VerificationStatus.APPROVED:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Physiotherapist not found")
    if mode == ConsultMode.ONLINE and not profile.offers_online:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This physiotherapist doesn't offer online consultations")
    if mode == ConsultMode.IN_CLINIC and not profile.offers_in_clinic:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This physiotherapist doesn't offer in-clinic visits")
    fee = profile.fee_online_paise if mode == ConsultMode.ONLINE else profile.fee_in_clinic_paise
    if not fee or fee <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Consultation fee not set for this mode")

    if branch_id is None:
        # The physio's branches that have hours: with more than one, the patient must say which.
        branches = set(db.scalars(select(Availability.branch_id).join(Branch, Branch.id == Availability.branch_id).where(
            Availability.physio_user_id == physio_user_id, Branch.is_active.is_(True))))
        if len(branches) > 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose which clinic branch you'd like to visit")
    slot = find_slot(db, physio_user_id, starts_at, now, branch_id)
    if slot is None or not slot.available:
        raise HTTPException(status.HTTP_409_CONFLICT, "That slot is no longer available")
    branch = db.get(Branch, slot.branch_id)
    clinic = db.get(Clinic, branch.clinic_id)

    # Free the slot from any expired unpaid hold so the unique index lets this booking in.
    db.execute(
        update(Appointment)
        .where(
            Appointment.physio_user_id == physio_user_id,
            Appointment.starts_at == slot.starts_at,
            Appointment.status == AppointmentStatus.PENDING,
            Appointment.hold_expires_at <= now,
        )
        .values(status=AppointmentStatus.CANCELLED, notes="Payment hold expired")
    )

    ppp = paise_per_point(db)
    points = min(patient.points_balance, fee // ppp) if redeem_points else 0
    discount = points * ppp
    payable = fee - discount
    platform_fee = fee * clinic.platform_fee_bps // 10_000

    had_visit = db.scalar(
        select(Appointment.id).where(
            Appointment.patient_id == patient.id,
            Appointment.physio_user_id == physio_user_id,
            Appointment.status == AppointmentStatus.COMPLETED,
        ).limit(1)
    )
    payment = Payment(
        purpose=PaymentPurpose.APPOINTMENT,
        clinic_id=clinic.id,
        patient_id=patient.id,
        amount_paise=payable,
        points_redeemed=points,
        platform_fee_paise=platform_fee,
        meta={"fee_paise": fee, "discount_paise": discount, "payout_paise": fee - platform_fee},
    )
    db.add(payment)
    db.flush()
    appt = Appointment(
        clinic_id=clinic.id,
        branch_id=branch.id,
        physio_user_id=physio_user_id,
        patient_id=patient.id,
        starts_at=slot.starts_at,
        ends_at=slot.ends_at,
        mode=mode,
        kind=AppointmentKind.FOLLOW_UP if had_visit else AppointmentKind.INITIAL,
        status=AppointmentStatus.PENDING,
        source=AppointmentSource.PATIENT_APP,
        referral_source=referral_source,
        fee_paise=fee,
        payment_id=payment.id,
        hold_expires_at=now + HOLD,
    )
    db.add(appt)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That slot was just taken. Please pick another time.")

    if pay_at_clinic:
        # No gateway: confirm straight away; reception collects the fee against a due invoice.
        payment.method = "clinic"
        payment.meta = {**payment.meta, "pay_at_clinic": True}
        appt.status = AppointmentStatus.CONFIRMED
        appt.hold_expires_at = None
        invoice_for_clinic_booking(db, appt)
    elif payable == 0:
        finalize_payment(db, payment, razorpay_payment_id=None, method="points")
    else:
        try:
            payment.razorpay_order_id = razorpay.create_order(
                payable,
                receipt=str(appt.id),
                notes={"appointment_id": str(appt.id), "patient_id": str(patient.id)},
            )
        except razorpay.PaymentGatewayError as exc:
            db.rollback()
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Payment service unavailable. Please try again.") from exc
    audit.record(db, action="create", entity="appointment", entity_id=appt.id, actor_user_id=user.id, clinic_id=clinic.id, summary=f"Booked via app · {mode.value}")
    db.commit()
    return appt, payment


def finalize_payment(db: Session, payment: Payment, *, razorpay_payment_id: str | None, method: str | None) -> Appointment | None:
    """Mark a booking payment paid and confirm the appointment. Safe to call more than once."""
    appt = db.scalar(select(Appointment).where(Appointment.payment_id == payment.id).with_for_update())
    if payment.status == PaymentStatus.PAID:
        return appt

    now = datetime.now(UTC)
    payment.status = PaymentStatus.PAID
    payment.paid_at = now
    payment.method = method
    if razorpay_payment_id:
        payment.razorpay_payment_id = razorpay_payment_id

    patient = db.scalar(select(Patient).where(Patient.id == payment.patient_id).with_for_update())
    if payment.points_redeemed and patient:
        used = min(payment.points_redeemed, patient.points_balance)
        patient.points_balance -= used
        db.add(PointsLedger(patient_id=patient.id, delta=-used, reason="redeem", ref_id=payment.id))

    if appt is None:
        return None
    if appt.status == AppointmentStatus.CANCELLED:
        # Paid after the hold lapsed: re-confirm if the slot is still free, otherwise flag for refund.
        appt.status = AppointmentStatus.CONFIRMED
        try:
            with db.begin_nested():
                db.flush()
        except IntegrityError:
            appt.status = AppointmentStatus.CANCELLED
            payment.meta = {**payment.meta, "refund_required": True, "refund_reason": "slot taken after hold expired"}
            log.error("Payment %s captured for a slot that was re-booked; refund required", payment.id)
            return appt
    appt.status = AppointmentStatus.CONFIRMED
    appt.hold_expires_at = None

    link = db.scalar(select(ClinicPatient).where(ClinicPatient.clinic_id == appt.clinic_id, ClinicPatient.patient_id == appt.patient_id))
    if link is None:
        db.add(ClinicPatient(clinic_id=appt.clinic_id, patient_id=appt.patient_id, primary_physio_id=appt.physio_user_id))
        db.flush()
    invoice_for_paid_booking(db, appt, payment)

    when = appt.starts_at.strftime("%d %b, %H:%M UTC")
    if patient and patient.user_id:
        db.add(Notification(user_id=patient.user_id, kind="appointment_confirmed", title="Appointment confirmed", body=f"Your appointment on {when} is confirmed.", data={"appointment_id": str(appt.id)}))
    db.add(Notification(user_id=appt.physio_user_id, kind="new_booking", title="New booking from the Physionexs app", body=f"{patient.full_name if patient else 'A patient'} · {when}", data={"appointment_id": str(appt.id)}))
    audit.record(db, action="payment", entity="appointment", entity_id=appt.id, clinic_id=appt.clinic_id, summary=f"Paid ₹{payment.amount_paise / 100:.0f} via {method or 'razorpay'}")
    return appt


def cancel_by_patient(db: Session, appt: Appointment, user: User) -> Appointment:
    now = datetime.now(UTC)
    if appt.status not in (AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This appointment can't be cancelled")
    if appt.status == AppointmentStatus.CONFIRMED and appt.starts_at - now < CANCEL_CUTOFF:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Appointments can be cancelled up to 4 hours before the start time")
    payment = db.get(Payment, appt.payment_id) if appt.payment_id else None
    appt.status = AppointmentStatus.CANCELLED
    appt.notes = "Cancelled by patient"
    if payment and payment.status == PaymentStatus.PAID:
        if payment.points_redeemed:
            patient = db.get(Patient, payment.patient_id)
            patient.points_balance += payment.points_redeemed
            db.add(PointsLedger(patient_id=patient.id, delta=payment.points_redeemed, reason="refund", ref_id=payment.id))
        if payment.amount_paise > 0:
            # Refunds are issued by ops from the Razorpay dashboard for now; flagged here.
            payment.meta = {**payment.meta, "refund_required": True, "refund_reason": "cancelled by patient"}
    void_booking_invoice(db, appt.id, "cancelled by patient")  # paid or still due at the clinic
    audit.record(db, action="cancel", entity="appointment", entity_id=appt.id, actor_user_id=user.id, clinic_id=appt.clinic_id, summary="Cancelled by patient")
    db.commit()
    return appt
