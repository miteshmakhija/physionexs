"""Clinic profile, branches and the PMS subscription."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser, require_clinic_member
from app.models.billing import Payment, PaymentPurpose, PaymentStatus
from app.models.clinic import Branch, Clinic, ClinicMember, MembershipRole, Subscription, SubscriptionPlan, SubscriptionStatus
from app.models.user import User
from app.schemas.booking import RazorpayCheckout, VerifyPaymentIn
from app.schemas.business import BranchIn, BranchOut, CheckoutIn, ClinicProfileIn, ClinicProfileOut, SubscriptionOut
from app.services import audit, razorpay
from app.services.settings import get_setting
from app.routers.insights import subscription_out

router = APIRouter(prefix="/clinic", tags=["practice"])

Member = Annotated[ClinicMember, Depends(require_clinic_member())]
Owner = Annotated[ClinicMember, Depends(require_clinic_member(MembershipRole.OWNER))]

# ── Profile ─────────────────────────────────────────────────────────────────


def _profile_out(c: Clinic) -> ClinicProfileOut:
    return ClinicProfileOut(id=c.id, slug=c.slug, platform_fee_bps=c.platform_fee_bps, name=c.name, phone=c.phone, email=c.email,
                            address=c.address, gstin=c.gstin, logo_url=c.logo_url)


@router.get("/profile", response_model=ClinicProfileOut)
def get_profile(member: Member, db: DB) -> ClinicProfileOut:
    return _profile_out(db.get(Clinic, member.clinic_id))


@router.put("/profile", response_model=ClinicProfileOut)
def update_profile(body: ClinicProfileIn, member: Owner, user: CurrentUser, db: DB, request: Request) -> ClinicProfileOut:
    clinic = db.get(Clinic, member.clinic_id)
    changed = [k for k, v in body.model_dump().items() if getattr(clinic, k) != v]
    for k, v in body.model_dump().items():
        setattr(clinic, k, v)
    audit.record(db, action="update", entity="clinic", entity_id=clinic.id, actor_user_id=user.id, clinic_id=clinic.id, summary=", ".join(changed) or "no changes", request=request)
    db.commit()
    return _profile_out(clinic)


# ── Branches ────────────────────────────────────────────────────────────────


def _branch_out(db: Session, b: Branch) -> BranchOut:
    lead = db.get(User, b.lead_user_id) if b.lead_user_id else None
    staff = db.scalar(select(func.count()).select_from(ClinicMember).where(ClinicMember.branch_id == b.id, ClinicMember.is_active.is_(True))) or 0
    return BranchOut(id=b.id, name=b.name, area=b.area, city=b.city, address=b.address, latitude=b.latitude, longitude=b.longitude, hours=b.hours,
                     therapy_rooms=b.therapy_rooms, lead_user_id=b.lead_user_id, is_active=b.is_active, lead_name=lead.full_name if lead else None,
                     staff_count=staff, timezone=b.timezone)


@router.get("/branches", response_model=list[BranchOut])
def branches(member: Member, db: DB, include_inactive: bool = False) -> list[BranchOut]:
    stmt = select(Branch).where(Branch.clinic_id == member.clinic_id)
    if not include_inactive:
        stmt = stmt.where(Branch.is_active.is_(True))
    return [_branch_out(db, b) for b in db.scalars(stmt.order_by(Branch.created_at))]


def _check_lead(db: Session, clinic_id: uuid.UUID, lead_id: uuid.UUID | None) -> None:
    if lead_id and not db.scalar(select(ClinicMember.id).where(ClinicMember.clinic_id == clinic_id, ClinicMember.user_id == lead_id)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Branch lead must be a member of this clinic")


@router.post("/branches", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
def add_branch(body: BranchIn, member: Owner, user: CurrentUser, db: DB, request: Request) -> BranchOut:
    _check_lead(db, member.clinic_id, body.lead_user_id)
    b = Branch(clinic_id=member.clinic_id, **body.model_dump())
    db.add(b)
    db.flush()
    audit.record(db, action="create", entity="branch", entity_id=b.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=b.name, request=request)
    db.commit()
    return _branch_out(db, b)


@router.put("/branches/{branch_id}", response_model=BranchOut)
def update_branch(branch_id: uuid.UUID, body: BranchIn, member: Owner, user: CurrentUser, db: DB, request: Request) -> BranchOut:
    b = db.get(Branch, branch_id)
    if b is None or b.clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    _check_lead(db, member.clinic_id, body.lead_user_id)
    if not body.is_active and b.is_active:
        active = db.scalar(select(func.count()).select_from(Branch).where(Branch.clinic_id == member.clinic_id, Branch.is_active.is_(True))) or 0
        if active <= 1:
            raise HTTPException(status.HTTP_409_CONFLICT, "A clinic needs at least one active branch")
    for k, v in body.model_dump().items():
        setattr(b, k, v)
    audit.record(db, action="update", entity="branch", entity_id=b.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=b.name, request=request)
    db.commit()
    return _branch_out(db, b)


# ── PMS subscription ────────────────────────────────────────────────────────


def _price(db: Session, plan: SubscriptionPlan) -> int:
    pricing = get_setting(db, "pms_pricing")
    return int(pricing["yearly_paise"] if plan == SubscriptionPlan.YEARLY else pricing["monthly_paise"])


@router.get("/subscription", response_model=SubscriptionOut)
def get_subscription(member: Owner, db: DB) -> SubscriptionOut:
    sub = db.scalar(select(Subscription).where(Subscription.clinic_id == member.clinic_id))
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No subscription")
    return subscription_out(sub)


@router.post("/subscription/checkout", response_model=RazorpayCheckout)
def subscription_checkout(body: CheckoutIn, member: Owner, user: CurrentUser, db: DB) -> RazorpayCheckout:
    """Start paying the next period. The price is the clinic's own (set by the Super Admin) unless the plan changes."""
    sub = db.scalar(select(Subscription).where(Subscription.clinic_id == member.clinic_id).with_for_update())
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No subscription")
    plan = body.plan or sub.plan
    amount = sub.price_paise if plan == sub.plan else _price(db, plan)
    payment = Payment(purpose=PaymentPurpose.SUBSCRIPTION, clinic_id=member.clinic_id, amount_paise=amount, meta={"plan": plan.value})
    db.add(payment)
    db.flush()
    try:
        payment.razorpay_order_id = razorpay.create_order(amount, receipt=f"sub-{payment.id}", notes={"clinic_id": str(member.clinic_id), "plan": plan.value})
    except razorpay.PaymentGatewayError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Payment service unavailable. Please try again.") from exc
    db.commit()
    clinic = db.get(Clinic, member.clinic_id)
    return RazorpayCheckout(
        key_id=razorpay.public_key_id(), order_id=payment.razorpay_order_id, amount=amount,
        description=f"Physionexs practice console · {plan.value}",
        prefill={k: v for k, v in {"name": user.full_name, "email": clinic.email or user.email, "contact": clinic.phone or user.phone}.items() if v},
    )


