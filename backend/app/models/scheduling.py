import uuid
from datetime import date, datetime, time
from enum import StrEnum

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text, Time, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models._types import str_enum


class ConsultMode(StrEnum):
    IN_CLINIC = "in_clinic"
    ONLINE = "online"


class Availability(UUIDPk, Timestamps, Base):
    """Weekly recurring working hours of a physio at a branch; bookable slots are generated from these."""

    __tablename__ = "availabilities"

    physio_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"))
    weekday: Mapped[int] = mapped_column(SmallInteger)  # 0 = Monday
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    slot_minutes: Mapped[int] = mapped_column(Integer, default=30)


class AppointmentStatus(StrEnum):
    PENDING = "pending"  # booked from the app, awaiting clinic confirmation / payment
    CONFIRMED = "confirmed"
    CHECKED_IN = "checked_in"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class AppointmentKind(StrEnum):
    INITIAL = "initial"
    FOLLOW_UP = "follow_up"


class AppointmentSource(StrEnum):
    PATIENT_APP = "patient_app"
    RECEPTION = "reception"


class Appointment(UUIDPk, Timestamps, Base):
    __tablename__ = "appointments"
    __table_args__ = (
        Index("ix_appointments_physio_starts", "physio_user_id", "starts_at"),
        # A physio can hold only one live booking per start time. Cancelled/no-show rows don't count,
        # so a slot frees up again when a booking is cancelled or its payment hold expires.
        Index(
            "uq_appointments_physio_slot_live",
            "physio_user_id",
            "starts_at",
            unique=True,
            postgresql_where=text("status IN ('pending', 'confirmed', 'checked_in', 'completed')"),
        ),
    )

    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    physio_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    mode: Mapped[ConsultMode] = mapped_column(str_enum(ConsultMode))
    kind: Mapped[AppointmentKind] = mapped_column(str_enum(AppointmentKind), default=AppointmentKind.INITIAL)
    status: Mapped[AppointmentStatus] = mapped_column(str_enum(AppointmentStatus), default=AppointmentStatus.PENDING, index=True)
    source: Mapped[AppointmentSource] = mapped_column(str_enum(AppointmentSource))
    reason: Mapped[str | None] = mapped_column(String(200))
    referral_source: Mapped[str | None] = mapped_column(String(60))  # "How did you find ...?"
    fee_paise: Mapped[int] = mapped_column(Integer, default=0)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("payments.id"))
    # Unpaid app bookings hold the slot until this time, then are cancelled.
    hold_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    video_room_id: Mapped[str | None] = mapped_column(String(120))
    reminder_24h_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder_2h_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)


class TokenStatus(StrEnum):
    WAITING = "waiting"
    SERVING = "serving"
    DONE = "done"
    SKIPPED = "skipped"


class QueueToken(UUIDPk, Timestamps, Base):
    """Walk-in token issued at reception (T-01, T-02 … per branch per day)."""

    __tablename__ = "queue_tokens"
    __table_args__ = (UniqueConstraint("branch_id", "service_date", "number"),)

    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"))
    service_date: Mapped[date] = mapped_column(Date)
    number: Mapped[int] = mapped_column(Integer)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"))
    physio_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    reason: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[TokenStatus] = mapped_column(str_enum(TokenStatus), default=TokenStatus.WAITING, index=True)
    called_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def label(self) -> str:
        return f"T-{self.number:02d}"
