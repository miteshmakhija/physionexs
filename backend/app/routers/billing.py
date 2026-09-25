"""Clinic billing & invoices (owner only — staff don't see billing)."""

import uuid
from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser, require_clinic_member
from app.models.billing import Invoice, InvoiceItem, InvoiceStatus
from app.models.clinic import Branch, Clinic, ClinicMember, MembershipRole
from app.models.patient import ClinicPatient, Patient
from app.schemas.business import BillingSummary, InvoiceIn, InvoiceLineOut, InvoiceListItem, InvoiceOut, InvoicePage, PayIn
from app.services import audit
from app.services.billing import Line, create_invoice, mark_paid
from app.services.clinical import age_of, clinic_patient_or_404

router = APIRouter(prefix="/clinic/invoices", tags=["billing"])

Owner = Annotated[ClinicMember, Depends(require_clinic_member(MembershipRole.OWNER))]
TZ = ZoneInfo("Asia/Kolkata")


def _local_midnight(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time(), TZ)


def summary(db: Session, clinic_id: uuid.UUID) -> BillingSummary:
    today = datetime.now(TZ).date()
    month_start = today.replace(day=1)
    prev_start = (month_start - timedelta(days=1)).replace(day=1)
    paid = select(func.coalesce(func.sum(Invoice.total_paise), 0)).where(Invoice.clinic_id == clinic_id, Invoice.status == InvoiceStatus.PAID)
    count = select(func.count()).select_from(Invoice).where(Invoice.clinic_id == clinic_id)
    return BillingSummary(
        collected_today_paise=db.scalar(paid.where(Invoice.paid_at >= _local_midnight(today))) or 0,
        collected_today_count=db.scalar(count.where(Invoice.status == InvoiceStatus.PAID, Invoice.paid_at >= _local_midnight(today))) or 0,
        outstanding_paise=db.scalar(select(func.coalesce(func.sum(Invoice.total_paise), 0)).where(Invoice.clinic_id == clinic_id, Invoice.status == InvoiceStatus.DUE)) or 0,
        outstanding_count=db.scalar(count.where(Invoice.status == InvoiceStatus.DUE)) or 0,
        month_paise=db.scalar(paid.where(Invoice.paid_at >= _local_midnight(month_start))) or 0,
        prev_month_paise=db.scalar(paid.where(Invoice.paid_at >= _local_midnight(prev_start), Invoice.paid_at < _local_midnight(month_start))) or 0,
    )


def _list_item(db: Session, inv: Invoice, patient_name: str) -> InvoiceListItem:
    first = db.scalar(select(InvoiceItem.description).where(InvoiceItem.invoice_id == inv.id).limit(1))
    n = db.scalar(select(func.count()).select_from(InvoiceItem).where(InvoiceItem.invoice_id == inv.id, InvoiceItem.amount_paise > 0)) or 0
    return InvoiceListItem(
        id=inv.id, number=inv.number, patient_name=patient_name, clinic_patient_id=inv.clinic_patient_id,
        service=(first or "—") + (f" +{n - 1} more" if n > 1 else ""), issued_on=inv.issued_on, due_on=inv.due_on,
        total_paise=inv.total_paise, status=inv.status, paid_via=inv.paid_via, paid_at=inv.paid_at, from_app=inv.appointment_id is not None,
    )


