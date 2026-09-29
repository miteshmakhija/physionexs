"""Branch scoping: a team member assigned to one branch sees that branch's data only.

The clinic owner (Doctor-Admin) and team members with no branch ("All branches") see every branch.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, and_, exists, not_, or_, select
from sqlalchemy.orm import Session

from app.models.billing import Invoice
from app.models.clinic import Branch, ClinicMember, MembershipRole
from app.models.patient import ClinicPatient
from app.models.scheduling import Appointment, QueueToken


def branch_scope(member: ClinicMember) -> uuid.UUID | None:
    """The one branch this member is limited to, or None when they see every branch."""
    return None if member.role == MembershipRole.OWNER else member.branch_id


def check_branch(member: ClinicMember, branch_id: uuid.UUID | None) -> None:
    scope = branch_scope(member)
    if scope and branch_id != scope:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")


def effective_branch(member: ClinicMember, branch_id: uuid.UUID | None) -> uuid.UUID | None:
    """The branch a request should cover: the member's own when they are limited to one, else what they asked for."""
    scope = branch_scope(member)
    if scope and branch_id and branch_id != scope:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    return scope or branch_id


def _seen_at(branch: ColumnElement | uuid.UUID | None, clinic_id: uuid.UUID) -> ColumnElement[bool]:
    """The clinic patient has an appointment, walk-in token or invoice at `branch` (any branch of the clinic when None)."""
    appt_branch = Appointment.branch_id == branch if branch else Appointment.clinic_id == clinic_id
    token_branch = QueueToken.branch_id == branch if branch else QueueToken.branch_id.in_(select(Branch.id).where(Branch.clinic_id == clinic_id))
    inv_branch = Invoice.branch_id == branch if branch else Invoice.clinic_id == clinic_id
    return or_(
        exists().where(Appointment.patient_id == ClinicPatient.patient_id, appt_branch),
        exists().where(QueueToken.patient_id == ClinicPatient.patient_id, token_branch),
        exists().where(Invoice.clinic_patient_id == ClinicPatient.id, inv_branch),
    )


def patient_filter(member: ClinicMember) -> ColumnElement[bool] | None:
    """Condition on ClinicPatient for the patients a branch-limited member may see: those seen at their branch, plus
    newly registered ones not yet seen at any branch. None when the member sees every patient."""
    scope = branch_scope(member)
    if not scope:
        return None
    return or_(_seen_at(scope, member.clinic_id), not_(_seen_at(None, member.clinic_id)))


def check_patient(db: Session, member: ClinicMember, cp: ClinicPatient) -> None:
    cond = patient_filter(member)
    if cond is not None and not db.scalar(select(ClinicPatient.id).where(and_(ClinicPatient.id == cp.id, cond))):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
