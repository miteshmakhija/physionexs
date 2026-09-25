"""Bookable slots, generated from weekly availability minus live bookings."""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models.clinic import Branch
from app.models.scheduling import Appointment, AppointmentStatus, Availability

# A slot must start at least this far in the future to be bookable.
BOOKING_LEAD = timedelta(minutes=30)
MAX_DAYS_AHEAD = 30

LIVE_STATUSES = (
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.COMPLETED,
)


@dataclass(frozen=True)
class Slot:
    starts_at: datetime  # UTC
    ends_at: datetime
    branch_id: uuid.UUID
    available: bool


@dataclass
class DaySlots:
    day: date
    slots: list[Slot]


def live_booking_filter(now: datetime):
    """Appointments that occupy their slot: live status, and unpaid holds that haven't expired."""
    return and_(
        Appointment.status.in_(LIVE_STATUSES),
        or_(
            Appointment.status != AppointmentStatus.PENDING,
            Appointment.hold_expires_at.is_(None),
            Appointment.hold_expires_at > now,
        ),
    )


def physio_timezone(db: Session, physio_user_id: uuid.UUID) -> ZoneInfo:
    tz = db.scalar(
        select(Branch.timezone)
        .join(Availability, Availability.branch_id == Branch.id)
        .where(Availability.physio_user_id == physio_user_id)
        .limit(1)
    )
    return ZoneInfo(tz or "Asia/Kolkata")


def list_slots(
    db: Session,
    physio_user_id: uuid.UUID,
    start: date,
    days: int,
    now: datetime | None = None,
) -> list[DaySlots]:
    now = now or datetime.now(UTC)
    days = max(1, min(days, MAX_DAYS_AHEAD))

    rows = db.execute(
        select(Availability, Branch.timezone)
        .join(Branch, Branch.id == Availability.branch_id)
        .where(Availability.physio_user_id == physio_user_id, Branch.is_active.is_(True))
        .order_by(Availability.start_time)
    ).all()
    if not rows:
        return [DaySlots(start + timedelta(days=i), []) for i in range(days)]

    window_start = datetime.combine(start, time.min, ZoneInfo(rows[0][1])) - timedelta(days=1)
    window_end = window_start + timedelta(days=days + 2)
    taken = set(
        db.scalars(
            select(Appointment.starts_at).where(
                Appointment.physio_user_id == physio_user_id,
                Appointment.starts_at >= window_start,
                Appointment.starts_at < window_end,
                live_booking_filter(now),
            )
        )
    )
    taken = {t.astimezone(UTC) for t in taken}

    result: list[DaySlots] = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        slots: list[Slot] = []
        for avail, tz_name in rows:
            if avail.weekday != day.weekday():
                continue
            tz = ZoneInfo(tz_name)
            cursor = datetime.combine(day, avail.start_time, tz)
            end = datetime.combine(day, avail.end_time, tz)
            step = timedelta(minutes=avail.slot_minutes)
            while cursor + step <= end:
                starts = cursor.astimezone(UTC)
                slots.append(
                    Slot(
                        starts_at=starts,
                        ends_at=(cursor + step).astimezone(UTC),
                        branch_id=avail.branch_id,
                        available=starts >= now + BOOKING_LEAD and starts not in taken,
                    )
                )
                cursor += step
        slots.sort(key=lambda s: s.starts_at)
        result.append(DaySlots(day, slots))
    return result


def find_slot(db: Session, physio_user_id: uuid.UUID, starts_at: datetime, now: datetime | None = None) -> Slot | None:
    """The slot starting at `starts_at` if it exists in the physio's hours (available or not)."""
    starts_at = starts_at.astimezone(UTC)
    local_day = starts_at.astimezone(physio_timezone(db, physio_user_id)).date()
    for day in list_slots(db, physio_user_id, local_day, 1, now):
        for slot in day.slots:
            if slot.starts_at == starts_at:
                return slot
    return None


def next_available(db: Session, physio_user_id: uuid.UUID, days: int = 14, now: datetime | None = None) -> Slot | None:
    now = now or datetime.now(UTC)
    today = now.astimezone(physio_timezone(db, physio_user_id)).date()
    for day in list_slots(db, physio_user_id, today, days, now):
        for slot in day.slots:
            if slot.available:
                return slot
    return None
