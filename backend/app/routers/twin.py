"""Practice console: the patient's digital twin — measurements, targets, check-ins and flags.

Milestones A1–A4 of docs/digital-twin/A-knee-twin.md.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser, require_clinic_member
from app.models.clinic import Clinic, ClinicMember, MembershipRole
from app.models.clinical import Consultation
from app.models.patient import ClinicPatient
from app.models.twin import (
    ACTIVE_FLAG_STATUSES,
    CarePlanTarget,
    FlagStatus,
    Measurement,
    MeasurementSource,
    PlanSuggestion,
    Side,
    SuggestionStatus,
    TwinFlag,
    ValidationPair,
)
from app.schemas.twin import (
    CameraMeasurementIn,
    CameraMeasurementOut,
    FlagCloseIn,
    FlagDismissIn,
    FlagOut,
    MeasurementIn,
    MeasurementOut,
    MeasurementUpdate,
    SuggestionApproveIn,
    SuggestionOut,
    SuggestionRejectIn,
    TargetIn,
    TargetOut,
    TwinOut,
    ValidationOut,
)
from app.services import audit
from app.services.camera import CAMERA_METHOD, is_camera, validation_out
from app.services.clinical import care_plan_or_404, clinic_patient_or_404, targets_out
from app.services.twin import check, flag_out, is_plausible, last_trusted, measured_at_or_now, measurement_out, twin_out, user_names
from app.services.suggestions import InvalidChange, StaleSuggestion, approve, expire_for_flag, reject, suggestion_out
from app.services.twin_rules import SEVERITY_ORDER, active_plan_for, evaluate_plan

router = APIRouter(prefix="/clinic", tags=["twin"])

def _pilot(dep):
    """Recovery-twin endpoints only work for clinics in the pilot (Super Admin → Records → Clinics)."""

    def dependency(member: Annotated[ClinicMember, Depends(dep)], db: DB) -> ClinicMember:
        if not db.get(Clinic, member.clinic_id).twin_pilot:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Recovery tracking isn't switched on for this clinic")
        return member

    return dependency


Member = Annotated[ClinicMember, Depends(_pilot(require_clinic_member()))]
Clinician = Annotated[ClinicMember, Depends(_pilot(require_clinic_member(MembershipRole.OWNER, MembershipRole.PHYSIO)))]


def _measurement_or_404(db: Session, clinic_id: uuid.UUID, measurement_id: uuid.UUID) -> Measurement:
    m = db.get(Measurement, measurement_id)
    if m is None or db.get(ClinicPatient, m.clinic_patient_id).clinic_id != clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Measurement not found")
    return m


@router.get("/patients/{cp_id}/twin", response_model=TwinOut)
def get_twin(cp_id: uuid.UUID, member: Member, db: DB) -> TwinOut:
    cp = clinic_patient_or_404(db, member.clinic_id, cp_id)
    return twin_out(db, cp, active_plan_for(db, cp.id))


@router.post("/patients/{cp_id}/measurements", response_model=list[MeasurementOut], status_code=status.HTTP_201_CREATED)
def record_measurements(
    cp_id: uuid.UUID,
    items: Annotated[list[MeasurementIn], Body(min_length=1, max_length=20)],
    member: Clinician,
    user: CurrentUser,
    db: DB,
    request: Request,
) -> list[MeasurementOut]:
    """Record clinic readings (goniometer, tape, pain). A big jump from the last reading is saved but held for confirmation."""
    cp = clinic_patient_or_404(db, member.clinic_id, cp_id)
    plan = active_plan_for(db, cp.id)
    consult_ids = {i.consultation_id for i in items if i.consultation_id}
    if consult_ids:
        found = set(db.scalars(select(Consultation.id).where(Consultation.id.in_(consult_ids), Consultation.clinic_patient_id == cp.id)))
        if consult_ids - found:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Consultation doesn't belong to this patient")

    created = []
    for item in items:
        spec = check(item.code, item.side, item.value)
        at = measured_at_or_now(item.measured_at)
        prev = last_trusted(db, cp.id, item.code, item.side, at)
        m = Measurement(
            patient_id=cp.patient_id, clinic_patient_id=cp.id, care_plan_id=plan.id if plan else None,
            code=item.code, side=item.side, value=item.value, unit=spec.unit, source=MeasurementSource.CLINIC,
            method=item.method, measured_at=at, recorded_by=user.id, consultation_id=item.consultation_id, note=item.note,
            trusted=is_plausible(spec, item.value, float(prev.value) if prev else None),
        )
        db.add(m)
        created.append(m)
    db.flush()
    audit.record(db, action="create", entity="measurements", entity_id=cp.id, actor_user_id=user.id, clinic_id=member.clinic_id,
                 summary=", ".join(f"{m.code} {m.side.value} {m.value}" for m in created)[:200], request=request)
    evaluate_plan(db, plan)
    db.commit()
    names = user_names(db, created)
    return [measurement_out(m, names) for m in created]


@router.patch("/measurements/{measurement_id}", response_model=MeasurementOut)
def confirm_measurement(measurement_id: uuid.UUID, body: MeasurementUpdate, member: Clinician, user: CurrentUser, db: DB, request: Request) -> MeasurementOut:
    m = _measurement_or_404(db, member.clinic_id, measurement_id)
    if is_camera(m):
        raise HTTPException(status.HTTP_409_CONFLICT, "Camera readings can't be used clinically until camera accuracy has been validated")
    m.trusted = body.trusted
    audit.record(db, action="confirm", entity="measurement", entity_id=m.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.flush()
    evaluate_plan(db, active_plan_for(db, m.clinic_patient_id))
    db.commit()
    return measurement_out(m, user_names(db, [m]))


@router.delete("/measurements/{measurement_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard_measurement(measurement_id: uuid.UUID, member: Clinician, user: CurrentUser, db: DB, request: Request) -> None:
    m = _measurement_or_404(db, member.clinic_id, measurement_id)
    audit.record(db, action="delete", entity="measurement", entity_id=m.id, actor_user_id=user.id, clinic_id=member.clinic_id,
                 summary=f"{m.code} {m.side.value} {m.value}", request=request)
    cp_id = m.clinic_patient_id
    db.delete(m)
    db.flush()
    evaluate_plan(db, active_plan_for(db, cp_id))
    db.commit()


@router.put("/care-plans/{plan_id}/targets", response_model=list[TargetOut])
def set_targets(
    plan_id: uuid.UUID,
    items: Annotated[list[TargetIn], Body(max_length=20)],
    member: Clinician,
    user: CurrentUser,
    db: DB,
    request: Request,
) -> list[TargetOut]:
    """Replace the plan's targets."""
    plan = care_plan_or_404(db, member.clinic_id, plan_id)
    if len({(i.code, i.side) for i in items}) != len(items):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each measure and side can have only one target")
    for item in items:
        check(item.code, item.side, item.target_value)
    db.execute(delete(CarePlanTarget).where(CarePlanTarget.care_plan_id == plan.id))
    for item in items:
        db.add(CarePlanTarget(care_plan_id=plan.id, **item.model_dump()))
    audit.record(db, action="update", entity="care_plan_targets", entity_id=plan.id, actor_user_id=user.id, clinic_id=member.clinic_id,
                 summary=", ".join(f"{i.code} {i.side.value} {i.target_value:g}" for i in items)[:200], request=request)
    db.flush()
    evaluate_plan(db, plan)
    db.commit()
    return targets_out(db, plan.id)


