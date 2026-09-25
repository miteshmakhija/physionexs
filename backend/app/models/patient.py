import uuid
from datetime import date
from enum import StrEnum

from sqlalchemy import Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models._types import str_enum


class Sex(StrEnum):
    MALE = "M"
    FEMALE = "F"
    OTHER = "O"


class Patient(UUIDPk, Timestamps, Base):
    """A person receiving care. `user_id` is null for walk-ins registered at reception without the app."""

    __tablename__ = "patients"

    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(20), index=True)
    email: Mapped[str | None] = mapped_column(String(254))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    sex: Mapped[Sex | None] = mapped_column(str_enum(Sex, 2))
    city: Mapped[str | None] = mapped_column(String(80))
    points_balance: Mapped[int] = mapped_column(Integer, default=0)
    current_streak_days: Mapped[int] = mapped_column(Integer, default=0)
    best_streak_days: Mapped[int] = mapped_column(Integer, default=0)


class ClinicPatientStatus(StrEnum):
    ACTIVE = "active"
    DISCHARGED = "discharged"


class ClinicPatient(UUIDPk, Timestamps, Base):
    """A patient's file at one clinic. Clinical records hang off this, so clinics never see each other's data."""

    __tablename__ = "clinic_patients"
    __table_args__ = (UniqueConstraint("clinic_id", "patient_id"),)

    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    primary_physio_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    mrn: Mapped[str | None] = mapped_column(String(30))  # clinic's own patient number
    status: Mapped[ClinicPatientStatus] = mapped_column(str_enum(ClinicPatientStatus), default=ClinicPatientStatus.ACTIVE)
    first_visit_on: Mapped[date | None] = mapped_column(Date)
    last_visit_on: Mapped[date | None] = mapped_column(Date)


class CoreGrade(StrEnum):
    POOR = "poor"
    FAIR = "fair"
    GOOD = "good"
    STRONG = "strong"


class MedicalBackground(UUIDPk, Timestamps, Base):
    """Medical background & functional analysis for a clinic patient file."""

    __tablename__ = "medical_backgrounds"

    clinic_patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinic_patients.id", ondelete="CASCADE"), unique=True
    )
    past_history: Mapped[str | None] = mapped_column(Text)
    conditions: Mapped[list[str]] = mapped_column(ARRAY(String(80)), default=list)
    # [{"name": "Telmisartan 40 mg", "frequency": "1-0-0", "note": "ongoing"}]
    prior_medicines: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    core_strengths: Mapped[str | None] = mapped_column(Text)
    weaknesses: Mapped[str | None] = mapped_column(Text)
    core_grade: Mapped[CoreGrade | None] = mapped_column(str_enum(CoreGrade))
