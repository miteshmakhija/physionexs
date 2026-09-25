"""Walk-in token queue (reception) and the patient's live token."""

import uuid
from datetime import UTC, date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser, require_clinic_member, require_roles
from app.models.clinic import Branch, Clinic, ClinicMember
from app.models.patient import ClinicPatient, Patient
from app.models.scheduling import QueueToken, TokenStatus
from app.models.user import User, UserRole
from app.schemas.clinical import MyTokenOut, QueueOut, QueueTokenOut, TokenStatusIn, WalkInIn
from app.services import audit
from app.services.clinical import age_of, ensure_clinic_patient

router = APIRouter(tags=["queue"])

Member = Annotated[ClinicMember, Depends(require_clinic_member())]
DEFAULT_CONSULT_MINUTES = 12


def _branch(db: Session, clinic_id: uuid.UUID, branch_id: uuid.UUID) -> Branch:
    branch = db.get(Branch, branch_id)
    if branch is None or branch.clinic_id != clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    return branch


def _today(branch: Branch) -> date:
    return datetime.now(ZoneInfo(branch.timezone)).date()


def _token_out(db: Session, t: QueueToken, clinic_id: uuid.UUID) -> QueueTokenOut:
    patient = db.get(Patient, t.patient_id)
    cp_id = db.scalar(select(ClinicPatient.id).where(ClinicPatient.clinic_id == clinic_id, ClinicPatient.patient_id == t.patient_id))
    physio = db.get(User, t.physio_user_id) if t.physio_user_id else None
    return QueueTokenOut(
        id=t.id, label=t.label, number=t.number, status=t.status, patient_id=t.patient_id, clinic_patient_id=cp_id,
        patient_name=patient.full_name, patient_age=age_of(patient.date_of_birth), patient_sex=patient.sex,
        reason=t.reason, physio_name=physio.full_name if physio else None, created_at=t.created_at, called_at=t.called_at,
    )


def _avg_consult_minutes(tokens: list[QueueToken]) -> int:
    durations = [(t.completed_at - t.called_at).total_seconds() / 60 for t in tokens if t.status == TokenStatus.DONE and t.called_at and t.completed_at]
    return round(sum(durations) / len(durations)) if durations else DEFAULT_CONSULT_MINUTES


@router.get("/clinic/queue", response_model=QueueOut)
def get_queue(branch_id: uuid.UUID, member: Member, db: DB) -> QueueOut:
    branch = _branch(db, member.clinic_id, branch_id)
    day = _today(branch)
    tokens = list(db.scalars(select(QueueToken).where(QueueToken.branch_id == branch.id, QueueToken.service_date == day).order_by(QueueToken.number)))
    serving = next((t for t in tokens if t.status == TokenStatus.SERVING), None)
    waits = [(t.called_at - t.created_at).total_seconds() / 60 for t in tokens if t.called_at]
    return QueueOut(
        branch_id=branch.id,
        service_date=day,
        now_serving=_token_out(db, serving, member.clinic_id) if serving else None,
        waiting=[_token_out(db, t, member.clinic_id) for t in tokens if t.status == TokenStatus.WAITING],
        done=[_token_out(db, t, member.clinic_id) for t in tokens if t.status in (TokenStatus.DONE, TokenStatus.SKIPPED)],
        avg_wait_minutes=round(sum(waits) / len(waits)) if waits else None,
    )


