"""Practice console dashboard and analytics."""

import uuid
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, literal_column, select
from sqlalchemy.orm import Session

from app.core.deps import DB, require_clinic_member
from app.models.billing import Invoice, InvoiceStatus
from app.models.clinic import Branch, ClinicMember, MembershipRole, PhysioProfile, Subscription, SubscriptionStatus
from app.models.clinical import CarePlan, CarePlanStatus
from app.models.engagement import Review
from app.models.patient import ClinicPatient, ClinicPatientStatus, Patient
from app.models.scheduling import Appointment, AppointmentStatus, ConsultMode, QueueToken, TokenStatus
from app.models.user import User
from app.schemas.business import AnalyticsOut, AttentionItem, BranchStat, DashboardOut, ScheduleItem, SeriesPoint, Share, SubscriptionOut
from app.services.adherence import adherence_pct, day_stats

router = APIRouter(prefix="/clinic", tags=["insights"])

Member = Annotated[ClinicMember, Depends(require_clinic_member())]
Owner = Annotated[ClinicMember, Depends(require_clinic_member(MembershipRole.OWNER))]
TZ = ZoneInfo("Asia/Kolkata")
ACTIVE_WINDOW = timedelta(days=90)
BOOKED = (AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW)


def _midnight(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time(), TZ)


def _revenue(db: Session, clinic_id: uuid.UUID, start: datetime, end: datetime, branch_id: uuid.UUID | None = None) -> int:
    stmt = select(func.coalesce(func.sum(Invoice.total_paise), 0)).where(
        Invoice.clinic_id == clinic_id, Invoice.status == InvoiceStatus.PAID, Invoice.paid_at >= start, Invoice.paid_at < end
    )
    if branch_id:
        stmt = stmt.where(Invoice.branch_id == branch_id)
    return db.scalar(stmt) or 0


def subscription_out(sub: Subscription | None) -> SubscriptionOut | None:
    if sub is None:
        return None
    now = datetime.now(UTC)
    end = sub.current_period_end
    days_left = (end - now).days if end else None
    return SubscriptionOut(
        plan=sub.plan, price_paise=sub.price_paise, status=sub.status, trial_ends_at=sub.trial_ends_at,
        current_period_end=end, days_left=days_left,
        due_soon=sub.status in (SubscriptionStatus.TRIAL, SubscriptionStatus.OVERDUE) or (days_left is not None and days_left <= 7),
    )


