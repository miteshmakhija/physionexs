"""Emails for a "Become a pilot clinic" request: a notification to the Physionexs team and a thank-you to the clinic."""

from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

from app.core.config import get_settings
from app.models.platform import PilotLead

settings = get_settings()

KNEE_LABEL = {"<10": "Fewer than 10", "10-30": "10 to 30", "30+": "More than 30"}
_WRAP = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#141414;max-width:560px">'


def _when(lead: PilotLead) -> str:
    at = lead.created_at or datetime.now(ZoneInfo("UTC"))
    return at.astimezone(ZoneInfo("Asia/Kolkata")).strftime("%a %d %b %Y, %I:%M %p IST")


def team_notification(lead: PilotLead) -> tuple[str, str, str]:
    """(subject, text, html) for the team. Reply goes to the clinic (set Reply-To to lead.email)."""
    knee = KNEE_LABEL.get(lead.knee_patients_per_month or "", "Not given")
    digits = lead.phone.lstrip("+")
    subject = f"New pilot request: {lead.clinic_name}, {lead.city}"
    rows = [
        ("Clinic", lead.clinic_name),
        ("Contact person", lead.contact_name),
        ("City", lead.city),
        ("Mobile", lead.phone),
        ("Email", lead.email or "Not given"),
        ("Knee-replacement patients a month", knee),
        ("Received", _when(lead)),
    ]
    text = (
        f"A clinic has asked to join the Physionexs pilot.\n\n"
        + "\n".join(f"{k}: {v}" for k, v in rows)
        + (f"\n\nTheir message:\n{lead.message}" if lead.message else "")
        + "\n\nNext steps:\n"
        "1. Call or WhatsApp them within one working day.\n"
        "2. Book a 20-minute demo of recovery tracking, check-ins and camera measurement.\n"
        "3. Mark the lead as contacted in Super Admin → Records → Pilot leads.\n\n"
        f"Pilot leads: {settings.web_url.rstrip('/')}/admin/records\n"
        "Reply to this email to write to the clinic directly."
    )
    cell = 'style="padding:8px 12px;border-bottom:1px solid #e5e5e0;vertical-align:top"'
    table = "".join(
        f'<tr><td {cell}><span style="color:#6b6b66">{escape(k)}</span></td><td {cell}><b>{escape(v)}</b></td></tr>' for k, v in rows
    )
    button = 'style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border:1px solid #141414;color:#141414;text-decoration:none;font-weight:bold;font-size:13px"'
    actions = (
        f'<a href="tel:{escape(lead.phone)}" {button}>Call</a>'
        f'<a href="https://wa.me/{escape(digits)}" {button}>WhatsApp</a>'
        + (f'<a href="mailto:{escape(lead.email)}" {button}>Email</a>' if lead.email else "")
    )
    message = (
        f'<p style="margin:20px 0 6px;color:#6b6b66">Their message</p>'
        f'<p style="margin:0;padding:12px 14px;background:#f4f4f1;white-space:pre-line">{escape(lead.message)}</p>'
        if lead.message else ""
    )
    html = (
        f"{_WRAP}<p style=\"margin:0 0 4px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#1170c2\"><b>New pilot request</b></p>"
        f"<h2 style=\"margin:0 0 16px;font-size:22px\">{escape(lead.clinic_name)}, {escape(lead.city)}</h2>"
        f'<table style="border-collapse:collapse;width:100%;font-size:14px">{table}</table>'
        f"{message}"
        f'<p style="margin:22px 0 8px">{actions}</p>'
        f'<p style="margin:16px 0 6px;color:#6b6b66">Next steps</p>'
        f"<ol style=\"margin:0;padding-left:20px\"><li>Call or WhatsApp them within one working day.</li>"
        f"<li>Book a 20-minute demo of recovery tracking, check-ins and camera measurement.</li>"
        f"<li>Mark the lead as contacted in <a href=\"{escape(settings.web_url.rstrip('/'))}/admin/records\">Super Admin → Records → Pilot leads</a>.</li></ol>"
        f'<p style="margin:20px 0 0;font-size:12px;color:#6b6b66">Reply to this email to write to the clinic directly.</p></div>'
    )
    return subject, text, html


def clinic_acknowledgement(lead: PilotLead, support: dict) -> tuple[str, str, str]:
    """(subject, text, html) thanking the clinic and saying what happens next."""
    first = lead.contact_name.split()[0]
    phone = support.get("phone") or support.get("helpline") or ""
    subject = "Thanks for your interest in the Physionexs pilot"
    text = (
        f"Hi {first},\n\n"
        f"Thank you for asking to join the Physionexs pilot for {lead.clinic_name}. We've received your details.\n\n"
        "What happens next:\n"
        "1. Someone from our team will call you within one working day.\n"
        "2. We'll show you recovery tracking, daily patient check-ins, camera measurement and AI assist in a short demo.\n"
        "3. When you're ready, we switch the pilot on for your clinic. Your physios decide every change to a patient's plan.\n\n"
        f"Questions in the meantime? Reply to this email{f' or call us on {phone}' if phone else ''}.\n\n"
        "Team Physionexs\nphysionexs.com"
    )
    html = (
        f"{_WRAP}<p>Hi {escape(first)},</p>"
        f"<p>Thank you for asking to join the Physionexs pilot for <b>{escape(lead.clinic_name)}</b>. We've received your details.</p>"
        "<p style=\"margin:18px 0 6px\"><b>What happens next</b></p>"
        "<ol style=\"margin:0;padding-left:20px\"><li>Someone from our team will call you within one working day.</li>"
        "<li>We'll show you recovery tracking, daily patient check-ins, camera measurement and AI assist in a short demo.</li>"
        "<li>When you're ready, we switch the pilot on for your clinic. Your physios decide every change to a patient's plan.</li></ol>"
        f"<p style=\"margin-top:18px\">Questions in the meantime? Reply to this email{f' or call us on <b>{escape(phone)}</b>' if phone else ''}.</p>"
        "<p style=\"margin-top:22px\">Team Physionexs<br><a href=\"https://physionexs.com\" style=\"color:#1170c2\">physionexs.com</a></p></div>"
    )
    return subject, text, html
