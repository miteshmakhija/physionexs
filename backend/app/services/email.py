import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()


class EmailError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool((settings.smtp_host and settings.smtp_user and settings.smtp_password) or settings.resend_api_key)


def send_email(to: str, subject: str, text: str, html: str | None = None) -> None:
    """Send a transactional email: through SMTP when set (e.g. the clinic's Google Workspace mailbox), else Resend.

    Without either (local dev) the message is logged.
    """
    if settings.smtp_host and settings.smtp_user and settings.smtp_password:
        return _smtp(to, subject, text, html)
    if settings.resend_api_key:
        return _resend(to, subject, text, html)
    if not settings.is_dev:
        raise EmailError("Email is not configured")
    log.warning("DEV EMAIL to %s: %s\n%s", to, subject, text)


def _smtp(to: str, subject: str, text: str, html: str | None) -> None:
    name, _ = parseaddr(settings.email_from)
    msg = EmailMessage()
    # Gmail only sends as the signed-in mailbox (or its aliases), so the address comes from SMTP_USER unless
    # EMAIL_FROM names one; the display name is kept either way.
    sender = parseaddr(settings.email_from)[1]
    msg["From"] = formataddr((name or "Physionexs", sender if sender.split("@")[-1] == settings.smtp_user.split("@")[-1] else settings.smtp_user))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        if settings.smtp_port == 465:
            with smtplib.SMTP_SSL(settings.smtp_host, 465, context=ssl.create_default_context(), timeout=15) as s:
                s.login(settings.smtp_user, settings.smtp_password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(settings.smtp_user, settings.smtp_password)
                s.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        log.error("SMTP send failed: %s", exc)
        raise EmailError("Could not send the email") from exc


def _resend(to: str, subject: str, text: str, html: str | None) -> None:
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