def _attention(db: Session, clinic_id: uuid.UUID, limit: int = 6) -> list[AttentionItem]:
    """Patients on an active plan whose last-7-day exercise adherence is below 50%."""
    today = datetime.now(TZ).date()
    rows = db.execute(
        select(ClinicPatient, Patient, CarePlan)
        .join(Patient, Patient.id == ClinicPatient.patient_id)
        .join(CarePlan, (CarePlan.clinic_patient_id == ClinicPatient.id) & (CarePlan.status == CarePlanStatus.ACTIVE))
        .where(ClinicPatient.clinic_id == clinic_id)
        .limit(200)
    ).all()
    out = []
    for cp, p, plan in rows:
        pct = adherence_pct(day_stats(db, p.id, today - timedelta(days=6), today, [plan.id]))
        if pct is not None and pct < 50:
            out.append(AttentionItem(clinic_patient_id=cp.id, name=p.full_name, note=f"{plan.condition} · {'no exercises logged this week' if pct == 0 else 'missing exercises'}", adherence=pct))
    return sorted(out, key=lambda a: a.adherence)[:limit]


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(member: Member, db: DB, branch_id: uuid.UUID | None = None) -> DashboardOut:
    owner = member.role == MembershipRole.OWNER
    today = datetime.now(TZ).date()
    start, end = _midnight(today), _midnight(today + timedelta(days=1))
    week_start = _midnight(today - timedelta(days=6))
    branches = list(db.scalars(select(Branch).where(Branch.clinic_id == member.clinic_id, Branch.is_active.is_(True)).order_by(Branch.name)))
    scope = [b for b in branches if b.id == branch_id] if branch_id else branches

    stats = []
    for b in scope:
        appts = db.scalar(select(func.count()).select_from(Appointment).where(Appointment.branch_id == b.id, Appointment.starts_at >= start, Appointment.starts_at < end, Appointment.status.in_(BOOKED))) or 0
        tokens = db.scalar(select(func.count()).select_from(QueueToken).where(QueueToken.branch_id == b.id, QueueToken.service_date == today)) or 0
        waiting = db.scalar(select(func.count()).select_from(QueueToken).where(QueueToken.branch_id == b.id, QueueToken.service_date == today, QueueToken.status == TokenStatus.WAITING)) or 0
        # Patients seen at this branch recently, whether booked or walk-in.
        booked = set(db.scalars(select(Appointment.patient_id).where(Appointment.branch_id == b.id, Appointment.starts_at >= start - ACTIVE_WINDOW)))
        walked = set(db.scalars(select(QueueToken.patient_id).where(QueueToken.branch_id == b.id, QueueToken.service_date >= today - ACTIVE_WINDOW)))
        patients = len(booked | walked)
        lead = db.get(User, b.lead_user_id) if b.lead_user_id else None
        stats.append(BranchStat(id=b.id, name=b.name, area=b.area, lead_name=lead.full_name if lead else None, today=appts + tokens, waiting=waiting,
                                patients=patients, revenue_week_paise=_revenue(db, member.clinic_id, week_start, end, b.id) if owner else None))

    scope_ids = [b.id for b in scope]
    schedule = db.execute(
        select(Appointment, Patient)
        .join(Patient, Patient.id == Appointment.patient_id)
        .where(Appointment.branch_id.in_(scope_ids), Appointment.starts_at >= start, Appointment.starts_at < end, Appointment.status.in_(BOOKED))
        .order_by(Appointment.starts_at)
        .limit(12)
    ).all()
    if branch_id:
        # One branch picked: patients seen at that branch, like its other tiles (not the whole clinic).
        active_patients = sum(s.patients for s in stats)
    else:
        active_patients = db.scalar(
            select(func.count()).select_from(ClinicPatient).where(
                ClinicPatient.clinic_id == member.clinic_id, ClinicPatient.status == ClinicPatientStatus.ACTIVE,
                ClinicPatient.last_visit_on >= today - ACTIVE_WINDOW,
            )
        ) or 0
    staff = db.scalar(select(func.count()).select_from(ClinicMember).where(ClinicMember.clinic_id == member.clinic_id, ClinicMember.is_active.is_(True))) or 0

    return DashboardOut(
        appointments_today=sum(s.today for s in stats),
        tokens_waiting=sum(s.waiting for s in stats),
        active_patients=active_patients,
        staff_on_roll=staff,
        revenue_week_paise=_revenue(db, member.clinic_id, week_start, end, branch_id) if owner else None,
        branches=stats,
        schedule=[ScheduleItem(id=a.id, starts_at=a.starts_at, patient_name=p.full_name, reason=a.reason, mode=a.mode.value, status=a.status.value) for a, p in schedule],
        attention=_attention(db, member.clinic_id),
        subscription=subscription_out(db.scalar(select(Subscription).where(Subscription.clinic_id == member.clinic_id))) if owner else None,
    )


