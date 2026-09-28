"""WhatsApp check-ins (design C): the morning invite, the conversation, STOP/START, and saving the answers.

Answers are saved through the same path as app check-ins (services/checkin_submit.py), so red-flag advice, physio
alerts and flag rules behave identically. State is committed before replies are sent, so a failed send never loses
answers, and webhook retries are ignored by message id.
"""

import logging
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.patient import Patient
from app.models.twin import CheckinSource, Consent, DailyCheckin, WhatsAppMessage, WhatsAppSession
from app.schemas.twin import AdviceOut, CheckinIn
from app.services.checkin_submit import clinic_of, save_checkin
from app.services.checkins import CONSENTS, TWIN_TRACKING, WHATSAPP, active_consent, eligible_plan, withdraw
from app.services.twin_rules import local_today
from app.services.whatsapp_flow import Out, Reply, handle
from app.services.whatsapp_provider import Inbound, WhatsAppError, send, send_checkin_invite

log = logging.getLogger(__name__)

STOP_WORDS = {"stop", "unsubscribe", "stop all", "cancel"}


def advice_text(a: AdviceOut) -> str:
    call = f"\nCall: {a.call_number}" if a.call_number else ""
    return f"{a.title}\n{a.body}{call}"


def find_patient(db: Session, phone: str) -> Patient | None:
    # Prefer the record linked to an app account, as sign-up does.
    return db.scalar(select(Patient).where(Patient.phone == phone).order_by(Patient.user_id.is_(None)).limit(1))


def _deliver(db: Session, patient_id, to: str, messages: list[Out]) -> None:
    for m in messages:
        try:
            pid = send(to, m)
        except WhatsAppError:
            log.exception("WhatsApp send failed")
            pid = None
        db.add(WhatsAppMessage(provider_id=pid, direction="out", patient_id=patient_id, kind=m.kind, status="sent" if pid else "failed"))
    db.commit()


def _ready(db: Session, patient: Patient):
    """The plan to check in against, if check-ins apply and the patient has agreed to share them."""
    plan = eligible_plan(db, patient.id)
    twin = active_consent(db, patient.id, TWIN_TRACKING)
    return plan if plan and twin and twin.version == CONSENTS[TWIN_TRACKING]["version"] else None


def handle_inbound(db: Session, m: Inbound) -> None:
    if m.provider_id and db.scalar(select(WhatsAppMessage.id).where(WhatsAppMessage.provider_id == m.provider_id)):
        return  # webhook retry
    patient = find_patient(db, m.phone)
    db.add(WhatsAppMessage(provider_id=m.provider_id or None, direction="in", patient_id=patient.id if patient else None, kind="inbound"))
    word = (m.text or "").strip().lower()
    reply: list[Out] = []

    if patient is None:
        reply = [Out("text", "This number isn't linked to a Physionexs patient. Please use the number your clinic has on file.")]
    elif word in STOP_WORDS:
        if (wa := active_consent(db, patient.id, WHATSAPP)) is not None:
            withdraw(wa)
        reply = [Out("text", "You won't get check-in messages here any more. Reply START to turn them back on.")]
    elif active_consent(db, patient.id, WHATSAPP) is None:
        opted_in_before = db.scalar(select(Consent.id).where(Consent.patient_id == patient.id, Consent.purpose == WHATSAPP).limit(1))
        if word == "start" and opted_in_before:
            db.add(Consent(patient_id=patient.id, purpose=WHATSAPP, version=CONSENTS[WHATSAPP]["version"]))
            reply = [Out("text", "WhatsApp check-ins are back on. You'll get one each morning. Reply STOP to turn them off.")]
        else:
            reply = [Out("text", "To get your daily check-in here, turn on WhatsApp check-ins in the Physionexs app.")]
    elif (plan := _ready(db, patient)) is None:
        reply = [Out("text", "Daily check-ins aren't turned on for your care plan right now. Your physio can switch them on.")]
    else:
        reply = _converse(db, patient, plan, local_today(), Reply(choice=m.choice, text=m.text))

    db.commit()  # save state before sending, so a failed send never loses answers
    if reply:
        _deliver(db, patient.id if patient else None, m.phone, reply)


def _converse(db: Session, patient: Patient, plan, today: date, r: Reply) -> list[Out]:
    sess = db.scalar(select(WhatsAppSession).where(WhatsAppSession.patient_id == patient.id, WhatsAppSession.day == today).with_for_update())
    if sess is None:
        if db.scalar(select(DailyCheckin.id).where(DailyCheckin.patient_id == patient.id, DailyCheckin.day == today)):
            return [Out("text", "You've already checked in today. Thank you! See you tomorrow.")]
        sess = WhatsAppSession(patient_id=patient.id, day=today, step="invite", answers={})
        db.add(sess)
    if sess.step == "done":
        return [Out("text", "You've already checked in today. Thank you! See you tomorrow.")]
    if sess.step == "skipped":
        sess.step = "invite"  # they wrote back after skipping: offer again

    step, answers, out = handle(sess.step, sess.answers or {}, r)
    sess.step, sess.answers = step, answers
    if step != "done":
        return out
    body = CheckinIn(day=today, pain=answers["pain"], stiffness=answers["stiffness"], swelling=answers["swelling"],
                     sleep=answers["sleep"], exercises=answers["exercises"], red_flags=answers.get("red_flags", []))
    _, advice = save_checkin(db, patient, plan, body, CheckinSource.WHATSAPP)
    if advice:
        return [Out("text", advice_text(advice))]
    return [Out("text", f"Thank you! Your physio at {clinic_of(db, plan).name} can see today's check-in.")]


def send_daily_invites(db: Session, today: date | None = None) -> int:
    """Cron: one morning invite per opted-in patient who hasn't checked in today. Returns how many were sent."""
    today = today or local_today()
    sent = 0
    patient_ids = db.scalars(select(Consent.patient_id).where(Consent.purpose == WHATSAPP, Consent.withdrawn_at.is_(None)).distinct())
    for pid in list(patient_ids):
        patient = db.get(Patient, pid)
        if not patient or not patient.phone or _ready(db, patient) is None:
            continue
        if db.scalar(select(DailyCheckin.id).where(DailyCheckin.patient_id == pid, DailyCheckin.day == today)):
            continue
        if db.scalar(select(WhatsAppSession.id).where(WhatsAppSession.patient_id == pid, WhatsAppSession.day == today)):
            continue  # idempotent: the cron may run twice
        db.add(WhatsAppSession(patient_id=pid, day=today, step="invite", answers={}))
        db.commit()
        try:
            msg_id = send_checkin_invite(patient.phone, patient.full_name.split()[0])
        except WhatsAppError:
            log.exception("WhatsApp invite failed for patient %s", pid)
            msg_id = None
        db.add(WhatsAppMessage(provider_id=msg_id, direction="out", patient_id=pid, kind="template", status="sent" if msg_id else "failed"))
        db.commit()
        sent += bool(msg_id)
    return sent

