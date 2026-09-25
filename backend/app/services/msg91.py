import logging

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

OTP_URL = "https://control.msg91.com/api/v5/otp"


class SmsError(RuntimeError):
    pass


def send_otp(phone_e164: str, code: str) -> None:
    """Send a login OTP with MSG91's OTP API, passing our own code so verification stays in our DB.

    Without MSG91 credentials (local dev) the code is logged instead of sent.
    """
    if not settings.msg91_auth_key or not settings.msg91_otp_template_id:
        if not settings.is_dev:
            raise SmsError("MSG91 is not configured")
        log.warning("DEV OTP for %s: %s", phone_e164, code)
        return

    params = {
        "template_id": settings.msg91_otp_template_id,
        "mobile": phone_e164.lstrip("+"),
        "otp": code,
        "otp_length": str(len(code)),
        "otp_expiry": str(max(1, settings.otp_ttl_seconds // 60)),
    }
    try:
        resp = httpx.post(OTP_URL, params=params, headers={"authkey": settings.msg91_auth_key}, timeout=10)
        body = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SmsError("Could not reach SMS provider") from exc
    if resp.status_code != 200 or body.get("type") != "success":
        log.error("MSG91 OTP send failed: %s", body)
        raise SmsError("SMS provider rejected the request")
