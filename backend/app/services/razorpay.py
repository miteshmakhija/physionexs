"""Razorpay Orders + signature checks.

Without keys (local dev) orders are simulated: ids start with `order_dev_` and the client
confirms with signature "dev". That path is refused in production.
"""

import hashlib
import hmac
import logging
import secrets

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

API = "https://api.razorpay.com/v1"
DEV_PREFIX = "order_dev_"


class PaymentGatewayError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(settings.razorpay_key_id and settings.razorpay_key_secret)


def public_key_id() -> str:
    return settings.razorpay_key_id or "rzp_dev"


def create_order(amount_paise: int, receipt: str, notes: dict[str, str]) -> str:
    """Create an order and return its id."""
    if not is_configured():
        if not settings.is_dev:
            raise PaymentGatewayError("Razorpay is not configured")
        return DEV_PREFIX + secrets.token_hex(8)
    try:
        resp = httpx.post(
            f"{API}/orders",
            auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            json={"amount": amount_paise, "currency": "INR", "receipt": receipt[:40], "notes": notes},
            timeout=15,
        )
    except httpx.HTTPError as exc:
        raise PaymentGatewayError("Could not reach Razorpay") from exc
    if resp.status_code != 200:
        log.error("Razorpay order failed: %s %s", resp.status_code, resp.text[:300])
        raise PaymentGatewayError("Razorpay rejected the order")
    return resp.json()["id"]


def verify_payment_signature(order_id: str, payment_id: str, signature: str) -> bool:
    if order_id.startswith(DEV_PREFIX):
        return settings.is_dev and not is_configured() and signature == "dev"
    if not settings.razorpay_key_secret:
        return False
    expected = hmac.new(settings.razorpay_key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(body: bytes, signature: str | None) -> bool:
    if not settings.razorpay_webhook_secret or not signature:
        return False
    expected = hmac.new(settings.razorpay_webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
