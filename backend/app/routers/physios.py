"""Public physiotherapist directory: search, profile, bookable slots. Only verified physios appear."""

import uuid
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import Float, and_, cast, func, literal, or_, select
from sqlalchemy.dialects.postgresql import distinct_on

from app.core.deps import DB
from app.models.clinic import Branch, Clinic, PhysioProfile, VerificationStatus
from app.models.engagement import Review
from app.models.patient import Patient
from app.models.scheduling import Availability, ConsultMode
from app.models.user import User
from app.schemas.booking import BranchBrief, DayOut, DirectoryPage, PhysioCard, PhysioDetail, ReviewOut, SlotOut
from app.services.slots import list_slots, next_available, physio_timezone

router = APIRouter(prefix="/physios", tags=["directory"])


def _distance_km(lat: float, lng: float):
    """Great-circle distance from (lat, lng) to the branch, in km (NULL when the branch has no coordinates)."""
    return 6371 * func.acos(
        func.least(
            1.0,
            func.cos(func.radians(lat)) * func.cos(func.radians(Branch.latitude)) * func.cos(func.radians(Branch.longitude) - func.radians(lng))
            + func.sin(func.radians(lat)) * func.sin(func.radians(Branch.latitude)),
        )
    )


def _public_filter():
    return and_(PhysioProfile.verification_status == VerificationStatus.APPROVED, User.is_active.is_(True), Branch.is_active.is_(True), Clinic.is_active.is_(True))


