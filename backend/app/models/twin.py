"""Digital twin: measurements, targets, daily check-ins and consent (see docs/digital-twin/A-knee-twin.md).

Measurements are shaped like a FHIR Observation (code, value, unit, side, source, time) so they can be exported later.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Numeric, SmallInteger, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models._types import str_enum


class Side(StrEnum):
    LEFT = "left"
    RIGHT = "right"
    NONE = "none"  # measures that aren't sided, e.g. overall pain


class MeasurementSource(StrEnum):
    CLINIC = "clinic"
    SELF = "self"
    CAMERA = "camera"


class Measurement(UUIDPk, Timestamps, Base):
    __tablename__ = "measurements"
    __table_args__ = (Index("ix_measurements_patient_code_time", "patient_id", "code", "measured_at"),)

    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"))
    clinic_patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_patients.id", ondelete="CASCADE"), index=True)
    care_plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id", ondelete="SET NULL"))
    code: Mapped[str] = mapped_column(String(40))  # see services/twin.py CODES
    side: Mapped[Side] = mapped_column(str_enum(Side))
    value: Mapped[Decimal] = mapped_column(Numeric(6, 1))
    unit: Mapped[str] = mapped_column(String(10))  # deg, cm, score
    source: Mapped[MeasurementSource] = mapped_column(str_enum(MeasurementSource))
    method: Mapped[str] = mapped_column(String(30))  # goniometer, tape, self_report, camera_v1 …
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    consultation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("consultations.id", ondelete="SET NULL"))
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))  # camera readings only
    # False = implausible jump awaiting the physio's confirmation; excluded from targets and (later) rules.
    trusted: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(Text)


class CarePlanTarget(UUIDPk, Timestamps, Base):
    __tablename__ = "care_plan_targets"
    __table_args__ = (UniqueConstraint("care_plan_id", "code", "side"),)

    care_plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    side: Mapped[Side] = mapped_column(str_enum(Side))
    target_value: Mapped[Decimal] = mapped_column(Numeric(6, 1))
    by_week: Mapped[int | None] = mapped_column(SmallInteger)  # weeks after surgery (or plan start); null = end of plan


class Swelling(StrEnum):
    NONE = "none"
    MILD = "mild"
    MODERATE = "moderate"
    SEVERE = "severe"


class Sleep(StrEnum):
    GOOD = "good"
    OK = "ok"
    POOR = "poor"


class ExercisesDone(StrEnum):
    ALL = "all"
    SOME = "some"
    NONE = "none"


class CheckinSource(StrEnum):
    APP = "app"
    WEB = "web"
    WHATSAPP = "whatsapp"


class DailyCheckin(UUIDPk, Timestamps, Base):
    """The patient's 30-second daily check-in. One per patient per (local) day; re-submitting edits it."""

    __tablename__ = "daily_checkins"
    __table_args__ = (UniqueConstraint("patient_id", "day"),)

    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"))
    care_plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date)  # patient's local date
    pain: Mapped[int] = mapped_column(SmallInteger)  # 0–10
    stiffness: Mapped[int] = mapped_column(SmallInteger)  # 0–10
    swelling: Mapped[Swelling] = mapped_column(str_enum(Swelling))
    sleep: Mapped[Sleep] = mapped_column(str_enum(Sleep))
    exercises: Mapped[ExercisesDone] = mapped_column(str_enum(ExercisesDone))  # yesterday's home exercises
    red_flags: Mapped[list[str]] = mapped_column(ARRAY(String(30)), default=list)  # see services/twin.py RED_FLAGS
    note: Mapped[str | None] = mapped_column(Text)
    source: Mapped[CheckinSource] = mapped_column(str_enum(CheckinSource))


class Consent(UUIDPk, Base):
    """A patient's consent for one purpose (DPDP Act 2023). Withdrawing stamps withdrawn_at; granting again adds a row."""

    __tablename__ = "consents"
    __table_args__ = (
        Index("uq_consents_active", "patient_id", "purpose", unique=True, postgresql_where=text("withdrawn_at IS NULL")),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(30))  # twin_tracking; later camera_analysis, ai_processing, whatsapp
    version: Mapped[str] = mapped_column(String(20))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FlagSeverity(StrEnum):
    INFO = "info"
    WATCH = "watch"
    ACT = "act"


class FlagStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"  # seen by the physio, still active
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


ACTIVE_FLAG_STATUSES = (FlagStatus.OPEN, FlagStatus.ACKNOWLEDGED)


