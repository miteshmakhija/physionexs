"""Super Admin: platform dashboard, analytics, subscriptions, audit log, settings, records."""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import ValidationError
from sqlalchemy import Select, func, literal_column, or_, select, update
from sqlalchemy.orm import Session

from app.core.deps import DB, AdminUser
from app.models.billing import Invoice, Payment, PaymentPurpose, PaymentStatus
from app.models.clinic import Branch, Clinic, PhysioProfile, Subscription, SubscriptionPlan, SubscriptionStatus, VerificationStatus
from app.models.engagement import Review
from app.models.exercise import Exercise
from app.models.patient import ClinicPatient, Patient
from app.models.platform import AuditLog, PlatformSetting
from app.models.scheduling import Appointment, AppointmentStatus
from app.models.twin import ValidationPair
from app.models.user import RefreshToken, User, UserRole
from app.schemas.admin import (
    SETTINGS_MODELS,
    ActivityItem,
    AdminAnalytics,
    AdminDashboard,
    AuditPage,
    AuditRow,
    Collection,
    MonthPoint,
    RecordAction,
    RecordsPage,
    RevenueSplit,
    SettingOut,
    CategoryShare,
    SubscriptionKpis,
    SubscriptionPage,
    SubscriptionRow,
    SubscriptionUpdate,
)
from app.schemas.twin import ValidationOut
from app.services import audit
from app.services.camera import validation_out
from app.services.reviews import recompute_rating
from app.services.settings import get_setting

router = APIRouter(prefix="/admin", tags=["admin"])

BOOKED = (AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW)


# ── Revenue helpers ─────────────────────────────────────────────────────────


def _not_refunded():
    return func.coalesce(Payment.meta["refund_required"].as_boolean(), False).is_(False)


def revenue_split(db: Session, start: datetime | None = None, end: datetime | None = None) -> RevenueSplit:
    booking = select(
        func.coalesce(func.sum(Payment.platform_fee_paise), 0),
        func.coalesce(func.sum(Payment.meta["fee_paise"].as_integer()), 0),
        func.coalesce(func.sum(Payment.meta["payout_paise"].as_integer()), 0),
    ).where(Payment.purpose == PaymentPurpose.APPOINTMENT, Payment.status == PaymentStatus.PAID, _not_refunded())
    pms = select(func.coalesce(func.sum(Payment.amount_paise), 0)).where(Payment.purpose == PaymentPurpose.SUBSCRIPTION, Payment.status == PaymentStatus.PAID)
    if start:
        booking, pms = booking.where(Payment.paid_at >= start), pms.where(Payment.paid_at >= start)
    if end:
        booking, pms = booking.where(Payment.paid_at < end), pms.where(Payment.paid_at < end)
    commission, gmv, payout = db.execute(booking).one()
    return RevenueSplit(commission_paise=int(commission), pms_paise=int(db.scalar(pms) or 0), gmv_paise=int(gmv), payout_paise=int(payout),
                        avg_fee_pct=round(100 * commission / gmv, 1) if gmv else None)


def by_speciality(db: Session, limit: int = 6) -> list[CategoryShare]:
    # Grouping by the physio's first speciality. Inlined (not bound) so SELECT and GROUP BY match.
    spec = literal_column("coalesce(physio_profiles.specializations[1], 'General')")
    rows = db.execute(
        select(spec, func.count())
        .select_from(Appointment)
        .join(PhysioProfile, PhysioProfile.user_id == Appointment.physio_user_id)
        .where(Appointment.status.in_(BOOKED))
        .group_by(spec)
        .order_by(func.count().desc())
    ).all()
    total = sum(n for _, n in rows)
    top = rows[:limit]
    out = [CategoryShare(label=label, count=n, pct=round(100 * n / total)) for label, n in top]
    if len(rows) > limit:
        rest = total - sum(n for _, n in top)
        out.append(CategoryShare(label="Other", count=rest, pct=round(100 * rest / total)))
    return out


