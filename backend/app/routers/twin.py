"""Practice console: the patient's digital twin — structured measurements and care-plan targets.

Milestone A1 of docs/digital-twin/A-knee-twin.md. Check-ins, rules and suggestions come in later milestones.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser, require_clinic_member
from app.models.clinic import ClinicMember, MembershipRole
from app.models.clinical import CarePlan, CarePlanStatus, Consultation
from app.models.patient import ClinicPatient
from app.models.twin import CarePlanTarget, Measurement, MeasurementSource
from app.schemas.twin import MeasurementIn, MeasurementOut, MeasurementUpdate, TargetIn, TargetOut, TwinOut
from app.services import audit
from app.services.clinical import care_plan_or_404, clinic_patient_or_404
from app.services.twin import check, is_plausible, last_trusted, measured_at_or_now, measurement_out, targets_out, twin_out, user_names

router = APIRouter(prefix="/clinic", tags=["twin"])

Member = Annotated[ClinicMember, Depends(require_clinic_member())]
Clinician = Annotated[ClinicMember, Depends(require_clinic_member(MembershipRole.OWNER, MembershipRole.PHYSIO))]


def _active_plan(db: Session, cp_id: uuid.UUID) -> CarePlan | None:
    return db.scalar(select(CarePlan).where(CarePlan.clinic_patient_id == cp_id, CarePlan.status == CarePlanStatus.ACTIVE).order_by(CarePlan.created_at.desc()).limit(1))


def _measurement_or_404(db: Session, clinic_id: uuid.UUID, measurement_id: uuid.UUID) -> Measurement:
    m = db.get(Measurement, measurement_id)
    if m is None or db.get(ClinicPatient, m.clinic_patient_id).clinic_id != clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Measurement not found")
    return m


@router.get("/patients/{cp_id}/twin", response_model=TwinOut)
def get_twin(cp_id: uuid.UUID, member: Member, db: DB) -> TwinOut:
    cp = clinic_patient_or_404(db, member.clinic_id, cp_id)
    return twin_out(db, cp, _active_plan(db, cp.id))


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
    plan = _active_plan(db, cp.id)
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
    db.commit()
    names = user_names(db, created)
    return [measurement_out(m, names) for m in created]


@router.patch("/measurements/{measurement_id}", response_model=MeasurementOut)
def confirm_measurement(measurement_id: uuid.UUID, body: MeasurementUpdate, member: Clinician, user: CurrentUser, db: DB, request: Request) -> MeasurementOut:
    m = _measurement_or_404(db, member.clinic_id, measurement_id)
    m.trusted = body.trusted
    audit.record(db, action="confirm", entity="measurement", entity_id=m.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return measurement_out(m, user_names(db, [m]))


@router.delete("/measurements/{measurement_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard_measurement(measurement_id: uuid.UUID, member: Clinician, user: CurrentUser, db: DB, request: Request) -> None:
    m = _measurement_or_404(db, member.clinic_id, measurement_id)
    audit.record(db, action="delete", entity="measurement", entity_id=m.id, actor_user_id=user.id, clinic_id=member.clinic_id,
                 summary=f"{m.code} {m.side.value} {m.value}", request=request)
    db.delete(m)
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
    db.commit()
    return targets_out(db, plan.id)
