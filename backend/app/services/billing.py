"""Clinic invoices: numbering, creation, payment."""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.billing import Invoice, InvoiceItem, InvoiceStatus, Payment
from app.models.clinic import Branch
from app.models.patient import ClinicPatient
from app.models.scheduling import Appointment, ConsultMode

PAYMENT_METHODS = ("cash", "upi", "card", "netbanking", "razorpay", "points", "other")


@dataclass
class Line:
    description: str
    rate_paise: int
    quantity: int = 1
    detail: str | None = None


def _next_number(db: Session, clinic_id: uuid.UUID, year: int) -> str:
    prefix = f"INV-{year}-"
    last = db.scalar(
        select(func.max(Invoice.number)).where(Invoice.clinic_id == clinic_id, Invoice.number.like(f"{prefix}%"))
    )
    n = int(last.removeprefix(prefix)) + 1 if last else 1
    return f"{prefix}{n:04d}"


def create_invoice(
    db: Session,
    *,
    clinic_id: uuid.UUID,
    clinic_patient_id: uuid.UUID,
    lines: list[Line],
    branch_id: uuid.UUID | None = None,
    due_on: date | None = None,
    notes: str | None = None,
    created_by: uuid.UUID | None = None,
    paid_via: str | None = None,
    payment_id: uuid.UUID | None = None,
    appointment_id: uuid.UUID | None = None,
) -> Invoice:
    """Create an invoice (optionally already paid). Numbers are per clinic per year: INV-2026-0001."""
    subtotal = sum(line.rate_paise * line.quantity for line in lines)
    now = datetime.now(UTC)
    for _ in range(5):
        inv = Invoice(
            clinic_id=clinic_id,
            branch_id=branch_id,
            clinic_patient_id=clinic_patient_id,
            number=_next_number(db, clinic_id, now.year),
            issued_on=now.date(),
            due_on=due_on,
            status=InvoiceStatus.PAID if paid_via else InvoiceStatus.DUE,
            subtotal_paise=subtotal,
            tax_paise=0,  # physiotherapy is a GST-exempt healthcare service
            total_paise=subtotal,
            payment_id=payment_id,
            appointment_id=appointment_id,
            paid_via=paid_via,
            paid_at=now if paid_via else None,
            created_by=created_by,
            notes=notes,
        )
        try:
            with db.begin_nested():
                db.add(inv)
                db.flush()
            break
        except IntegrityError:
            continue  # another invoice took the number; try the next one
    else:
        raise RuntimeError("Could not allocate an invoice number")
    for line in lines:
        db.add(InvoiceItem(invoice_id=inv.id, description=line.description, detail=line.detail, quantity=line.quantity,
                           rate_paise=line.rate_paise, amount_paise=line.rate_paise * line.quantity))
    return inv


def mark_paid(inv: Invoice, method: str) -> None:
    inv.status = InvoiceStatus.PAID
    inv.paid_via = method
    inv.paid_at = datetime.now(UTC)


def _booking_patient(db: Session, appt: Appointment) -> ClinicPatient:
    cp = db.scalar(select(ClinicPatient).where(ClinicPatient.clinic_id == appt.clinic_id, ClinicPatient.patient_id == appt.patient_id))
    if cp is None:
        cp = ClinicPatient(clinic_id=appt.clinic_id, patient_id=appt.patient_id, primary_physio_id=appt.physio_user_id)
        db.add(cp)
        db.flush()
    return cp


def _booking_line(appt: Appointment) -> Line:
    mode = "Online consultation" if appt.mode == ConsultMode.ONLINE else "In-clinic consultation"
    return Line(description=mode, detail=f"{appt.kind.value.replace('_', '-').capitalize()} · booked on Physionexs", rate_paise=appt.fee_paise)


def invoice_for_clinic_booking(db: Session, appt: Appointment) -> Invoice:
    """A pay-at-clinic booking: a due invoice that reception marks paid when the patient pays at the desk."""
    return create_invoice(
        db, clinic_id=appt.clinic_id, branch_id=appt.branch_id, clinic_patient_id=_booking_patient(db, appt).id,
        lines=[_booking_line(appt)], due_on=appt.starts_at.astimezone(ZoneInfo(db.get(Branch, appt.branch_id).timezone)).date(), notes="Booked on Physionexs · pay at the clinic",
        payment_id=appt.payment_id, appointment_id=appt.id,
    )


def invoice_for_paid_booking(db: Session, appt: Appointment, payment: Payment) -> Invoice | None:
    """Every paid app booking gets a paid invoice, so billing and analytics see all revenue."""
    if db.scalar(select(Invoice.id).where(Invoice.appointment_id == appt.id)):
        return None
    cp = _booking_patient(db, appt)
    lines = [_booking_line(appt)]
    discount = (payment.meta or {}).get("discount_paise", 0)
    if discount:
        lines.append(Line(description="Health Points redeemed", detail=f"{payment.points_redeemed} points", rate_paise=-discount))
    return create_invoice(
        db, clinic_id=appt.clinic_id, branch_id=appt.branch_id, clinic_patient_id=cp.id, lines=lines,
        paid_via=payment.method or "razorpay", payment_id=payment.id, appointment_id=appt.id,
    )


def void_booking_invoice(db: Session, appointment_id: uuid.UUID, reason: str) -> None:
    """A cancelled (refundable) booking shouldn't count as revenue."""
    inv = db.scalar(select(Invoice).where(Invoice.appointment_id == appointment_id))
    if inv and inv.status != InvoiceStatus.VOID:
        inv.status = InvoiceStatus.VOID
        inv.notes = f"{inv.notes + ' · ' if inv.notes else ''}Void: {reason}"