def _month_start(d: date, back: int) -> date:
    m = d.month - 1 - back
    return date(d.year + m // 12, m % 12 + 1, 1)


def _actor(db: Session, user_id: uuid.UUID | None) -> str | None:
    if user_id is None:
        return None
    u = db.get(User, user_id)
    return u.full_name if u else None


# ── Dashboard & analytics ───────────────────────────────────────────────────


@router.get("/dashboard", response_model=AdminDashboard)
def dashboard(admin: AdminUser, db: DB) -> AdminDashboard:
    month = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    count_role = lambda role: db.scalar(select(func.count()).select_from(User).where(User.role == role)) or 0  # noqa: E731
    rating = db.execute(select(func.avg(Review.rating), func.count()).where(Review.is_hidden.is_(False))).one()
    logs = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(10))
    return AdminDashboard(
        pending_verifications=db.scalar(select(func.count()).select_from(PhysioProfile).where(PhysioProfile.verification_status == VerificationStatus.PENDING)) or 0,
        patients=count_role(UserRole.PATIENT),
        patients_this_month=db.scalar(select(func.count()).select_from(User).where(User.role == UserRole.PATIENT, User.created_at >= month)) or 0,
        physios=db.scalar(select(func.count()).select_from(PhysioProfile)) or 0,
        bookings=db.scalar(select(func.count()).select_from(Appointment).where(Appointment.status.in_(BOOKED))) or 0,
        reviews=rating[1] or 0,
        rating_avg=round(float(rating[0]), 2) if rating[0] is not None else None,
        revenue=revenue_split(db),
        by_speciality=by_speciality(db),
        activity=[ActivityItem(id=log.id, action=log.action, entity=log.entity, summary=log.summary, actor=_actor(db, log.actor_user_id), created_at=log.created_at) for log in logs],
    )


@router.get("/analytics", response_model=AdminAnalytics)
def analytics(admin: AdminUser, db: DB, months: Annotated[int, Query(ge=3, le=24)] = 6) -> AdminAnalytics:
    today = datetime.now(UTC).date()
    points = []
    for back in range(months - 1, -1, -1):
        start = _month_start(today, back)
        end = _month_start(today, back - 1)
        s, e = datetime(start.year, start.month, 1, tzinfo=UTC), datetime(end.year, end.month, 1, tzinfo=UTC)
        split = revenue_split(db, s, e)
        points.append(MonthPoint(
            month=start,
            patients=db.scalar(select(func.count()).select_from(User).where(User.role == UserRole.PATIENT, User.created_at >= s, User.created_at < e)) or 0,
            physios=db.scalar(select(func.count()).select_from(PhysioProfile).where(PhysioProfile.created_at >= s, PhysioProfile.created_at < e)) or 0,
            bookings=db.scalar(select(func.count()).select_from(Appointment).where(Appointment.status.in_(BOOKED), Appointment.created_at >= s, Appointment.created_at < e)) or 0,
            commission_paise=split.commission_paise,
            pms_paise=split.pms_paise,
        ))
    plans = dict(db.execute(select(Subscription.plan, func.count()).where(Subscription.status != SubscriptionStatus.CANCELLED).group_by(Subscription.plan)).all())
    split = revenue_split(db)
    return AdminAnalytics(months=points, by_speciality=by_speciality(db), plan_monthly=plans.get(SubscriptionPlan.MONTHLY, 0),
                          plan_yearly=plans.get(SubscriptionPlan.YEARLY, 0), plan_commission=plans.get(SubscriptionPlan.COMMISSION, 0),
                          avg_fee_pct=split.avg_fee_pct, revenue=split)


# ── Subscriptions ───────────────────────────────────────────────────────────


