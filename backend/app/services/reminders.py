"""Daily check-in reminder: a push-only nudge (not stored in the feed) for patients who haven't checked in yet.

Patients who opted in to WhatsApp check-ins are skipped when WhatsApp is on; they get the WhatsApp invite instead.
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.patient import Patient
from app.models.twin import Consent, DailyCheckin
from app.models.user import DeviceToken
from app.services import push
from app.services.checkins import CONSENTS, TWIN_TRACKING, WHATSAPP, active_consent, eligible_plan

TITLE = "Time for your daily check-in"
BODY = "It takes 30 seconds and helps your physio keep your plan right."


def send_checkin_reminders(db: Session, today: date) -> int:
    rows = db.execute(
        select(Patient, DeviceToken.expo_token)
        .join(DeviceToken, DeviceToken.user_id == Patient.user_id)
        .join(Consent, (Consent.patient_id == Patient.id) & (Consent.purpose == TWIN_TRACKING) & Consent.withdrawn_at.is_(None))
        .where(Consent.version == CONSENTS[TWIN_TRACKING]["version"])
    ).all()
    whatsapp_on = get_settings().whatsapp_enabled
    messages, reminded = [], set()
    for patient, token in rows:
        if patient.id not in reminded:
            if eligible_plan(db, patient.id) is None:
                continue
            if db.scalar(select(DailyCheckin.id).where(DailyCheckin.patient_id == patient.id, DailyCheckin.day == today)):
                continue
            if whatsapp_on and active_consent(db, patient.id, WHATSAPP):
                continue
        reminded.add(patient.id)
        messages.append({"to": token, "title": TITLE, "body": BODY, "sound": "default", "data": {"kind": "checkin_reminder"}})
    if messages:
        push.send(None, messages)
    return len(reminded)
