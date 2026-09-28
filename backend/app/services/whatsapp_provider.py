"""Sending WhatsApp messages and reading webhooks.

"meta" talks to the WhatsApp Cloud API directly. "log" (development only) records messages instead of sending them.
Another provider (e.g. MSG91's WhatsApp API) plugs in by implementing `send` and `parse_webhook`.
"""

import hashlib
import hmac
import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.services.whatsapp_flow import Out

log = logging.getLogger(__name__)
settings = get_settings()

GRAPH = "https://graph.facebook.com/v25.0"


class WhatsAppError(RuntimeError):
    pass


@dataclass
class Inbound:
    provider_id: str  # message id, for de-duplicating retries
    phone: str  # E.164, e.g. +919812345678
    choice: str | None  # tapped button / list row / template quick reply
    text: str | None


def verify_signature(body: bytes, header: str | None) -> bool:
    """Meta signs webhook bodies: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, body)."""
    if settings.whatsapp_provider == "log" and settings.is_dev:
        return True
    if not settings.whatsapp_app_secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(settings.whatsapp_app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.removeprefix("sha256="))


def parse_webhook(payload: dict) -> list[Inbound]:
    """Incoming messages from a Cloud API webhook. Delivery statuses and unsupported types are ignored."""
    out = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            for m in (change.get("value") or {}).get("messages", []) or []:
                choice = text = None
                kind = m.get("type")
                if kind == "text":
                    text = (m.get("text") or {}).get("body")
                elif kind == "interactive":
                    i = m.get("interactive") or {}
                    choice = (i.get("button_reply") or i.get("list_reply") or {}).get("id")
                elif kind == "button":  # quick reply on a template message
                    b = m.get("button") or {}
                    choice = b.get("payload") or (b.get("text") or "").strip().lower() or None
                else:
                    continue
                out.append(Inbound(provider_id=m.get("id", ""), phone="+" + str(m.get("from", "")).lstrip("+"), choice=choice, text=text))
    return out


# Messages "sent" by the log provider, newest last (development and tests).
SENT: list[dict] = []


def _payload(to: str, msg: Out) -> dict:
    base = {"messaging_product": "whatsapp", "to": to.lstrip("+")}
    if msg.kind == "text":
        return base | {"type": "text", "text": {"body": msg.body}}
    if msg.kind == "buttons":
        return base | {"type": "interactive", "interactive": {
            "type": "button", "body": {"text": msg.body},
            "action": {"buttons": [{"type": "reply", "reply": {"id": i, "title": t}} for i, t, _ in msg.options]},
        }}
    rows = [{"id": i, "title": t} | ({"description": d} if d else {}) for i, t, d in msg.options]
    return base | {"type": "interactive", "interactive": {
        "type": "list", "body": {"text": msg.body}, "action": {"button": msg.button or "Choose", "sections": [{"title": "Options", "rows": rows}]},
    }}


def _template_payload(to: str, first_name: str) -> dict:
    return {
        "messaging_product": "whatsapp", "to": to.lstrip("+"), "type": "template",
        "template": {
            "name": settings.whatsapp_checkin_template, "language": {"code": settings.whatsapp_template_language},
            "components": [{"type": "body", "parameters": [{"type": "text", "text": first_name}]}],
        },
    }


def _post(payload: dict) -> str | None:
    if settings.whatsapp_provider == "log":
        SENT.append(payload)
        log.info("WhatsApp (log) → %s: %s", payload["to"], payload.get("type"))
        return f"log-{len(SENT)}"
    try:
        r = httpx.post(f"{GRAPH}/{settings.whatsapp_phone_number_id}/messages", json=payload,
                       headers={"Authorization": f"Bearer {settings.whatsapp_token}"}, timeout=10)
        body = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise WhatsAppError("Could not reach WhatsApp") from exc
    if r.status_code != 200:
        raise WhatsAppError(f"WhatsApp rejected the message: {(body.get('error') or {}).get('message', r.status_code)}")
    return (body.get("messages") or [{}])[0].get("id")


def send(to: str, msg: Out) -> str | None:
    return _post(_payload(to, msg))


def send_checkin_invite(to: str, first_name: str) -> str | None:
    """The approved utility template that opens the day's conversation. Only the first name is included."""
    return _post(_template_payload(to, first_name))
