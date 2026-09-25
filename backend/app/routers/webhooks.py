import json
import logging

from fastapi import APIRouter, Header, HTTPException, Request, status
from sqlalchemy import select

from app.core.deps import DB
from app.models.billing import Payment, PaymentPurpose, PaymentStatus
from app.services import booking, razorpay

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
    elif kind == "payment.failed" and payment.status == PaymentStatus.CREATED:
        payment.meta = {**payment.meta, "last_failure": entity.get("error_description")}
        db.commit()
    return {"ok": True}
