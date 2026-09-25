import uuid
from collections.abc import Callable
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.clinic import ClinicMember, MembershipRole
from app.models.user import User, UserRole

DB = Annotated[Session, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    db: DB,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found or disabled")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    def dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed for your role")
        return user

    return dependency


def require_clinic_member(*roles: MembershipRole) -> Callable[..., ClinicMember]:
    """Resolves the clinic from the `X-Clinic-Id` header and checks the user works there with one of `roles`.

    Every clinic-scoped endpoint must use this so one clinic can never read another's data.
    """
    allowed = set(roles) or set(MembershipRole)

    def dependency(
        db: DB,
        user: CurrentUser,
        x_clinic_id: Annotated[uuid.UUID, Header(alias="X-Clinic-Id")],
    ) -> ClinicMember:
        member = db.scalar(
            select(ClinicMember).where(
                ClinicMember.clinic_id == x_clinic_id,
                ClinicMember.user_id == user.id,
                ClinicMember.is_active.is_(True),
            )
        )
        if member is None or member.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this clinic")
        return member

    return dependency


def require_admin(user: CurrentUser) -> User:
    """Super Admin, with two-factor authentication enabled (enforced outside development)."""
    from app.core.config import get_settings

    if user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed for your role")
    if not user.totp_enabled and not get_settings().is_dev:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "totp_setup_required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