@router.get("", response_model=InvoicePage)
def list_invoices(
    member: Owner,
    db: DB,
    status_: Annotated[InvoiceStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> InvoicePage:
    stmt = (
        select(Invoice, Patient.full_name)
        .join(ClinicPatient, ClinicPatient.id == Invoice.clinic_patient_id)
        .join(Patient, Patient.id == ClinicPatient.patient_id)
        .where(Invoice.clinic_id == member.clinic_id)
    )
    if status_:
        stmt = stmt.where(Invoice.status == status_)
    if q:
        stmt = stmt.where(or_(Patient.full_name.ilike(f"%{q}%"), Invoice.number.ilike(f"%{q}%")))
    rows = db.execute(stmt.order_by(Invoice.created_at.desc()).limit(limit).offset(offset)).all()
    return InvoicePage(summary=summary(db, member.clinic_id), items=[_list_item(db, inv, name) for inv, name in rows])


@router.post("", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
def new_invoice(body: InvoiceIn, member: Owner, user: CurrentUser, db: DB, request: Request) -> InvoiceOut:
    clinic_patient_or_404(db, member.clinic_id, body.clinic_patient_id)
    if body.branch_id and db.scalar(select(Branch.clinic_id).where(Branch.id == body.branch_id)) != member.clinic_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown branch")
    # Attribute revenue to a branch: the one given, else the creator's, else the clinic's first.
    branch_id = body.branch_id or member.branch_id or db.scalar(
        select(Branch.id).where(Branch.clinic_id == member.clinic_id, Branch.is_active.is_(True)).order_by(Branch.created_at).limit(1)
    )
    inv = create_invoice(
        db, clinic_id=member.clinic_id, branch_id=branch_id, clinic_patient_id=body.clinic_patient_id,
        lines=[Line(**i.model_dump()) for i in body.items], due_on=body.due_on, notes=body.notes, created_by=user.id, paid_via=body.paid_via,
    )
    audit.record(db, action="create", entity="invoice", entity_id=inv.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=f"{inv.number} · ₹{inv.total_paise / 100:.0f}", request=request)
    db.commit()
    return invoice_out(db, inv)


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: uuid.UUID, member: Owner, db: DB) -> InvoiceOut:
    return invoice_out(db, _own(db, member.clinic_id, invoice_id))


@router.post("/{invoice_id}/pay", response_model=InvoiceOut)
def pay_invoice(invoice_id: uuid.UUID, body: PayIn, member: Owner, user: CurrentUser, db: DB, request: Request) -> InvoiceOut:
    inv = _own(db, member.clinic_id, invoice_id)
    if inv.status != InvoiceStatus.DUE:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Invoice is {inv.status.value}")
    mark_paid(inv, body.method)
    audit.record(db, action="payment", entity="invoice", entity_id=inv.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=f"{inv.number} paid via {body.method}", request=request)
    db.commit()
    return invoice_out(db, inv)


@router.post("/{invoice_id}/void", response_model=InvoiceOut)
def void_invoice(invoice_id: uuid.UUID, member: Owner, user: CurrentUser, db: DB, request: Request) -> InvoiceOut:
    inv = _own(db, member.clinic_id, invoice_id)
    if inv.appointment_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "App booking invoices are voided by cancelling the appointment")
    inv.status = InvoiceStatus.VOID
    audit.record(db, action="void", entity="invoice", entity_id=inv.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=inv.number, request=request)
    db.commit()
    return invoice_out(db, inv)


def _own(db: Session, clinic_id: uuid.UUID, invoice_id: uuid.UUID) -> Invoice:
    inv = db.get(Invoice, invoice_id)
    if inv is None or inv.clinic_id != clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    return inv


def invoice_out(db: Session, inv: Invoice) -> InvoiceOut:
    cp = db.get(ClinicPatient, inv.clinic_patient_id)
    patient = db.get(Patient, cp.patient_id)
    clinic = db.get(Clinic, inv.clinic_id)
    branch = db.get(Branch, inv.branch_id) if inv.branch_id else db.scalar(select(Branch).where(Branch.clinic_id == clinic.id).order_by(Branch.created_at).limit(1))
    items = db.scalars(select(InvoiceItem).where(InvoiceItem.invoice_id == inv.id))
    base = _list_item(db, inv, patient.full_name)
    return InvoiceOut(
        **base.model_dump(),
        subtotal_paise=inv.subtotal_paise, tax_paise=inv.tax_paise, notes=inv.notes,
        items=[InvoiceLineOut(description=i.description, detail=i.detail, quantity=i.quantity, rate_paise=i.rate_paise, amount_paise=i.amount_paise) for i in items],
        patient={"name": patient.full_name, "phone": patient.phone, "age": age_of(patient.date_of_birth), "sex": patient.sex.value if patient.sex else None},
        clinic={
            "name": clinic.name, "logo_url": clinic.logo_url, "phone": clinic.phone, "email": clinic.email, "gstin": clinic.gstin,
            "address": clinic.address or (", ".join(x for x in [branch.address, branch.area, branch.city] if x) if branch else None),
        },
    )


# Patients see their own invoices.
me_router = APIRouter(prefix="/me/invoices", tags=["billing"])


@me_router.get("", response_model=list[InvoiceListItem])
def my_invoices(user: CurrentUser, db: DB) -> list[InvoiceListItem]:
    rows = db.execute(
        select(Invoice, Patient.full_name)
        .join(ClinicPatient, ClinicPatient.id == Invoice.clinic_patient_id)
        .join(Patient, Patient.id == ClinicPatient.patient_id)
        .where(Patient.user_id == user.id, Invoice.status != InvoiceStatus.VOID)
        .order_by(Invoice.created_at.desc())
        .limit(100)
    ).all()
    return [_list_item(db, inv, name) for inv, name in rows]


@me_router.get("/{invoice_id}", response_model=InvoiceOut)
def my_invoice(invoice_id: uuid.UUID, user: CurrentUser, db: DB) -> InvoiceOut:
    inv = db.get(Invoice, invoice_id)
    owner = db.scalar(select(Patient.user_id).join(ClinicPatient, ClinicPatient.patient_id == Patient.id).where(ClinicPatient.id == inv.clinic_patient_id)) if inv else None
    if inv is None or owner != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    return invoice_out(db, inv)