# ── Flags ───────────────────────────────────────────────────────────────────


def _flag_or_404(db: Session, clinic_id: uuid.UUID, flag_id: uuid.UUID) -> TwinFlag:
    f = db.get(TwinFlag, flag_id)
    if f is None or db.get(ClinicPatient, f.clinic_patient_id).clinic_id != clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flag not found")
    return f


@router.get("/flags", response_model=list[FlagOut])
def list_flags(member: Member, db: DB, state: Annotated[Literal["active", "closed"], Query()] = "active") -> list[FlagOut]:
    """The clinic's flags inbox: active flags (unseen and most severe first), or the 100 most recently closed."""
    stmt = select(TwinFlag).join(ClinicPatient, ClinicPatient.id == TwinFlag.clinic_patient_id).where(ClinicPatient.clinic_id == member.clinic_id)
    if state == "active":
        rows = list(db.scalars(stmt.where(TwinFlag.status.in_(ACTIVE_FLAG_STATUSES))))
        rows.sort(key=lambda f: (f.status != FlagStatus.OPEN, -SEVERITY_ORDER[f.severity.value], -f.last_seen_at.timestamp()))
    else:
        rows = list(db.scalars(stmt.where(TwinFlag.status.not_in(ACTIVE_FLAG_STATUSES)).order_by(TwinFlag.resolved_at.desc()).limit(100)))
    return [flag_out(db, f) for f in rows]