@router.get("/analytics", response_model=AnalyticsOut)
def analytics(member: Owner, db: DB, days: Annotated[int, Query(ge=7, le=365)] = 7) -> AnalyticsOut:
    cid = member.clinic_id
    today = datetime.now(TZ).date()
    first = today - timedelta(days=days - 1)
    start, end = _midnight(first), _midnight(today + timedelta(days=1))
    prev_start = _midnight(first - timedelta(days=days))

    # Revenue by paid date.
    local_day = func.date(func.timezone(literal_column("'Asia/Kolkata'"), Invoice.paid_at)).label("day")
    by_day = dict(
        db.execute(
            select(local_day, func.sum(Invoice.total_paise))
            .where(Invoice.clinic_id == cid, Invoice.status == InvoiceStatus.PAID, Invoice.paid_at >= start, Invoice.paid_at < end)
            .group_by(local_day)
        ).all()
    )
    series = [SeriesPoint(day=first + timedelta(days=i), value=int(by_day.get(first + timedelta(days=i), 0) or 0)) for i in range(days)]

    def appts(a: datetime, b: datetime):
        return list(db.scalars(select(Appointment).where(Appointment.clinic_id == cid, Appointment.starts_at >= a, Appointment.starts_at < b, Appointment.status.in_(BOOKED))))

    current, previous = appts(start, end), appts(prev_start, start)
    past = [a for a in current if a.starts_at < datetime.now(UTC)]
    no_shows = sum(1 for a in past if a.status == AppointmentStatus.NO_SHOW)
    tokens = db.scalar(
        select(func.count()).select_from(QueueToken).join(Branch, Branch.id == QueueToken.branch_id)
        .where(Branch.clinic_id == cid, QueueToken.service_date >= first, QueueToken.service_date <= today)
    ) or 0

    # Conditions treated: care plans active during the period.
    conds = Counter(
        c.strip().title()
        for c in db.scalars(
            select(CarePlan.condition).join(ClinicPatient, ClinicPatient.id == CarePlan.clinic_patient_id)
            .where(ClinicPatient.clinic_id == cid, CarePlan.created_at < end, (CarePlan.status == CarePlanStatus.ACTIVE) | (CarePlan.updated_at >= start))
        )
    )
    total_conds = sum(conds.values())
    top = conds.most_common(5)
    shares = [Share(label=label, count=n, pct=round(100 * n / total_conds)) for label, n in top]
    if total_conds > sum(n for _, n in top):
        rest = total_conds - sum(n for _, n in top)
        shares.append(Share(label="Other", count=rest, pct=round(100 * rest / total_conds)))

    # Retention: patients seen in the period who had visited before it.
    seen = {a.patient_id for a in current}
    seen |= set(db.scalars(
        select(QueueToken.patient_id).join(Branch, Branch.id == QueueToken.branch_id).where(Branch.clinic_id == cid, QueueToken.service_date >= first)
    ))
    new = set(db.scalars(select(ClinicPatient.patient_id).where(ClinicPatient.clinic_id == cid, ClinicPatient.created_at >= start))) & seen

    # Adherence across patients with active plans.
    plans = db.execute(
        select(CarePlan.id, ClinicPatient.patient_id).join(ClinicPatient, ClinicPatient.id == CarePlan.clinic_patient_id)
        .where(ClinicPatient.clinic_id == cid, CarePlan.status == CarePlanStatus.ACTIVE).limit(300)
    ).all()
    pcts = [p for plan_id, pid in plans if (p := adherence_pct(day_stats(db, pid, max(first, today - timedelta(days=29)), today, [plan_id]))) is not None]

    physio_ids = list(db.scalars(select(ClinicMember.user_id).where(ClinicMember.clinic_id == cid)))
    rating = db.execute(select(func.avg(Review.rating), func.count()).where(Review.physio_user_id.in_(physio_ids), Review.is_hidden.is_(False))).one()
    profile_rating = db.scalar(select(func.avg(PhysioProfile.rating_avg)).where(PhysioProfile.user_id.in_(physio_ids), PhysioProfile.reviews_count > 0))

    return AnalyticsOut(
        days=days,
        revenue_paise=sum(p.value for p in series),
        revenue_prev_paise=_revenue(db, cid, prev_start, start),
        appointments=len(current) + tokens,
        appointments_prev=len(previous),
        avg_adherence=round(sum(pcts) / len(pcts)) if pcts else None,
        no_show_pct=round(100 * no_shows / len(past), 1) if past else None,
        revenue_by_day=series,
        conditions=shares,
        returning_pct=round(100 * (len(seen) - len(new)) / len(seen)) if seen else None,
        new_patients=len(new),
        online_pct=round(100 * sum(1 for a in current if a.mode == ConsultMode.ONLINE) / len(current)) if current else None,
        rating_avg=round(float(rating[0]), 2) if rating[0] is not None else (round(float(profile_rating), 2) if profile_rating else None),
        reviews=rating[1] or 0,
    )