@router.get("/subscriptions", response_model=SubscriptionPage)
def subscriptions(admin: AdminUser, db: DB, status_: Annotated[SubscriptionStatus | None, Query(alias="status")] = None) -> SubscriptionPage:
    rows = db.execute(select(Subscription, Clinic, User).join(Clinic, Clinic.id == Subscription.clinic_id).join(User, User.id == Clinic.owner_user_id).order_by(Clinic.name)).all()
    counts = {s: 0 for s in SubscriptionStatus}
    mrr = 0
    out = []
    for sub, clinic, owner in rows:
        counts[sub.status] += 1
        if sub.status == SubscriptionStatus.ACTIVE and sub.plan != SubscriptionPlan.COMMISSION:
            mrr += sub.price_paise if sub.plan == SubscriptionPlan.MONTHLY else sub.price_paise // 12
        if status_ and sub.status != status_:
            continue
        out.append(SubscriptionRow(clinic_id=clinic.id, clinic_name=clinic.name, owner_name=owner.full_name, owner_email=owner.email, plan=sub.plan,
                                   price_paise=sub.price_paise, status=sub.status, current_period_end=sub.current_period_end, trial_ends_at=sub.trial_ends_at,
                                   platform_fee_bps=clinic.platform_fee_bps))
    kpis = SubscriptionKpis(mrr_paise=mrr, arr_paise=mrr * 12, active=counts[SubscriptionStatus.ACTIVE], trial=counts[SubscriptionStatus.TRIAL],
                            overdue=counts[SubscriptionStatus.OVERDUE], cancelled=counts[SubscriptionStatus.CANCELLED])
    return SubscriptionPage(kpis=kpis, rows=out)


@router.put("/subscriptions/{clinic_id}", response_model=SubscriptionRow)
def update_subscription(clinic_id: uuid.UUID, body: SubscriptionUpdate, admin: AdminUser, db: DB, request: Request) -> SubscriptionRow:
    sub = db.scalar(select(Subscription).where(Subscription.clinic_id == clinic_id).with_for_update())
    clinic = db.get(Clinic, clinic_id)
    if sub is None or clinic is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subscription not found")
    allowed = get_setting(db, "platform_fee").get("allowed_bps", [])
    if allowed and body.platform_fee_bps not in allowed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Platform fee must be one of: {', '.join(f'{b / 100:g}%' for b in allowed)}")
    before = {"plan": sub.plan.value, "price_paise": sub.price_paise, "status": sub.status.value, "fee_bps": clinic.platform_fee_bps}
    sub.plan, sub.price_paise, sub.status = body.plan, body.price_paise, body.status
    if body.current_period_end:
        sub.current_period_end = body.current_period_end
    clinic.platform_fee_bps = body.platform_fee_bps
    audit.record(db, action="update", entity="subscription", entity_id=sub.id, actor_user_id=admin.id, clinic_id=clinic_id, summary=clinic.name,
                 changes={"before": before, "after": body.model_dump(mode="json")}, request=request)
    db.commit()
    owner = db.get(User, clinic.owner_user_id)
    return SubscriptionRow(clinic_id=clinic.id, clinic_name=clinic.name, owner_name=owner.full_name, owner_email=owner.email, plan=sub.plan, price_paise=sub.price_paise,
                           status=sub.status, current_period_end=sub.current_period_end, trial_ends_at=sub.trial_ends_at, platform_fee_bps=clinic.platform_fee_bps)


# ── Audit log ───────────────────────────────────────────────────────────────


