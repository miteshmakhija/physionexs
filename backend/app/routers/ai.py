"""Practice console: AI assist (Claude) for physiotherapists. Drafts only; see services/ai.py for what's sent."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.core.deps import DB, CurrentUser, require_clinic_member
from app.models.clinic import Clinic, ClinicMember, MembershipRole
from app.models.patient import ClinicPatient
from app.models.twin import TwinFlag
from app.services import ai, audit
from app.services.clinical import clinic_patient_or_404
from app.services.twin_rules import active_plan_for, local_today

router = APIRouter(prefix="/clinic/ai", tags=["ai"])


def _ai_clinician(member: Annotated[ClinicMember, Depends(require_clinic_member(MembershipRole.OWNER, MembershipRole.PHYSIO))], db: DB) -> ClinicMember:
    clinic = db.get(Clinic, member.clinic_id)
    if not (clinic.twin_pilot and clinic.ai_assist):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "AI assist isn't switched on for this clinic")
    if not ai.enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "AI assist isn't configured on the server")
    return member


Clinician = Annotated[ClinicMember, Depends(_ai_clinician)]


class AIText(BaseModel):
    text: str
    model: str = ai.MODEL


def _patient_context(db, member: ClinicMember, cp_id: uuid.UUID):
    cp = clinic_patient_or_404(db, member, cp_id)
    plan = active_plan_for(db, cp.id)
    if plan is None or plan.protocol is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This patient has no active recovery-tracking plan")
    return cp, ai.context(db, cp, plan, local_today())


def _run(kind: str, data: dict, flag: TwinFlag | None = None) -> str:
    try:
        return ai.ask(kind, data, flag)
    except ai.AIUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))


@router.post("/flags/{flag_id}/explain", response_model=AIText)
def explain_flag(flag_id: uuid.UUID, member: Clinician, user: CurrentUser, db: DB, request: Request) -> AIText:
    """Plain-language explanation of a flag. Cached on the flag until its data changes."""
    f = db.get(TwinFlag, flag_id)
    if f is None or db.get(ClinicPatient, f.clinic_patient_id).clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flag not found")
    if f.explanation:
        return AIText(text=f.explanation)
    _, data = _patient_context(db, member, f.clinic_patient_id)
    f.explanation = _run("explain_flag", data, f)
    audit.record(db, action="ai_explain", entity="twin_flag", entity_id=f.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return AIText(text=f.explanation)


@router.post("/patients/{cp_id}/summary", response_model=AIText)
def weekly_summary(cp_id: uuid.UUID, member: Clinician, user: CurrentUser, db: DB, request: Request) -> AIText:
    """The last 7 days in a short paragraph for the physio. Not stored."""
    cp, data = _patient_context(db, member, cp_id)
    text = _run("summary", data)
    audit.record(db, action="ai_summary", entity="clinic_patient", entity_id=cp.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return AIText(text=text)


@router.post("/patients/{cp_id}/objective", response_model=AIText)
def draft_objective(cp_id: uuid.UUID, member: Clinician, user: CurrentUser, db: DB, request: Request) -> AIText:
    """A draft for the consultation note's Objective box; the physio edits it before saving."""
    cp, data = _patient_context(db, member, cp_id)
    text = _run("objective", data)
    audit.record(db, action="ai_objective", entity="clinic_patient", entity_id=cp.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return AIText(text=text)
