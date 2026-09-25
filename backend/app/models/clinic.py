import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models._types import str_enum


class Clinic(UUIDPk, Timestamps, Base):
    __tablename__ = "clinics"

    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(160), unique=True)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    logo_url: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(254))
    address: Mapped[str | None] = mapped_column(Text)
    gstin: Mapped[str | None] = mapped_column(String(15))
    # Platform commission on patient bookings, in basis points (1000 = 10%).
    platform_fee_bps: Mapped[int] = mapped_column(Integer, default=1000)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Branch(UUIDPk, Timestamps, Base):
    __tablename__ = "branches"

    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    area: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(80), index=True)
    address: Mapped[str | None] = mapped_column(Text)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    hours: Mapped[str | None] = mapped_column(String(120))  # display text, e.g. "Mon–Sat · 8 AM–8 PM"
    timezone: Mapped[str] = mapped_column(String(40), default="Asia/Kolkata", server_default="Asia/Kolkata")
    therapy_rooms: Mapped[int] = mapped_column(Integer, default=1)
    lead_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class MembershipRole(StrEnum):
    OWNER = "owner"  # "Doctor-Admin" in the design — full access
    PHYSIO = "physio"
    STAFF = "staff"  # no billing / analytics


class ClinicMember(UUIDPk, Timestamps, Base):
    """A user's employment at a clinic. Also the HR record (payroll, attendance, leave)."""

    __tablename__ = "clinic_members"
    __table_args__ = (UniqueConstraint("clinic_id", "user_id"),)

    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id", ondelete="SET NULL"))
    role: Mapped[MembershipRole] = mapped_column(str_enum(MembershipRole))
    employee_code: Mapped[str | None] = mapped_column(String(20))
    job_title: Mapped[str | None] = mapped_column(String(80))
    department: Mapped[str | None] = mapped_column(String(80))
    monthly_salary_paise: Mapped[int | None] = mapped_column(Integer)
    joined_on: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class VerificationStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class PhysioProfile(UUIDPk, Timestamps, Base):
    """Public profile of a physiotherapist. Goes live only after council registration is verified."""

    __tablename__ = "physio_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    qualification: Mapped[str | None] = mapped_column(String(120))  # e.g. "MPT (Ortho)"
    registration_no: Mapped[str] = mapped_column(String(60))
    council: Mapped[str | None] = mapped_column(String(80))  # e.g. "IAP", "HCPC"
    verification_status: Mapped[VerificationStatus] = mapped_column(
        str_enum(VerificationStatus), default=VerificationStatus.PENDING, index=True
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    bio: Mapped[str | None] = mapped_column(Text)
    college: Mapped[str | None] = mapped_column(String(160))
    experience_years: Mapped[int | None] = mapped_column(Integer)
    specializations: Mapped[list[str]] = mapped_column(ARRAY(String(60)), default=list)
    languages: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    offers_in_clinic: Mapped[bool] = mapped_column(Boolean, default=True)
    offers_online: Mapped[bool] = mapped_column(Boolean, default=False)
    fee_in_clinic_paise: Mapped[int | None] = mapped_column(Integer)
    fee_online_paise: Mapped[int | None] = mapped_column(Integer)

    # Denormalised for search/listing; recomputed when reviews change.
    rating_avg: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=0)
    reviews_count: Mapped[int] = mapped_column(Integer, default=0)


class SubscriptionPlan(StrEnum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class SubscriptionStatus(StrEnum):
    TRIAL = "trial"
    ACTIVE = "active"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"


class Subscription(UUIDPk, Timestamps, Base):
    """PMS (practice console) subscription for a clinic. Price is set per clinic by the Super Admin."""

    __tablename__ = "subscriptions"

    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), unique=True)
    plan: Mapped[SubscriptionPlan] = mapped_column(str_enum(SubscriptionPlan), default=SubscriptionPlan.MONTHLY)
    price_paise: Mapped[int] = mapped_column(Integer, default=50_000)
    status: Mapped[SubscriptionStatus] = mapped_column(str_enum(SubscriptionStatus), default=SubscriptionStatus.TRIAL, index=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