@router.get("", response_model=DirectoryPage)
def search(
    db: DB,
    city: str | None = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    mode: ConsultMode | None = None,
    min_rating: Annotated[float | None, Query(ge=0, le=5)] = None,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
    radius_km: Annotated[float | None, Query(gt=0, le=500)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> DirectoryPage:
    # Physios are bookable at the branches where they have working hours.
    practice = select(Availability.physio_user_id, Availability.branch_id).distinct().subquery()
    geo = lat is not None and lng is not None
    distance = _distance_km(lat, lng) if geo else cast(literal(None), Float)

    conditions = [_public_filter()]
    if city:
        conditions.append(Branch.city.ilike(city.strip()))
    if q:
        like = f"%{q.strip()}%"
        conditions.append(
            or_(
                User.full_name.ilike(like),
                PhysioProfile.qualification.ilike(like),
                func.array_to_string(PhysioProfile.specializations, " ").ilike(like),
                Clinic.name.ilike(like),
                Branch.area.ilike(like),
            )
        )
    if mode == ConsultMode.ONLINE:
        conditions.append(PhysioProfile.offers_online.is_(True))
    elif mode == ConsultMode.IN_CLINIC:
        conditions.append(PhysioProfile.offers_in_clinic.is_(True))
    if min_rating is not None:
        conditions.append(PhysioProfile.rating_avg >= min_rating)
    if geo and radius_km:
        conditions.append(distance <= radius_km)

    # One row per physio: their nearest (or first) branch.
    per_physio = (
        select(
            User.id.label("uid"),
            Branch.id.label("bid"),
            distance.label("dist"),
            PhysioProfile.rating_avg.label("rating"),
            PhysioProfile.reviews_count.label("reviews"),
        )
        .join(PhysioProfile, PhysioProfile.user_id == User.id)
        .join(practice, practice.c.physio_user_id == User.id)
        .join(Branch, Branch.id == practice.c.branch_id)
        .join(Clinic, Clinic.id == Branch.clinic_id)
        .where(*conditions)
        .ext(distinct_on(User.id))
        .order_by(User.id, distance.asc().nulls_last(), Branch.name)
        .subquery()
    )
    total = db.scalar(select(func.count()).select_from(per_physio)) or 0
    order = (
        [per_physio.c.dist.asc().nulls_last(), per_physio.c.rating.desc()]
        if geo
        else [per_physio.c.rating.desc(), per_physio.c.reviews.desc()]
    )
    rows = db.execute(select(per_physio).order_by(*order, per_physio.c.uid).limit(limit).offset(offset)).all()
    return DirectoryPage(items=[_card(db, r.uid, r.bid, r.dist) for r in rows], total=total)


@router.get("/{physio_id}", response_model=PhysioDetail)
def detail(physio_id: uuid.UUID, db: DB) -> PhysioDetail:
    branches = db.execute(
        select(Branch, Clinic.name)
        .join(Availability, Availability.branch_id == Branch.id)
        .join(Clinic, Clinic.id == Branch.clinic_id)
        .join(User, User.id == Availability.physio_user_id)
        .join(PhysioProfile, PhysioProfile.user_id == User.id)
        .where(Availability.physio_user_id == physio_id, _public_filter())
        .distinct()
        .order_by(Branch.name)
    ).all()
    if not branches:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Physiotherapist not found")
    card = _card(db, physio_id, branches[0][0].id, None)
    profile = db.scalar(select(PhysioProfile).where(PhysioProfile.user_id == physio_id))
    reviews = db.execute(
        select(Review, Patient.full_name)
        .join(Patient, Patient.id == Review.patient_id)
        .where(Review.physio_user_id == physio_id, Review.is_hidden.is_(False))
        .order_by(Review.created_at.desc())
        .limit(10)
    ).all()
    return PhysioDetail(
        **card.model_dump(),
        bio=profile.bio,
        college=profile.college,
        languages=profile.languages or [],
        branches=[_branch(b) for b, _ in branches],
        reviews=[
            ReviewOut(rating=r.rating, tags=r.tags or [], comment=r.comment, patient_name=_short_name(name), created_at=r.created_at)
            for r, name in reviews
        ],
    )


@router.get("/{physio_id}/slots", response_model=list[DayOut])
def slots(
    physio_id: uuid.UUID,
    db: DB,
    start: date | None = None,
    days: Annotated[int, Query(ge=1, le=14)] = 7,
    branch_id: uuid.UUID | None = None,  # only this clinic branch's hours
) -> list[DayOut]:
    approved = db.scalar(
        select(PhysioProfile.id).where(PhysioProfile.user_id == physio_id, PhysioProfile.verification_status == VerificationStatus.APPROVED)
    )
    if approved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Physiotherapist not found")
    now = datetime.now(UTC)
    today = now.astimezone(physio_timezone(db, physio_id)).date()
    start = max(start or today, today)
    return [
        DayOut(date=d.day, slots=[SlotOut(starts_at=s.starts_at, ends_at=s.ends_at, branch_id=s.branch_id, available=s.available) for s in d.slots])
        for d in list_slots(db, physio_id, start, days, now, branch_id)
    ]


def _card(db: DB, physio_id: uuid.UUID, branch_id: uuid.UUID, dist: float | None) -> PhysioCard:
    user = db.get(User, physio_id)
    profile = db.scalar(select(PhysioProfile).where(PhysioProfile.user_id == physio_id))
    branch = db.get(Branch, branch_id)
    clinic = db.get(Clinic, branch.clinic_id)
    nxt = next_available(db, physio_id)
    return PhysioCard(
        id=user.id,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        qualification=profile.qualification,
        specializations=profile.specializations or [],
        experience_years=profile.experience_years,
        rating_avg=float(profile.rating_avg or 0),
        reviews_count=profile.reviews_count,
        offers_in_clinic=profile.offers_in_clinic,
        offers_online=profile.offers_online,
        fee_in_clinic_paise=profile.fee_in_clinic_paise,
        fee_online_paise=profile.fee_online_paise,
        clinic_name=clinic.name,
        branch=_branch(branch),
        distance_km=round(dist, 1) if dist is not None else None,
        next_slot_at=nxt.starts_at if nxt else None,
    )


def _branch(b: Branch) -> BranchBrief:
    return BranchBrief(id=b.id, name=b.name, area=b.area, city=b.city, address=b.address)


def _short_name(name: str) -> str:
    parts = name.split()
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0]}."
