"""Daily check-ins, consent and the red-flag safety path (milestone A2 of docs/digital-twin/A-knee-twin.md).

The consent text and red-flag advice are fixed wording, never generated. Both need sign-off before a clinic pilot:
the consent text by a lawyer (DPDP Act 2023), the advice by the clinical lead.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.clinic import Clinic
from app.models.clinical import CarePlan, CarePlanStatus
from app.models.engagement import Notification
from app.models.patient import ClinicPatient, Patient
from app.models.twin import Consent, DailyCheckin
from app.schemas.twin import AdviceOut, CheckinOut, ConsentStateOut, OptionOut

# Protocols whose patients get the daily check-in (the knee-twin pilot).
CHECKIN_PROTOCOLS = {"tka"}

TWIN_TRACKING = "twin_tracking"
WHATSAPP = "whatsapp"
CONSENTS = {
    TWIN_TRACKING: {
        "version": "2026-09",
        "title": "Share your recovery with your physio",
        "body": (
            "To help your physio follow your recovery between visits, Physionexs stores your daily check-ins "
            "(pain, stiffness, swelling, sleep, whether you did your exercises and any warning signs you report) "
            "and the measurements your physio records. Only your physio's clinic can see them. We use them to show "
            "your progress and to alert your physio early. You can stop at any time; we then stop collecting new "
            "check-ins. This is not an emergency service. If you feel very unwell, call 112."
        ),
    },
    WHATSAPP: {
        "version": "2026-09",
        "title": "Get your daily check-in on WhatsApp",
        "body": (
            "We'll send one WhatsApp message each morning to your mobile number for your daily check-in. Your answers "
            "pass through WhatsApp (Meta) and reach your physio like an app check-in. Messages never include your "
            "diagnosis. Reply STOP at any time to turn them off."
        ),
    },
}

RED_FLAGS = {
    "calf_pain": "New pain, swelling or tenderness in the calf",
    "fever": "Fever or chills",
    "wound_redness": "Wound redder, hotter or leaking",
    "chest_breathless": "Chest pain or sudden breathlessness",
}
EMERGENCY_FLAGS = {"chest_breathless"}


def red_flag_options() -> list[OptionOut]:
    return [OptionOut(code=k, label=v) for k, v in RED_FLAGS.items()]


def eligible_plan(db: Session, patient_id: uuid.UUID) -> CarePlan | None:
    """The patient's most recent active plan that uses check-ins, if any."""
    return db.scalar(
        select(CarePlan)
        .join(ClinicPatient, ClinicPatient.id == CarePlan.clinic_patient_id)
        .where(ClinicPatient.patient_id == patient_id, CarePlan.status == CarePlanStatus.ACTIVE, CarePlan.protocol.in_(CHECKIN_PROTOCOLS))
        .order_by(CarePlan.created_at.desc())
        .limit(1)
    )


def active_consent(db: Session, patient_id: uuid.UUID, purpose: str) -> Consent | None:
    return db.scalar(select(Consent).where(Consent.patient_id == patient_id, Consent.purpose == purpose, Consent.withdrawn_at.is_(None)))


def consent_state(consent: Consent | None, purpose: str = TWIN_TRACKING) -> ConsentStateOut:
    spec = CONSENTS[purpose]
    current = consent is not None and consent.version == spec["version"]
    return ConsentStateOut(purpose=purpose, version=spec["version"], title=spec["title"], body=spec["body"],
                           granted=current, granted_at=consent.granted_at if current else None)


def advice_for(flags: list[str], clinic: Clinic) -> AdviceOut | None:
    """Fixed safety advice shown to the patient the moment they report a red flag."""
    if not flags:
        return None
    if EMERGENCY_FLAGS & set(flags):
        return AdviceOut(
            level="emergency",
            title="Call 112 now",
            body="Chest pain or sudden breathlessness after surgery can be a medical emergency. Call 112 or go to the nearest "
                 "emergency department now. Then let your clinic know.",
            call_label="Call 112", call_number="112",
        )
    items = [RED_FLAGS[f].lower() for f in flags if f in RED_FLAGS]
    listed = items[0] if len(items) == 1 else f"{', '.join(items[:-1])} and {items[-1]}"
    return AdviceOut(
        level="urgent",
        title="Contact your clinic now",
        body=f"You reported {listed}. After knee surgery this should be checked soon. Call {clinic.name} now. If you can't "
             f"reach them, contact your surgeon or go to a hospital.",
        call_label=f"Call {clinic.name}" if clinic.phone else None,
        call_number=clinic.phone,
    )


def notify_physio(db: Session, plan: CarePlan, patient: Patient, flags: list[str]) -> None:
    """In-app notification for the plan's physio. The dashboard's red-flag card is what they actually see today."""
    db.add(Notification(
        user_id=plan.physio_user_id, kind="red_flag", title=f"Red flag: {patient.full_name}",
        body=", ".join(RED_FLAGS[f] for f in flags if f in RED_FLAGS),
        data={"clinic_patient_id": str(plan.clinic_patient_id), "care_plan_id": str(plan.id)},
    ))


def checkin_out(c: DailyCheckin) -> CheckinOut:
    return CheckinOut(id=c.id, day=c.day, pain=c.pain, stiffness=c.stiffness, swelling=c.swelling, sleep=c.sleep,
                      exercises=c.exercises, red_flags=c.red_flags or [], note=c.note, source=c.source, updated_at=c.updated_at)


def withdraw(consent: Consent) -> None:
    consent.withdrawn_at = datetime.now(UTC)