class TwinFlag(UUIDPk, Timestamps, Base):
    """A rule firing for one care plan (services/twin_rules.py). At most one active flag per plan and rule."""

    __tablename__ = "twin_flags"
    __table_args__ = (
        Index("uq_twin_flags_active", "care_plan_id", "rule", unique=True, postgresql_where=text("status IN ('open', 'acknowledged')")),
    )

    clinic_patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_patients.id", ondelete="CASCADE"), index=True)
    care_plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id", ondelete="CASCADE"), index=True)
    rule: Mapped[str] = mapped_column(String(40))  # e.g. pain_rising, rom_plateau:right
    # Event rules key each occurrence (e.g. the day of a red flag); condition rules use the rule itself.
    key: Mapped[str] = mapped_column(String(60))
    severity: Mapped[FlagSeverity] = mapped_column(str_enum(FlagSeverity))
    status: Mapped[FlagStatus] = mapped_column(str_enum(FlagStatus), default=FlagStatus.OPEN, index=True)
    summary: Mapped[str] = mapped_column(String(300))
    evidence: Mapped[dict] = mapped_column(JSONB, default=dict)  # the exact numbers behind the flag
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    clear_since: Mapped[date | None] = mapped_column(Date)  # first day the condition stopped holding (auto-resolve)
    cleared: Mapped[bool] = mapped_column(Boolean, default=False)  # closed flag whose condition has since cleared
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    resolution_note: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)  # reserved for GenAI explanations


class SuggestionAuthor(StrEnum):
    RULES = "rules"
    PHYSIO = "physio"
    AI = "ai"


class SuggestionStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"  # its flag closed, or the plan changed before a decision


class PlanSuggestion(UUIDPk, Timestamps, Base):
    """A proposed change to a care plan's exercises. Nothing is applied until a physio approves it."""

    __tablename__ = "plan_suggestions"
    __table_args__ = (
        Index("uq_plan_suggestions_pending_flag", "flag_id", unique=True, postgresql_where=text("status = 'pending'")),
    )

    care_plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("care_plans.id", ondelete="CASCADE"), index=True)
    flag_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("twin_flags.id", ondelete="SET NULL"), index=True)
    author: Mapped[SuggestionAuthor] = mapped_column(str_enum(SuggestionAuthor))
    title: Mapped[str] = mapped_column(String(160))
    rationale: Mapped[str] = mapped_column(Text)
    # [{plan_exercise_id, field: sets|reps|hold_seconds|is_active, before, after}] — see services/suggestions.py
    changes: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[SuggestionStatus] = mapped_column(str_enum(SuggestionStatus), default=SuggestionStatus.PENDING, index=True)
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    applied_changes: Mapped[list | None] = mapped_column(JSONB)  # what was applied, if the physio edited it


class ValidationPair(UUIDPk, Base):
    """A camera reading and a goniometer reading of the same movement, taken together (design B1).

    These decide whether camera angles are accurate enough to use clinically (Bland–Altman agreement).
    """

    __tablename__ = "validation_pairs"

    clinic_patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_patients.id", ondelete="CASCADE"), index=True)
    camera_measurement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("measurements.id", ondelete="CASCADE"))
    reference_measurement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("measurements.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(40))
    side: Mapped[Side] = mapped_column(str_enum(Side))
    posture: Mapped[str] = mapped_column(String(20))  # supine, seated, standing
    camera_value: Mapped[Decimal] = mapped_column(Numeric(6, 1))
    camera_value_3d: Mapped[Decimal | None] = mapped_column(Numeric(6, 1))  # from 3D world landmarks, for comparison
    reference_value: Mapped[Decimal] = mapped_column(Numeric(6, 1))  # goniometer
    confidence: Mapped[Decimal] = mapped_column(Numeric(3, 2))
    frames: Mapped[int] = mapped_column(SmallInteger)
    spread: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    fps: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    model: Mapped[str] = mapped_column(String(60))
    device: Mapped[str | None] = mapped_column(String(200))  # browser user agent
    lighting: Mapped[str | None] = mapped_column(String(20))
    clothing: Mapped[str | None] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(Text)
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())



class WhatsAppSession(UUIDPk, Timestamps, Base):
    """One day's WhatsApp check-in conversation (design C). Answers are copied into daily_checkins when complete."""

    __tablename__ = "whatsapp_sessions"
    __table_args__ = (UniqueConstraint("patient_id", "day"),)

    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)  # IST
    step: Mapped[str] = mapped_column(String(20))  # invite, pain, stiffness, swelling, sleep, exercises, red, red_which, done, skipped
    answers: Mapped[dict] = mapped_column(JSONB, default=dict)


class WhatsAppMessage(UUIDPk, Base):
    """Delivery log for audit and de-duplicating webhook retries. Holds no message content."""

    __tablename__ = "whatsapp_messages"

    provider_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    direction: Mapped[str] = mapped_column(String(3))  # in, out
    patient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # template, text, buttons, list, inbound
    status: Mapped[str | None] = mapped_column(String(20))  # sent, delivered, read, failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
