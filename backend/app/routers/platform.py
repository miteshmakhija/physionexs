"""Public platform info (no sign-in needed)."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.deps import DB
from app.services.settings import get_setting

router = APIRouter(prefix="/platform", tags=["platform"])


class SupportOut(BaseModel):
    email: str
    phone: str
    address: str
    hours: str


@router.get("/support", response_model=SupportOut)
def support(db: DB) -> SupportOut:
    value = get_setting(db, "support")
    return SupportOut(
        email=value.get("email", ""),
        phone=value.get("phone") or value.get("helpline", ""),
        address=value.get("address", ""),
        hours=value.get("hours", ""),
    )


class AuthConfigOut(BaseModel):
    google_client_id: str | None  # public OAuth client id; null when Google sign-in is off


@router.get("/auth-config", response_model=AuthConfigOut)
def auth_config() -> AuthConfigOut:
    from app.services import google

    return AuthConfigOut(google_client_id=google.settings.google_client_id if google.is_configured() else None)
