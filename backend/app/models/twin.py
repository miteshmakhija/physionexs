"""Digital twin: structured measurements and care-plan targets (see docs/digital-twin/A-knee-twin.md).

Measurements are shaped like a FHIR Observation (code, value, unit, side, source, time) so they can be exported later.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
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