@router.get("/audit", response_model=AuditPage)
def audit_log(
    admin: AdminUser,
    db: DB,
    q: Annotated[str | None, Query(max_length=80)] = None,
    entity: str | None = None,
    action: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AuditPage:
    stmt = select(AuditLog)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if q:
        actors = select(User.id).where(User.full_name.ilike(f"%{q}%"))
        stmt = stmt.where(or_(AuditLog.summary.ilike(f"%{q}%"), AuditLog.entity_id == q, AuditLog.actor_user_id.in_(actors)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset))
    clinics: dict[uuid.UUID, str] = {}

    def clinic_name(cid):
        if cid and cid not in clinics:
            c = db.get(Clinic, cid)
            clinics[cid] = c.name if c else "—"
        return clinics.get(cid) if cid else None

    return AuditPage(total=total, rows=[
        AuditRow(id=r.id, action=r.action, entity=r.entity, entity_id=r.entity_id, summary=r.summary, actor=_actor(db, r.actor_user_id),
                 clinic=clinic_name(r.clinic_id), ip=r.ip, created_at=r.created_at)
        for r in rows
    ])


# ── Settings ────────────────────────────────────────────────────────────────


def _setting_out(db: Session, key: str) -> SettingOut:
    row = db.get(PlatformSetting, key)
    return SettingOut(key=key, value=get_setting(db, key), updated_at=row.updated_at if row else None, updated_by=_actor(db, row.updated_by) if row else None)


@router.get("/settings", response_model=list[SettingOut])
def list_settings(admin: AdminUser, db: DB) -> list[SettingOut]:
    return [_setting_out(db, key) for key in SETTINGS_MODELS]


@router.put("/settings/{key}", response_model=SettingOut)
def update_setting(key: str, body: dict[str, Any], admin: AdminUser, db: DB, request: Request) -> SettingOut:
    model = SETTINGS_MODELS.get(key)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown setting")
    try:
        value = model.model_validate(body).model_dump(mode="json")
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.errors(include_url=False, include_context=False))
    row = db.get(PlatformSetting, key)
    before = row.value if row else None
    if row is None:
        row = PlatformSetting(key=key, value=value)
        db.add(row)
    row.value = value
    row.updated_by = admin.id
    audit.record(db, action="update", entity="setting", entity_id=key, actor_user_id=admin.id, summary=key, changes={"before": before, "after": value}, request=request)
    db.commit()
    return _setting_out(db, key)


# ── Records browser ─────────────────────────────────────────────────────────
# Read-mostly views of the core tables. Changes go through a few named, audited actions — never
# raw edits or hard deletes, so history and financial records stay intact.


@dataclass
class Spec:
    label: str
    columns: list[str]
    base: Callable[[], Select]
    search: Callable[[str], Any] | None
    row: Callable[[Session, Any], dict]
    actions: list[str]
    count: Callable[[Session], int]


def _fmt_dt(v: datetime | None) -> str | None:
    return v.isoformat() if v else None


