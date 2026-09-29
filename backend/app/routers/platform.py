"""Public platform info (no sign-in needed)."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, status
from pydantic import AfterValidator, BaseModel, EmailStr, Field
from sqlalchemy import or_, select

from app.core.deps import DB
from app.core.phone import normalize_phone
from app.models.platform import PilotLead
from app.services.email import send_email
from app.services.settings import get_setting

log = logging.getLogger(__name__)

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
    online_payments: bool = False  # Razorpay is set up; otherwise bookings are paid at the clinic


@router.get("/auth-config", response_model=AuthConfigOut)
def auth_config() -> AuthConfigOut:
    from app.services import google

    from app.core.config import get_settings
    from app.services import razorpay

    return AuthConfigOut(
        google_client_id=google.settings.google_client_id if google.is_configured() else None,
        online_payments=razorpay.is_configured() or get_settings().is_dev,  # dev simulates orders
    )



class PilotLeadIn(BaseModel):
    clinic_name: Annotated[str, Field(min_length=2, max_length=160)]
    contact_name: Annotated[str, Field(min_length=2, max_length=120)]
    city: Annotated[str, Field(min_length=2, max_length=80)]
    phone: Annotated[str, AfterValidator(normalize_phone)]
    email: EmailStr | None = None
    knee_patients_per_month: Literal["<10", "10-30", "30+"] | None = None
    message: Annotated[str, Field(max_length=1000)] | None = None
    website: str | None = None  # hidden field: people leave it empty, bots fill it in


@router.post("/pilot-leads", status_code=status.HTTP_201_CREATED)
def request_pilot(body: PilotLeadIn, db: DB) -> dict:
    """Home page: "Become a pilot clinic". Saved for the Super Admin (Records → Pilot leads) and emailed to support."""
    if body.website:
        return {"ok": True}  # bot: pretend it worked, save nothing
    recent = datetime.now(UTC) - timedelta(hours=24)
    dup = db.scalar(select(PilotLead.id).where(PilotLead.created_at > recent, or_(PilotLead.phone == body.phone, PilotLead.email == body.email) if body.email else PilotLead.phone == body.phone))
    if dup:
        return {"ok": True}  # already have it; don't resend
    lead = PilotLead(**body.model_dump(exclude={"website"}))
    db.add(lead)
    db.commit()
    to = get_setting(db, "support").get("email")
    if to:
        try:
            send_email(to, f"Pilot clinic request: {lead.clinic_name}, {lead.city}",
                       f"{lead.contact_name} · {lead.phone} · {lead.email or '-'}\n"
                       f"Knee patients a month: {lead.knee_patients_per_month or '-'}\n\n{lead.message or ''}\n\n"
                       "See Super Admin → Records → Pilot leads.")
        except Exception:
            log.exception("Couldn't email pilot lead")
    return {"ok": True}
