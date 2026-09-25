"""Exercise library.

- Platform exercises are authored by Physionexs and only prescribable once a Super Admin publishes
  them (after clinical review by our physiotherapist).
- Clinics can add their own exercises; they're usable in that clinic straight away and can be
  submitted for review to join the public library.
"""

import re
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import DB, AdminUser, CurrentUser, require_clinic_member
from app.models.clinic import ClinicMember, MembershipRole
from app.models.exercise import Exercise, ExerciseMedia, ExerciseSource, ExerciseStatus, ExerciseVisibility
from app.schemas.clinical import ExerciseIn, ExerciseOut, ExercisePage, ReviewDecisionIn
from app.services import audit

router = APIRouter(tags=["exercises"])

Member = Annotated[ClinicMember, Depends(require_clinic_member())]
Clinician = Annotated[ClinicMember, Depends(require_clinic_member(MembershipRole.OWNER, MembershipRole.PHYSIO))]
Admin = AdminUser

FIELDS = set(ExerciseIn.model_fields)


def exercise_out(db: Session, e: Exercise) -> ExerciseOut:
    media = db.scalars(select(ExerciseMedia).where(ExerciseMedia.exercise_id == e.id).order_by(ExerciseMedia.position))
    return ExerciseOut(
        id=e.id, slug=e.slug, source=e.source.value, visibility=e.visibility.value, status=e.status, owner_clinic_id=e.owner_clinic_id,
        review_note=e.review_note,
        media=[{"kind": m.kind.value, "url": m.url, "thumbnail_url": m.thumbnail_url, "duration_seconds": m.duration_seconds} for m in media],
        **{f: getattr(e, f) for f in FIELDS},
    )


def unique_slug(db: Session, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:140] or "exercise"
    slug = base
    while db.scalar(select(Exercise.id).where(Exercise.slug == slug)):
        slug = f"{base}-{uuid.uuid4().hex[:5]}"
    return slug


def _search(db: Session, stmt, q: str | None, body_region: str | None, category: str | None, limit: int, offset: int) -> ExercisePage:
    if q:
        tsq = func.websearch_to_tsquery("english", q)
        stmt = stmt.where(or_(Exercise.search_vector.op("@@")(tsq), Exercise.name.ilike(f"%{q}%"), func.array_to_string(Exercise.conditions, " ").ilike(f"%{q}%")))
    if body_region:
        stmt = stmt.where(Exercise.body_region == body_region)
    if category:
        stmt = stmt.where(Exercise.category == category)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Exercise.body_region, Exercise.difficulty, Exercise.name).limit(limit).offset(offset))
    return ExercisePage(items=[exercise_out(db, e) for e in rows], total=total)


# ── Clinic ──────────────────────────────────────────────────────────────────


