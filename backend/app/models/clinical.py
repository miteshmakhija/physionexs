import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, SmallInteger, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models._types import str_enum


class CarePlanStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class CarePlan(UUIDPk, Timestamps, Base):
    __tablename__ = "care_plans"

    clinic_patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_patients.id", ondelete="CASCADE"), index=True)
    physio_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    condition: Mapped[str] = mapped_column(String(160))  # e.g. "Grade II MCL sprain"
    condition_detail: Mapped[str | None] = mapped_column(String(200))
    goal: Mapped[str | None] = mapped_column(String(200))
    stage: Mapped[str | None] = mapped_column(String(80))  # e.g. "Week 2 of 6"
    notes: Mapped[str | None] = mapped_column(Text)  # physio's advice shown to the patient
    sessions_planned: Mapped[int | None] = mapped_column(SmallInteger)
    starts_on: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    ends_on: Mapped[date | None] = mapped_column(Date)
    status: Mapped[CarePlanStatus] = mapped_column(str_enum(CarePlanStatus), default=CarePlanStatus.ACTIVE, index=True)


class Consultation(UUIDPk, Timestamps, Base):
    """SOAP note + vitals for one visit."""

    __tablename__ = "consultations"

    clinic_patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_patients.id", ondelete="CASCADE"), index=True)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("appointments.id"))
    care_plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id"))
    physio_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    title: Mapped[str | None] = mapped_column(String(120))  # "Follow-up", "Initial assessment"
    subjective: Mapped[str | None] = mapped_column(Text)
    objective: Mapped[str | None] = mapped_column(Text)
    assessment: Mapped[str | None] = mapped_column(Text)
    plan: Mapped[str | None] = mapped_column(Text)
    # {"knee_flexion_deg": 120, "quads_mmt": "4/5", "pain_vas": 3, "swelling": "mild"}
    vitals: Mapped[dict] = mapped_column(JSONB, default=dict)
    pain_vas: Mapped[int | None] = mapped_column(SmallInteger)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Frequency(StrEnum):
    DAILY = "daily"
    ALTERNATE_DAYS = "alternate_days"
    WEEKLY_3X = "weekly_3x"
    WEEKLY = "weekly"


class CarePlanExercise(UUIDPk, Timestamps, Base):
    __tablename__ = "care_plan_exercises"

    care_plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id", ondelete="CASCADE"), index=True)
    exercise_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("exercises.id"))
    position: Mapped[int] = mapped_column(SmallInteger, default=0)
    sets: Mapped[int] = mapped_column(SmallInteger)
    reps: Mapped[int | None] = mapped_column(SmallInteger)
    hold_seconds: Mapped[int | None] = mapped_column(SmallInteger)
    rest_seconds: Mapped[int] = mapped_column(SmallInteger, default=30)
    frequency: Mapped[Frequency] = mapped_column(str_enum(Frequency), default=Frequency.DAILY)
    times_per_day: Mapped[int] = mapped_column(SmallInteger, default=1)
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Feel(StrEnum):
    EASY = "easy"
    OK = "ok"
    HARD = "hard"


class ExerciseLog(UUIDPk, Base):
    __tablename__ = "exercise_logs"
    __table_args__ = (Index("ix_exercise_logs_patient_day", "patient_id", "logged_on"),)

    plan_exercise_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plan_exercises.id", ondelete="CASCADE"))
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"))
    logged_on: Mapped[date] = mapped_column(Date)  # patient's local date
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    feel: Mapped[Feel | None] = mapped_column(str_enum(Feel))
    pain: Mapped[int | None] = mapped_column(SmallInteger)  # 0–10
    note: Mapped[str | None] = mapped_column(Text)


class Medication(UUIDPk, Timestamps, Base):
    __tablename__ = "medications"

    care_plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))  # "Ibuprofen 400 mg"
    dose: Mapped[str | None] = mapped_column(String(60))  # "1 tablet"
    frequency: Mapped[str] = mapped_column(String(20))  # "1-0-1"
    timing: Mapped[str | None] = mapped_column(String(60))  # "After food"
    duration_days: Mapped[int | None] = mapped_column(SmallInteger)
    instructions: Mapped[str | None] = mapped_column(Text)
    # Local times for reminders, "HH:MM" strings: ["08:30", "21:00"]
    reminder_times: Mapped[list[str]] = mapped_column(ARRAY(String(5)), default=list)
    starts_on: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class MedicationLog(UUIDPk, Base):
    __tablename__ = "medication_logs"
    __table_args__ = (
        Index("ix_medication_logs_patient_day", "patient_id", "logged_on"),
        UniqueConstraint("medication_id", "logged_on", "dose_slot", name="uq_medication_logs_dose"),
    )

    medication_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("medications.id", ondelete="CASCADE"))
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"))
    logged_on: Mapped[date] = mapped_column(Date)
    dose_slot: Mapped[str] = mapped_column(String(5))  # "08:30"
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TestOrderStatus(StrEnum):
    ORDERED = "ordered"
    RESULT_READY = "result_ready"
    CANCELLED = "cancelled"


class TestOrder(UUIDPk, Timestamps, Base):
    __tablename__ = "test_orders"

    clinic_patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_patients.id", ondelete="CASCADE"), index=True)
    care_plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id"))
    ordered_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(120))  # "MRI knee", "X-Ray", "Blood panel"
    status: Mapped[TestOrderStatus] = mapped_column(str_enum(TestOrderStatus), default=TestOrderStatus.ORDERED)
    result_note: Mapped[str | None] = mapped_column(Text)
    result_file_urls: Mapped[list[str]] = mapped_column(ARRAY(String(500)), default=list)
    result_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Prescription(UUIDPk, Timestamps, Base):
    """Issued prescription. `snapshot` freezes what was printed (diagnosis, meds, exercises, advice)."""

    __tablename__ = "prescriptions"

    clinic_patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_patients.id", ondelete="CASCADE"), index=True)
    care_plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id"))
    consultation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("consultations.id"))
    physio_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    rx_no: Mapped[str] = mapped_column(String(30), unique=True)
    snapshot: Mapped[dict] = mapped_column(JSONB)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