def _users(role: UserRole, label: str) -> Spec:
    return Spec(
        label=label,
        columns=["name", "phone", "email", "joined", "last_login", "active"],
        base=lambda: select(User).where(User.role == role).order_by(User.created_at.desc()),
        search=lambda q: or_(User.full_name.ilike(f"%{q}%"), User.phone.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")),
        row=lambda db, u: {"id": str(u.id), "name": u.full_name, "phone": u.phone, "email": u.email, "joined": _fmt_dt(u.created_at),
                           "last_login": _fmt_dt(u.last_login_at), "active": u.is_active},
        actions=["deactivate", "activate"],
        count=lambda db: db.scalar(select(func.count()).select_from(User).where(User.role == role)) or 0,
    )


def _physio_row(db: Session, p: PhysioProfile) -> dict:
    u = db.get(User, p.user_id)
    return {"id": str(u.id), "name": u.full_name, "email": u.email, "phone": u.phone, "registration_no": p.registration_no, "verification": p.verification_status.value,
            "rating": float(p.rating_avg or 0), "reviews": p.reviews_count, "active": u.is_active}


def _clinic_row(db: Session, c: Clinic) -> dict:
    city = db.scalar(select(Branch.city).where(Branch.clinic_id == c.id).limit(1))
    return {"id": str(c.id), "name": c.name, "owner": _actor(db, c.owner_user_id), "city": city, "platform_fee": f"{c.platform_fee_bps / 100:g}%",
            "twin_pilot": c.twin_pilot, "ai_assist": c.ai_assist, "created": _fmt_dt(c.created_at), "active": c.is_active}


def _appt_row(db: Session, a: Appointment) -> dict:
    return {"id": str(a.id), "starts_at": _fmt_dt(a.starts_at), "patient": db.get(Patient, a.patient_id).full_name, "physio": _actor(db, a.physio_user_id),
            "clinic": db.get(Clinic, a.clinic_id).name, "mode": a.mode.value, "status": a.status.value, "fee": a.fee_paise / 100}


def _payment_row(db: Session, p: Payment) -> dict:
    return {"id": str(p.id), "purpose": p.purpose.value, "amount": p.amount_paise / 100, "status": p.status.value, "method": p.method,
            "razorpay_payment_id": p.razorpay_payment_id, "paid_at": _fmt_dt(p.paid_at), "refund_required": bool((p.meta or {}).get("refund_required"))}


def _invoice_row(db: Session, i: Invoice) -> dict:
    cp = db.get(ClinicPatient, i.clinic_patient_id)
    return {"id": str(i.id), "number": i.number, "clinic": db.get(Clinic, i.clinic_id).name, "patient": db.get(Patient, cp.patient_id).full_name,
            "total": i.total_paise / 100, "status": i.status.value, "issued_on": i.issued_on.isoformat()}


def _review_row(db: Session, r: Review) -> dict:
    return {"id": str(r.id), "rating": r.rating, "physio": _actor(db, r.physio_user_id), "patient": db.get(Patient, r.patient_id).full_name,
            "comment": r.comment, "tags": ", ".join(r.tags or []), "created": _fmt_dt(r.created_at), "hidden": r.is_hidden}


def _count(model) -> Callable[[Session], int]:
    return lambda db: db.scalar(select(func.count()).select_from(model)) or 0


SPECS: dict[str, Spec] = {
    "patients": _users(UserRole.PATIENT, "Patients"),
    "physiotherapists": Spec(
        "Physiotherapists", ["name", "email", "phone", "registration_no", "verification", "rating", "reviews", "active"],
        lambda: select(PhysioProfile).join(User, User.id == PhysioProfile.user_id).order_by(PhysioProfile.created_at.desc()),
        lambda q: or_(User.full_name.ilike(f"%{q}%"), PhysioProfile.registration_no.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")),
        _physio_row, ["deactivate", "activate"], _count(PhysioProfile),
    ),
    "staff": _users(UserRole.STAFF, "Clinic staff"),
    "clinics": Spec(
        "Clinics", ["name", "owner", "city", "platform_fee", "twin_pilot", "ai_assist", "created", "active"],
        lambda: select(Clinic).order_by(Clinic.created_at.desc()), lambda q: Clinic.name.ilike(f"%{q}%"),
        _clinic_row, ["set_fee", "pilot_on", "pilot_off", "ai_on", "ai_off", "deactivate", "activate"], _count(Clinic),
    ),
    "appointments": Spec(
        "Appointments", ["starts_at", "patient", "physio", "clinic", "mode", "status", "fee"],
        lambda: select(Appointment).join(Patient, Patient.id == Appointment.patient_id).order_by(Appointment.starts_at.desc()),
        lambda q: Patient.full_name.ilike(f"%{q}%"), _appt_row, [], _count(Appointment),
    ),
    "payments": Spec(
        "Payments", ["purpose", "amount", "status", "method", "razorpay_payment_id", "paid_at", "refund_required"],
        lambda: select(Payment).order_by(Payment.created_at.desc()),
        lambda q: or_(Payment.razorpay_payment_id.ilike(f"%{q}%"), Payment.razorpay_order_id.ilike(f"%{q}%")),
        _payment_row, [], _count(Payment),
    ),
    "invoices": Spec(
        "Invoices", ["number", "clinic", "patient", "total", "status", "issued_on"],
        lambda: select(Invoice).order_by(Invoice.created_at.desc()), lambda q: Invoice.number.ilike(f"%{q}%"), _invoice_row, [], _count(Invoice),
    ),
    "reviews": Spec(
        "Reviews", ["rating", "physio", "patient", "comment", "tags", "created", "hidden"],
        lambda: select(Review).order_by(Review.created_at.desc()), lambda q: Review.comment.ilike(f"%{q}%"), _review_row, ["hide", "unhide"], _count(Review),
    ),
    "exercises": Spec(
        "Exercises", ["name", "body_region", "category", "status", "source"],
        lambda: select(Exercise).order_by(Exercise.body_region, Exercise.name), lambda q: Exercise.name.ilike(f"%{q}%"),
        lambda db, e: {"id": str(e.id), "name": e.name, "body_region": e.body_region, "category": e.category.value, "status": e.status.value, "source": e.source.value},
        [], _count(Exercise),
    ),
}


def _spec(key: str) -> Spec:
    spec = SPECS.get(key)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown collection")
    return spec


@router.get("/records", response_model=list[Collection])
def collections(admin: AdminUser, db: DB) -> list[Collection]:
    return [Collection(key=k, label=s.label, count=s.count(db), actions=s.actions) for k, s in SPECS.items()]


@router.get("/records/{key}", response_model=RecordsPage)
def records(
    key: str,
    admin: AdminUser,
    db: DB,
    q: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> RecordsPage:
    spec = _spec(key)
    stmt = spec.base()
    if q and spec.search:
        stmt = stmt.where(spec.search(q))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = [spec.row(db, r) for r in db.scalars(stmt.limit(limit).offset(offset))]
    return RecordsPage(key=key, label=spec.label, columns=spec.columns, rows=rows, total=total, actions=spec.actions)


@router.post("/records/{key}/{record_id}/action")
def record_action(key: str, record_id: uuid.UUID, body: RecordAction, admin: AdminUser, db: DB, request: Request) -> dict:
    spec = _spec(key)
    if body.action not in spec.actions:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{body.action}' isn't available for {spec.label.lower()}")

    if key in ("patients", "physiotherapists", "staff"):
        user = db.get(User, record_id)
        if user is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
        if user.id == admin.id:
            raise HTTPException(status.HTTP_409_CONFLICT, "You can't deactivate yourself")
        user.is_active = body.action == "activate"
        if not user.is_active:
            db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
        summary = f"{user.full_name} {body.action}d"
    elif key == "clinics":
        clinic = db.get(Clinic, record_id)
        if clinic is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Clinic not found")
        if body.action == "set_fee":
            allowed = get_setting(db, "platform_fee").get("allowed_bps", [])
            if not isinstance(body.value, int) or (allowed and body.value not in allowed):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Fee must be one of {allowed} (basis points)")
            clinic.platform_fee_bps = body.value
            summary = f"{clinic.name} fee → {body.value / 100:g}%"
        elif body.action in ("pilot_on", "pilot_off"):
            clinic.twin_pilot = body.action == "pilot_on"
            summary = f"{clinic.name} recovery-twin pilot {'on' if clinic.twin_pilot else 'off'}"
        elif body.action in ("ai_on", "ai_off"):
            clinic.ai_assist = body.action == "ai_on"
            summary = f"{clinic.name} AI assist {'on' if clinic.ai_assist else 'off'}"
        else:
            clinic.is_active = body.action == "activate"
            summary = f"{clinic.name} {body.action}d"
    elif key == "reviews":
        review = db.get(Review, record_id)
        if review is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
        review.is_hidden = body.action == "hide"
        db.flush()
        recompute_rating(db, review.physio_user_id)
        summary = f"Review {'hidden' if review.is_hidden else 'restored'}"
    else:  # pragma: no cover - guarded by spec.actions
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported")

    audit.record(db, action=body.action, entity=key.rstrip("s"), entity_id=record_id, actor_user_id=admin.id, summary=summary, request=request)
    db.commit()
    return {"ok": True, "summary": summary}


@router.get("/twin/validation", response_model=ValidationOut)
def twin_validation(admin: AdminUser, db: DB) -> ValidationOut:
    """Camera-vs-goniometer agreement across all clinics, without patient names (design B1 acceptance)."""
    return validation_out(db, list(db.scalars(select(ValidationPair).order_by(ValidationPair.created_at.desc()))), with_names=False)