@router.get("/clinic/exercises", response_model=ExercisePage)
def clinic_library(
    member: Member,
    db: DB,
    q: Annotated[str | None, Query(max_length=80)] = None,
    body_region: str | None = None,
    category: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 40,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ExercisePage:
    """Everything this clinic can prescribe: published public exercises + its own."""
    stmt = select(Exercise).where(
        or_(
            (Exercise.visibility == ExerciseVisibility.PUBLIC) & (Exercise.status == ExerciseStatus.PUBLISHED),
            Exercise.owner_clinic_id == member.clinic_id,
        )
    )
    return _search(db, stmt, q, body_region, category, limit, offset)


@router.get("/clinic/exercises/regions", response_model=list[str])
def regions(member: Member, db: DB) -> list[str]:
    return list(db.scalars(select(Exercise.body_region).where(Exercise.status == ExerciseStatus.PUBLISHED).distinct().order_by(Exercise.body_region)))


@router.post("/clinic/exercises", response_model=ExerciseOut, status_code=status.HTTP_201_CREATED)
def create_clinic_exercise(body: ExerciseIn, member: Clinician, user: CurrentUser, db: DB, request: Request) -> ExerciseOut:
    e = Exercise(
        slug=unique_slug(db, body.name), source=ExerciseSource.CLINIC, owner_clinic_id=member.clinic_id,
        visibility=ExerciseVisibility.CLINIC, status=ExerciseStatus.PUBLISHED, created_by=user.id, **body.model_dump(),
    )
    db.add(e)
    db.flush()
    audit.record(db, action="create", entity="exercise", entity_id=e.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=e.name, request=request)
    db.commit()
    return exercise_out(db, e)


@router.post("/clinic/exercises/{exercise_id}/submit", response_model=ExerciseOut)
def submit_for_review(exercise_id: uuid.UUID, member: Clinician, user: CurrentUser, db: DB) -> ExerciseOut:
    """Offer a clinic exercise to the public library. It stays usable in the clinic meanwhile."""
    e = db.get(Exercise, exercise_id)
    if e is None or e.owner_clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")
    e.status = ExerciseStatus.IN_REVIEW
    e.review_note = None
    db.commit()
    return exercise_out(db, e)


# ── Super Admin ─────────────────────────────────────────────────────────────


@router.get("/admin/exercises", response_model=ExercisePage)
def admin_library(
    admin: Admin,
    db: DB,
    status_: Annotated[ExerciseStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    body_region: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ExercisePage:
    stmt = select(Exercise).where(or_(Exercise.source == ExerciseSource.PLATFORM, Exercise.status == ExerciseStatus.IN_REVIEW))
    if status_:
        stmt = stmt.where(Exercise.status == status_)
    return _search(db, stmt, q, body_region, None, limit, offset)


@router.get("/admin/exercises/{exercise_id}", response_model=ExerciseOut)
def admin_get(exercise_id: uuid.UUID, admin: Admin, db: DB) -> ExerciseOut:
    e = db.get(Exercise, exercise_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")
    return exercise_out(db, e)


@router.post("/admin/exercises", response_model=ExerciseOut, status_code=status.HTTP_201_CREATED)
def admin_create(body: ExerciseIn, admin: Admin, db: DB, request: Request) -> ExerciseOut:
    e = Exercise(slug=unique_slug(db, body.name), source=ExerciseSource.PLATFORM, visibility=ExerciseVisibility.PUBLIC,
                 status=ExerciseStatus.IN_REVIEW, created_by=admin.id, **body.model_dump())
    db.add(e)
    db.flush()
    audit.record(db, action="create", entity="exercise", entity_id=e.id, actor_user_id=admin.id, summary=e.name, request=request)
    db.commit()
    return exercise_out(db, e)


@router.put("/admin/exercises/{exercise_id}", response_model=ExerciseOut)
def admin_update(exercise_id: uuid.UUID, body: ExerciseIn, admin: Admin, db: DB, request: Request) -> ExerciseOut:
    e = db.get(Exercise, exercise_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    if e.status == ExerciseStatus.PUBLISHED and e.source == ExerciseSource.PLATFORM:
        e.status = ExerciseStatus.IN_REVIEW  # clinical edits need a fresh review
    audit.record(db, action="update", entity="exercise", entity_id=e.id, actor_user_id=admin.id, summary=e.name, request=request)
    db.commit()
    return exercise_out(db, e)


@router.post("/admin/exercises/{exercise_id}/publish", response_model=ExerciseOut)
def admin_publish(exercise_id: uuid.UUID, body: ReviewDecisionIn, admin: Admin, db: DB, request: Request) -> ExerciseOut:
    e = db.get(Exercise, exercise_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")
    e.status = ExerciseStatus.PUBLISHED
    e.visibility = ExerciseVisibility.PUBLIC
    e.reviewed_by = admin.id
    e.reviewed_at = datetime.now(UTC)
    e.review_note = body.note
    audit.record(db, action="approve", entity="exercise", entity_id=e.id, actor_user_id=admin.id, summary=e.name, request=request)
    db.commit()
    return exercise_out(db, e)


@router.post("/admin/exercises/{exercise_id}/reject", response_model=ExerciseOut)
def admin_reject(exercise_id: uuid.UUID, body: ReviewDecisionIn, admin: Admin, db: DB, request: Request) -> ExerciseOut:
    e = db.get(Exercise, exercise_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")
    if not body.note:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add a note explaining what to change")
    # A rejected clinic submission goes back to being clinic-only (still usable there).
    e.status = ExerciseStatus.PUBLISHED if e.source == ExerciseSource.CLINIC else ExerciseStatus.REJECTED
    e.review_note = body.note
    e.reviewed_by = admin.id
    e.reviewed_at = datetime.now(UTC)
    audit.record(db, action="reject", entity="exercise", entity_id=e.id, actor_user_id=admin.id, summary=body.note, request=request)
    db.commit()
    return exercise_out(db, e)
