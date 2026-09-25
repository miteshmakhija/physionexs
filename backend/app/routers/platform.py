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
