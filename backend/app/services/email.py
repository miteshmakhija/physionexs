import logging

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()


class EmailError(RuntimeError):
    pass


def send_email(to: str, subject: str, text: str, html: str | None = None) -> None:
    """Send a transactional email with Resend. Without an API key (local dev) the message is logged."""
    if not settings.resend_api_key:
        if not settings.is_dev:
            raise EmailError("Email is not configured")
        log.warning("DEV EMAIL to %s: %s\n%s", to, subject, text)
        return
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.email_from, "to": [to], "subject": subject, "text": text, **({"html": html} if html else {})},
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise EmailError("Could not reach the email service") from exc
    if resp.status_code >= 300:
        log.error("Resend failed: %s %s", resp.status_code, resp.text[:300])
        raise EmailError("Email service rejected the message")