@router.post("/clinic/queue", response_model=QueueTokenOut, status_code=status.HTTP_201_CREATED)
def register_walk_in(body: WalkInIn, member: Member, user: CurrentUser, db: DB, request: Request) -> QueueTokenOut:
    branch = _branch(db, member.clinic_id, body.branch_id)
    cp = ensure_clinic_patient(
        db, member.clinic_id, patient_id=body.patient_id, phone=body.phone, full_name=body.full_name,
        age=body.age, sex=body.sex, physio_id=body.physio_id,
    )
    day = _today(branch)
    # Token numbers are per branch per day; retry on the rare race between two receptionists.
    for _ in range(3):
        number = (db.scalar(select(func.max(QueueToken.number)).where(QueueToken.branch_id == branch.id, QueueToken.service_date == day)) or 0) + 1
        token = QueueToken(branch_id=branch.id, service_date=day, number=number, patient_id=cp.patient_id, physio_user_id=body.physio_id, reason=body.reason)
        try:
            with db.begin_nested():
                db.add(token)
                db.flush()
            break
        except IntegrityError:
            continue
    else:
        raise HTTPException(status.HTTP_409_CONFLICT, "Could not issue a token, please retry")
    cp.last_visit_on = day
    audit.record(db, action="create", entity="queue_token", entity_id=token.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=f"{token.label} · walk-in", request=request)
    db.commit()
    return _token_out(db, token, member.clinic_id)


@router.post("/clinic/queue/call-next", response_model=QueueOut)
def call_next(branch_id: uuid.UUID, member: Member, db: DB) -> QueueOut:
    branch = _branch(db, member.clinic_id, branch_id)
    day = _today(branch)
    now = datetime.now(UTC)
    tokens = list(
        db.scalars(
            select(QueueToken).where(QueueToken.branch_id == branch.id, QueueToken.service_date == day).order_by(QueueToken.number).with_for_update()
        )
    )
    for t in tokens:
        if t.status == TokenStatus.SERVING:
            t.status = TokenStatus.DONE
            t.completed_at = now
    nxt = next((t for t in tokens if t.status == TokenStatus.WAITING), None)
    if nxt:
        nxt.status = TokenStatus.SERVING
        nxt.called_at = now
    db.commit()
    return get_queue(branch_id, member, db)


@router.patch("/clinic/queue/{token_id}", response_model=QueueTokenOut)
def update_token(token_id: uuid.UUID, body: TokenStatusIn, member: Member, db: DB) -> QueueTokenOut:
    token = db.get(QueueToken, token_id)
    if token is None or db.get(Branch, token.branch_id).clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token not found")
    now = datetime.now(UTC)
    if body.status == TokenStatus.SERVING:
        token.called_at = token.called_at or now
    if body.status in (TokenStatus.DONE, TokenStatus.SKIPPED):
        token.completed_at = now
    token.status = body.status
    db.commit()
    return _token_out(db, token, member.clinic_id)


@router.get("/me/tokens", response_model=list[MyTokenOut])
def my_tokens(user: Annotated[User, Depends(require_roles(UserRole.PATIENT))], db: DB) -> list[MyTokenOut]:
    """The patient's walk-in tokens that are still live today, with position and estimated wait."""
    patient_ids = list(db.scalars(select(Patient.id).where(Patient.user_id == user.id)))
    if not patient_ids:
        return []
    mine = db.scalars(
        select(QueueToken).where(
            QueueToken.patient_id.in_(patient_ids),
            QueueToken.status.in_([TokenStatus.WAITING, TokenStatus.SERVING]),
            QueueToken.service_date >= func.current_date() - 1,  # narrowed to the branch's "today" below
        )
    ).all()
    out = []
    for t in mine:
        branch = db.get(Branch, t.branch_id)
        if t.service_date != _today(branch):
            continue
        day_tokens = list(db.scalars(select(QueueToken).where(QueueToken.branch_id == branch.id, QueueToken.service_date == t.service_date)))
        ahead = sum(1 for o in day_tokens if o.status == TokenStatus.WAITING and o.number < t.number)
        serving = next((o for o in day_tokens if o.status == TokenStatus.SERVING), None)
        per = _avg_consult_minutes(day_tokens)
        out.append(
            MyTokenOut(
                label=t.label, status=t.status, clinic_name=db.get(Clinic, branch.clinic_id).name, branch_name=branch.name,
                ahead=ahead, est_wait_minutes=0 if t.status == TokenStatus.SERVING else (ahead + (1 if serving else 0)) * per,
                now_serving=serving.label if serving else None,
            )
        )
    return out
