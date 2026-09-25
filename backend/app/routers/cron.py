"""Scheduled jobs, called by Vercel Cron (see backend/vercel.json).

Vercel sends `Authorization: Bearer $CRON_SECRET`. Each job is idempotent, so a retried or
overlapping run does no harm.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from sqlalchemy import select, update

from app.core.config import get_settings
from app.core.deps import DB
from app.models.clinic import Clinic, Subscription, SubscriptionStatus
from app.models.engagement import Notification
from app.models.patient import Patient
from app.models.scheduling import Appointment, AppointmentStatus
from app.models.user import User

router = APIRouter(prefix="/cron", tags=["cron"], include_in_schema=False)
settings = get_settings()


def _authorize(authorization: str | None) -> None:
    if not settings.cron_secret or authorization != f"Bearer {settings.cron_secret}":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unauthorized")


@router.get("/hourly")
def hourly(db: DB, authorization: Annotated[str | None, Header()] = None) -> dict:
    _authorize(authorization)
    now = datetime.now(UTC)

    expired = db.execute(
        update(Appointment)
        .where(Appointment.status == AppointmentStatus.PENDING, Appointment.hold_expires_at < now)
        .values(status=AppointmentStatus.CANCELLED, notes="Payment hold expired")
    ).rowcount

    sent = 0
    for hours, flag in ((24, "reminder_24h_sent_at"), (2, "reminder_2h_sent_at")):
        col = getattr(Appointment, flag)
        # Anything starting within the next `hours` (plus one run of slack) that hasn't been reminded.
        due = db.scalars(
            select(Appointment).where(
                Appointment.status == AppointmentStatus.CONFIRMED, Appointment.starts_at > now,
                Appointment.starts_at <= now + timedelta(hours=hours, minutes=5), col.is_(None),
            ).with_for_update(skip_locked=True)
        ).all()
        for appt in due:
            patient = db.get(Patient, appt.patient_id)
            physio = db.get(User, appt.physio_user_id)
            if patient.user_id:
                when = "tomorrow" if hours == 24 else "in 2 hours"
                db.add(Notification(user_id=patient.user_id, kind="appointment_reminder", title=f"Appointment {when}",
                                    body=f"With {physio.full_name} · {appt.mode.value.replace('_', '-')}", data={"appointment_id": str(appt.id)}))
                sent += 1
            setattr(appt, flag, now)
            if hours == 24 and appt.starts_at - now <= timedelta(hours=2, minutes=5):
                appt.reminder_2h_sent_at = now  # booked late: one reminder is enough
    db.commit()
    return {"expired_holds": expired, "reminders": sent}


@router.get("/daily")
def daily(db: DB, authorization: Annotated[str | None, Header()] = None) -> dict:
    _authorize(authorization)
    now = datetime.now(UTC)
    overdue = reminded = 0
    for sub in db.scalars(select(Subscription).where(Subscription.status.in_([SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE, SubscriptionStatus.OVERDUE])).with_for_update(skip_locked=True)):
        end = sub.current_period_end or sub.trial_ends_at
        if end is None:
            continue
        clinic = db.get(Clinic, sub.clinic_id)
        if end < now and sub.status != SubscriptionStatus.OVERDUE:
            sub.status = SubscriptionStatus.OVERDUE
            overdue += 1
            db.add(Notification(user_id=clinic.owner_user_id, kind="subscription_overdue", title="Your Physionexs subscription is overdue",
                                body="Pay now to keep your practice console running."))
            sub.last_reminder_at = now
        elif timedelta(0) <= end - now <= timedelta(days=3) and (sub.last_reminder_at is None or now - sub.last_reminder_at > timedelta(hours=23)):
            days = max(1, (end - now).days)
            db.add(Notification(user_id=clinic.owner_user_id, kind="subscription_due", title=f"Subscription due in {days} day{'s' if days > 1 else ''}",
                                body=f"₹{sub.price_paise / 100:,.0f} · {sub.plan.value} plan"))
            sub.last_reminder_at = now
            reminded += 1
    db.commit()
    return {"overdue": overdue, "reminders": reminded}