def _close(db: Session, f: TwinFlag, new: FlagStatus, note: str | None, member: ClinicMember, user_id: uuid.UUID, request: Request) -> FlagOut:
    if f.status not in ACTIVE_FLAG_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "This flag is already closed")
    f.status, f.resolved_at, f.resolved_by, f.resolution_note, f.cleared = new, datetime.now(UTC), user_id, note, False
    expire_for_flag(db, f.id)
    audit.record(db, action=new.value, entity="twin_flag", entity_id=f.id, actor_user_id=user_id, clinic_id=member.clinic_id,
                 summary=f"{f.rule}: {note or '-'}"[:200], request=request)
    db.commit()
    return flag_out(db, f)


@router.post("/flags/{flag_id}/acknowledge", response_model=FlagOut)
def acknowledge_flag(flag_id: uuid.UUID, member: Clinician, db: DB) -> FlagOut:
    """Seen, still active: it stays on the patient until it resolves."""
    f = _flag_or_404(db, member.clinic_id, flag_id)
    if f.status == FlagStatus.OPEN:
        f.status = FlagStatus.ACKNOWLEDGED
        db.commit()
    return flag_out(db, f)


@router.post("/flags/{flag_id}/resolve", response_model=FlagOut)
def resolve_flag(flag_id: uuid.UUID, body: FlagCloseIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> FlagOut:
    """Handled, e.g. called the patient. It won't re-open for the same episode."""
    return _close(db, _flag_or_404(db, member.clinic_id, flag_id), FlagStatus.RESOLVED, body.note, member, user.id, request)


@router.post("/flags/{flag_id}/dismiss", response_model=FlagOut)
def dismiss_flag(flag_id: uuid.UUID, body: FlagDismissIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> FlagOut:
    """Not a concern: needs a one-line reason. It won't re-open for the same episode."""
    return _close(db, _flag_or_404(db, member.clinic_id, flag_id), FlagStatus.DISMISSED, body.note, member, user.id, request)


# ── Plan suggestions ────────────────────────────────────────────────────────


def _suggestion_or_404(db: Session, clinic_id: uuid.UUID, suggestion_id: uuid.UUID) -> PlanSuggestion:
    s = db.get(PlanSuggestion, suggestion_id)
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Suggestion not found")
    care_plan_or_404(db, clinic_id, s.care_plan_id)
    if s.status != SuggestionStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This suggestion was already {s.status.value}")
    return s


@router.post("/suggestions/{suggestion_id}/approve", response_model=SuggestionOut)
def approve_suggestion(suggestion_id: uuid.UUID, body: SuggestionApproveIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> SuggestionOut:
    """Apply the suggested change, or the physio's edited version. Closes the flag and tells the patient."""
    s = _suggestion_or_404(db, member.clinic_id, suggestion_id)
    edited = [c.model_dump(mode="json") for c in body.changes] if body.changes is not None else None
    try:
        approve(db, s, user.id, edited, body.note)
    except StaleSuggestion as e:
        db.commit()  # keep it marked expired
        raise HTTPException(status.HTTP_409_CONFLICT, f"{e}. Review the plan and try again.")
    except InvalidChange as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e))
    audit.record(db, action="approve", entity="plan_suggestion", entity_id=s.id, actor_user_id=user.id, clinic_id=member.clinic_id,
                 summary=s.title + (" (edited)" if edited is not None else ""), changes={"applied": edited or s.changes}, request=request)
    db.commit()
    return suggestion_out(db, s)


@router.post("/suggestions/{suggestion_id}/reject", response_model=SuggestionOut)
def reject_suggestion(suggestion_id: uuid.UUID, body: SuggestionRejectIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> SuggestionOut:
    """Decline the change. The flag stays open for the physio to handle."""
    s = _suggestion_or_404(db, member.clinic_id, suggestion_id)
    reject(s, user.id, body.note)
    audit.record(db, action="reject", entity="plan_suggestion", entity_id=s.id, actor_user_id=user.id, clinic_id=member.clinic_id,
                 summary=f"{s.title}: {body.note or '-'}"[:200], request=request)
    db.commit()
    return suggestion_out(db, s)


# ── Camera validation (design B1) ───────────────────────────────────────────


@router.post("/patients/{cp_id}/camera-measurements", response_model=CameraMeasurementOut, status_code=status.HTTP_201_CREATED)
def record_camera_measurement(cp_id: uuid.UUID, body: CameraMeasurementIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> CameraMeasurementOut:
    """Save a camera angle and the goniometer reading taken with it. Only the numbers arrive here; no video."""
    cp = clinic_patient_or_404(db, member.clinic_id, cp_id)
    side = Side(body.side)
    spec = check(body.code, side, body.goniometer_value)
    check(body.code, side, body.camera_value)
    plan = active_plan_for(db, cp.id)
    now = datetime.now(UTC)
    common = dict(patient_id=cp.patient_id, clinic_patient_id=cp.id, care_plan_id=plan.id if plan else None, code=body.code, side=side,
                  unit=spec.unit, measured_at=now, recorded_by=user.id)
    camera = Measurement(**common, value=body.camera_value, source=MeasurementSource.CAMERA, method=CAMERA_METHOD, trusted=False,
                         confidence=body.confidence, note=f"Camera estimate ({body.posture}) — not validated")
    prev = last_trusted(db, cp.id, body.code, side, now)
    gonio = Measurement(**common, value=body.goniometer_value, source=MeasurementSource.CLINIC, method="goniometer",
                        trusted=is_plausible(spec, body.goniometer_value, float(prev.value) if prev else None), note=body.note)
    db.add_all([camera, gonio])
    db.flush()
    db.add(ValidationPair(
        clinic_patient_id=cp.id, camera_measurement_id=camera.id, reference_measurement_id=gonio.id, code=body.code, side=side,
        posture=body.posture, camera_value=body.camera_value, camera_value_3d=body.camera_value_3d, reference_value=body.goniometer_value,
        confidence=body.confidence, frames=body.frames, spread=body.spread, fps=body.fps, model=body.model,
        device=(request.headers.get("user-agent") or "")[:200] or None, lighting=body.lighting, clothing=body.clothing, note=body.note,
        recorded_by=user.id,
    ))
    audit.record(db, action="create", entity="camera_measurement", entity_id=cp.id, actor_user_id=user.id, clinic_id=member.clinic_id,
                 summary=f"{body.code} {body.side} camera {body.camera_value:g} vs goniometer {body.goniometer_value:g} (patient consented)", request=request)
    evaluate_plan(db, plan)
    db.commit()
    names = user_names(db, [camera, gonio])
    return CameraMeasurementOut(camera=measurement_out(camera, names), goniometer=measurement_out(gonio, names),
                                difference=round(body.camera_value - body.goniometer_value, 1))


@router.get("/validation", response_model=ValidationOut)
def clinic_validation(member: Member, db: DB) -> ValidationOut:
    """This clinic's camera-vs-goniometer pairs and agreement."""
    pairs = list(db.scalars(
        select(ValidationPair).join(ClinicPatient, ClinicPatient.id == ValidationPair.clinic_patient_id)
        .where(ClinicPatient.clinic_id == member.clinic_id).order_by(ValidationPair.created_at.desc())
    ))
    return validation_out(db, pairs, with_names=True)
