import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models._types import str_enum


class PaymentPurpose(StrEnum):
    APPOINTMENT = "appointment"  # patient booking via app — platform takes a commission
    INVOICE = "invoice"  # clinic invoice
    SUBSCRIPTION = "subscription"  # clinic pays for the PMS


class PaymentStatus(StrEnum):
    CREATED = "created"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"


class Payment(UUIDPk, Timestamps, Base):
    """One Razorpay order/payment. Amounts in paise."""

    __tablename__ = "payments"

    purpose: Mapped[PaymentPurpose] = mapped_column(str_enum(PaymentPurpose), index=True)
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id"), index=True)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"), index=True)
    amount_paise: Mapped[int] = mapped_column(Integer)
    points_redeemed: Mapped[int] = mapped_column(Integer, default=0)
    platform_fee_paise: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[PaymentStatus] = mapped_column(str_enum(PaymentStatus), default=PaymentStatus.CREATED, index=True)
    method: Mapped[str | None] = mapped_column(String(30))  # upi, card, netbanking, cash …
    razorpay_order_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)


class InvoiceStatus(StrEnum):
    DRAFT = "draft"
    DUE = "due"
    PAID = "paid"
    VOID = "void"


class Invoice(UUIDPk, Timestamps, Base):
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("clinic_id", "number"),)

    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    clinic_patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_patients.id"), index=True)
    number: Mapped[str] = mapped_column(String(30))  # "INV-2026-0042"
    issued_on: Mapped[date] = mapped_column(Date)
    due_on: Mapped[date | None] = mapped_column(Date)
    status: Mapped[InvoiceStatus] = mapped_column(str_enum(InvoiceStatus), default=InvoiceStatus.DUE, index=True)
    subtotal_paise: Mapped[int] = mapped_column(Integer, default=0)
    tax_paise: Mapped[int] = mapped_column(Integer, default=0)  # healthcare services are GST-exempt by default
    total_paise: Mapped[int] = mapped_column(Integer, default=0)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("payments.id"))
    paid_via: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text)


class InvoiceItem(UUIDPk, Base):
    __tablename__ = "invoice_items"

    invoice_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    description: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str | None] = mapped_column(String(200))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    rate_paise: Mapped[int] = mapped_column(Integer)
    amount_paise: Mapped[int] = mapped_column(Integer)
