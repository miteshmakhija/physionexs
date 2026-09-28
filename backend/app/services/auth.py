import re
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, new_refresh_token
from app.models.clinic import Clinic, ClinicMember, PhysioProfile
from app.models.patient import Patient
from app.models.user import RefreshToken, User
from app.schemas.auth import MembershipOut, MeOut, TokenOut

settings = get_settings()

REFRESH_COOKIE = "pnx_refresh"


def build_me(db: Session, user: User) -> MeOut:
    rows = db.execute(
        select(ClinicMember, Clinic.name, Clinic.twin_pilot, Clinic.ai_assist)
        .join(Clinic, Clinic.id == ClinicMember.clinic_id)
        .where(ClinicMember.user_id == user.id, ClinicMember.is_active.is_(True))
    ).all()
    patient_id = db.scalar(select(Patient.id).where(Patient.user_id == user.id))
    verification = db.scalar(select(PhysioProfile.verification_status).where(PhysioProfile.user_id == user.id))
    return MeOut(
        id=user.id,
        full_name=user.full_name,
        phone=user.phone,
        email=user.email,
        role=user.role,
        avatar_url=user.avatar_url,
        totp_enabled=user.totp_enabled,
        patient_id=patient_id,
        physio_verification=verification,
        memberships=[
            MembershipOut(clinic_id=m.clinic_id, clinic_name=name, role=m.role, branch_id=m.branch_id, twin_pilot=pilot,
                          ai_assist=bool(ai and get_settings().anthropic_api_key)) for m, name, pilot, ai in rows
        ],
    )


def is_web_client(request: Request) -> bool:
    return request.headers.get("x-client") == "web"


def issue_tokens(db: Session, user: User, request: Request, response: Response) -> TokenOut:
    raw, digest = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=digest,
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
            user_agent=(request.headers.get("user-agent") or "")[:300],
        )
    )
    user.last_login_at = datetime.now(UTC)
    db.commit()

    web = is_web_client(request)
    if web:
        set_refresh_cookie(response, raw)
    return TokenOut(
        access_token=create_access_token(user.id, user.role.value),
        refresh_token=None if web else raw,
        expires_in=settings.access_token_minutes * 60,
        user=build_me(db, user),
    )


def set_refresh_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        raw,
        max_age=settings.refresh_token_days * 86400,
        httponly=True,
        secure=not settings.is_dev,
        samesite="lax",
        domain=settings.cookie_domain,
        path="/",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, domain=settings.cookie_domain, path="/")


def unique_slug(db: Session, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:120] or "clinic"
    slug = base
    while db.scalar(select(Clinic.id).where(Clinic.slug == slug)):
        slug = f"{base}-{uuid.uuid4().hex[:6]}"
    return slug