@router.post("/subscription/verify", response_model=SubscriptionOut)
def subscription_verify(body: VerifyPaymentIn, member: Owner, user: CurrentUser, db: DB, request: Request) -> SubscriptionOut:
    payment = db.scalar(select(Payment).where(Payment.razorpay_order_id == body.razorpay_order_id).with_for_update())
    if payment is None or payment.clinic_id != member.clinic_id or payment.purpose != PaymentPurpose.SUBSCRIPTION:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment does not match")
    if not razorpay.verify_payment_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment could not be verified")
    sub = apply_subscription_payment(db, payment, body.razorpay_payment_id, "razorpay")
    audit.record(db, action="payment", entity="subscription", entity_id=sub.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=f"₹{payment.amount_paise / 100:.0f} · {sub.plan.value}", request=request)
    db.commit()
    return subscription_out(sub)


def apply_subscription_payment(db: Session, payment: Payment, razorpay_payment_id: str | None, method: str | None) -> Subscription:
    """Mark paid and extend the period from whichever is later: now or the current end. Idempotent."""
    sub = db.scalar(select(Subscription).where(Subscription.clinic_id == payment.clinic_id).with_for_update())
    if payment.status == PaymentStatus.PAID:
        return sub
    now = datetime.now(UTC)
    payment.status = PaymentStatus.PAID
    payment.paid_at = now
    payment.method = method
    payment.razorpay_payment_id = razorpay_payment_id
    plan = SubscriptionPlan((payment.meta or {}).get("plan", sub.plan.value))
    if plan != sub.plan:
        sub.plan = plan
        sub.price_paise = payment.amount_paise
    base = max(now, sub.current_period_end or now) if sub.status != SubscriptionStatus.TRIAL else max(now, sub.trial_ends_at or now)
    sub.current_period_end = base + (timedelta(days=365) if plan == SubscriptionPlan.YEARLY else timedelta(days=30))
    sub.status = SubscriptionStatus.ACTIVE
    sub.last_reminder_at = None
    return sub
