import json
import logging

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from app.core.deps import DB
from app.models.billing import Payment, PaymentPurpose, PaymentStatus
from app.core.config import get_settings
from app.services import booking, razorpay
from app.services.whatsapp import handle_inbound
from app.services.whatsapp_provider import parse_webhook, verify_signature

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger(__name__)


@router.post("/razorpay", status_code=status.HTTP_200_OK)
async def razorpay_webhook(
    request: Request,
    db: DB,
    x_razorpay_signature: str | None = Header(default=None),
) -> dict:
    """Configure in Razorpay Dashboard → Webhooks with events payment.captured, order.paid, payment.failed."""
    body = await request.body()
    if not razorpay.verify_webhook_signature(body, x_razorpay_signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid signature")
    event = json.loads(body)
    kind = event.get("event")
    entity = (event.get("payload", {}).get("payment") or {}).get("entity") or {}
    order_id = entity.get("order_id") or ((event.get("payload", {}).get("order") or {}).get("entity") or {}).get("id")
    if not order_id:
        return {"ok": True}

    payment = db.scalar(select(Payment).where(Payment.razorpay_order_id == order_id).with_for_update())
    if payment is None:
        log.warning("Razorpay webhook for unknown order %s", order_id)
        return {"ok": True}

    if kind in ("payment.captured", "order.paid") and payment.purpose == PaymentPurpose.APPOINTMENT:
        booking.finalize_payment(db, payment, razorpay_payment_id=entity.get("id"), method=entity.get("method"))
        db.commit()
    elif kind in ("payment.captured", "order.paid") and payment.purpose == PaymentPurpose.SUBSCRIPTION:
        from app.routers.practice import apply_subscription_payment

        apply_subscription_payment(db, payment, entity.get("id"), entity.get("method"))
        db.commit()
    elif kind == "payment.failed" and payment.status == PaymentStatus.CREATED:
        payment.meta = {**payment.meta, "last_failure": entity.get("error_description")}
        db.commit()
    return {"ok": True}


# ── WhatsApp check-ins (design C) ───────────────────────────────────────────


@router.get("/whatsapp", response_class=PlainTextResponse)
def whatsapp_verify(
    mode: str | None = Query(default=None, alias="hub.mode"),
    token: str | None = Query(default=None, alias="hub.verify_token"),
    challenge: str | None = Query(default=None, alias="hub.challenge"),
) -> str:
    """Meta's one-time webhook handshake: echo the challenge if the verify token matches."""
    s = get_settings()
    if not s.whatsapp_enabled or mode != "subscribe" or not s.whatsapp_verify_token or token != s.whatsapp_verify_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Verification failed")
    return challenge or ""


@router.post("/whatsapp", status_code=status.HTTP_200_OK)
async def whatsapp_webhook(request: Request, db: DB, x_hub_signature_256: str | None = Header(default=None)) -> dict:
    """Incoming WhatsApp messages. Always answers 200 once verified, so Meta doesn't retry what we've handled."""
    if not get_settings().whatsapp_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    body = await request.body()
    if not verify_signature(body, x_hub_signature_256):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid signature")
    for m in parse_webhook(json.loads(body or b"{}")):
        try:
            handle_inbound(db, m)
        except Exception:
            db.rollback()
            log.exception("WhatsApp message %s failed", m.provider_id)
    return {"ok": True}
