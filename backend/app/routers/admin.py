"""Super Admin endpoints."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import DB, require_roles
from app.models.clinic import Branch, Clinic, PhysioProfile, VerificationStatus
from app.models.engagement import Notification
from app.models.user import User, UserRole
from app.schemas.booking import RejectIn, VerificationItem
from app.services import audit

router = APIRouter(prefix="/admin", tags=["admin"])

Admin = Annotated[User, Depends(require_roles(UserRole.SUPER_ADMIN))]


@router.get("/verifications", response_model=list[VerificationItem])
def verifications(
    admin: Admin,
    db: DB,
    status_: Annotated[VerificationStatus, Query(alias="status")] = VerificationStatus.PENDING,
) -> list[VerificationItem]:
    user_ids = db.scalars(
        select(PhysioProfile.user_id).where(PhysioProfile.verification_status == status_).order_by(PhysioProfile.created_at)
    )
    return [_item(db, uid) for uid in user_ids]


@router.post("/verifications/{user_id}/approve", response_model=VerificationItem)
def approve(user_id: uuid.UUID, admin: Admin, db: DB, request: Request) -> VerificationItem:
    profile = _locked_profile(db, user_id)
    profile.verification_status = VerificationStatus.APPROVED
    profile.verified_at = datetime.now(UTC)
    profile.verified_by = admin.id
    profile.rejection_reason = None
    db.add(Notification(user_id=user_id, kind="verification_approved", title="You're verified", body="Your council registration is verified and your profile is live on Physionexs."))
    audit.record(db, action="approve", entity="physio_profile", entity_id=profile.id, actor_user_id=admin.id, summary=f"Reg. No. {profile.registration_no}", request=request)
    db.commit()
    return _item(db, user_id)


@router.post("/verifications/{user_id}/reject", response_model=VerificationItem)
def reject(user_id: uuid.UUID, body: RejectIn, admin: Admin, db: DB, request: Request) -> VerificationItem:
    profile = _locked_profile(db, user_id)
    profile.verification_status = VerificationStatus.REJECTED
    profile.verified_at = datetime.now(UTC)
    profile.verified_by = admin.id
    profile.rejection_reason = body.reason
    db.add(Notification(user_id=user_id, kind="verification_rejected", title="Verification unsuccessful", body=body.reason))
    audit.record(db, action="reject", entity="physio_profile", entity_id=profile.id, actor_user_id=admin.id, summary=body.reason, request=request)
    db.commit()
    return _item(db, user_id)


def _locked_profile(db: Session, user_id: uuid.UUID) -> PhysioProfile:
    profile = db.scalar(select(PhysioProfile).where(PhysioProfile.user_id == user_id).with_for_update())
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Physiotherapist not found")
    return profile


def _item(db: Session, user_id: uuid.UUID) -> VerificationItem:
    profile, user = db.execute(
        select(PhysioProfile, User).join(User, User.id == PhysioProfile.user_id).where(User.id == user_id)
    ).one()
    clinic = db.scalar(select(Clinic).where(Clinic.owner_user_id == user_id).limit(1))
    city = db.scalar(select(Branch.city).where(Branch.clinic_id == clinic.id).limit(1)) if clinic else None
    return VerificationItem(
        user_id=user.id,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        qualification=profile.qualification,
        registration_no=profile.registration_no,
        council=profile.council,
        clinic_name=clinic.name if clinic else None,
        city=city,
        status=profile.verification_status.value,
        submitted_at=profile.created_at,
    )
