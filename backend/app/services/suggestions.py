"""Plan suggestions: the "physio decides" half of the loop (milestone A4 of docs/digital-twin/A-knee-twin.md).

When a flag opens, a rule may propose a concrete change to the plan's exercises. Nothing changes until a physio
approves it (as proposed or edited). Guardrails:

- rule-authored suggestions can only hold or reduce: fewer sets/reps/seconds, or pausing an exercise; never an increase;
- each change records the value it expects (`before`); if the plan changed since, the suggestion is expired, not applied;
- approving closes the flag, writes the audit log and notifies the patient.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.models.clinical import CarePlan, CarePlanExercise, CarePlanStatus, ExerciseLog, Feel
from app.models.exercise import Exercise
from app.models.twin import ACTIVE_FLAG_STATUSES, FlagStatus, PlanSuggestion, SuggestionAuthor, SuggestionStatus, TwinFlag
from app.models.user import User
from app.schemas.twin import PlanChangeOut, SuggestionOut
from app.services.clinical import notify_plan_update

PAINFUL_LOG_PAIN = 6  # an exercise log with pain at or above this counts as painful
LOOKBACK_DAYS = 7
LIMITS = {"sets": (1, 20), "reps": (1, 200), "hold_seconds": (1, 600)}
UNIT = {"sets": "sets", "reps": "reps", "hold_seconds": "s hold"}


class StaleSuggestion(Exception):
    """The plan changed since the suggestion was made."""


class InvalidChange(ValueError):
    pass


def _plan_exercises(db: Session, plan_id: uuid.UUID) -> dict[uuid.UUID, tuple[CarePlanExercise, str]]:
    rows = db.execute(
        select(CarePlanExercise, Exercise.name).join(Exercise, Exercise.id == CarePlanExercise.exercise_id)
        .where(CarePlanExercise.care_plan_id == plan_id).order_by(CarePlanExercise.position)
    ).all()
    return {pe.id: (pe, name) for pe, name in rows}


def is_reduction(field: str, before, after) -> bool:
    if field == "is_active":
        return after is False or after == before
    return before is not None and after <= before


def check_changes(db: Session, plan_id: uuid.UUID, changes: list[dict], author: SuggestionAuthor) -> list[tuple[CarePlanExercise, dict]]:
    """Validate changes against the plan as it is now. Raises StaleSuggestion or InvalidChange."""
    pes = _plan_exercises(db, plan_id)
    seen, out = set(), []
    for c in changes:
        pe_id, field, before, after = uuid.UUID(str(c["plan_exercise_id"])), c["field"], c.get("before"), c["after"]
        if (pe_id, field) in seen:
            raise InvalidChange("Each exercise field can change only once")
        seen.add((pe_id, field))
        if pe_id not in pes:
            raise StaleSuggestion("An exercise is no longer in the plan")
        pe = pes[pe_id][0]
        if getattr(pe, field) != before or (field != "is_active" and not pe.is_active):
            raise StaleSuggestion("The plan changed since this was suggested")
        if field == "is_active":
            if not isinstance(after, bool):
                raise InvalidChange("is_active must be true or false")
        else:
            if isinstance(after, bool) or not isinstance(after, int):
                raise InvalidChange(f"{field} must be a whole number")
            if before is None:
                raise InvalidChange(f"This exercise isn't dosed in {UNIT[field]}")
            lo, hi = LIMITS[field]
            if not lo <= after <= hi:
                raise InvalidChange(f"{field} must be between {lo} and {hi}")
        if author == SuggestionAuthor.RULES and not is_reduction(field, before, after):
            raise InvalidChange("Automatic suggestions can only hold or reduce the plan")
        out.append((pe, c))
    if not out:
        raise InvalidChange("Nothing to change")
    return out


def describe(change: dict, name: str) -> str:
    if change["field"] == "is_active":
        return f"{name}: {'paused' if change['after'] is False else 'resumed'}"
    return f"{name}: {change['before']} → {change['after']} {UNIT[change['field']]}"


# ── Proposing ───────────────────────────────────────────────────────────────


def _reduce_painful(db: Session, plan: CarePlan, flag: TwinFlag, today: date) -> tuple[str, str, list[dict]] | None:
    pes = {k: v for k, v in _plan_exercises(db, plan.id).items() if v[0].is_active}
    if not pes:
        return None
    painful = set(db.scalars(
        select(ExerciseLog.plan_exercise_id).where(
            ExerciseLog.plan_exercise_id.in_(pes), ExerciseLog.logged_on >= today - timedelta(days=LOOKBACK_DAYS),
            or_(ExerciseLog.feel == Feel.HARD, ExerciseLog.pain >= PAINFUL_LOG_PAIN),
        ).distinct()
    ))
    changes = [{"plan_exercise_id": str(pe.id), "field": "sets", "before": pe.sets, "after": pe.sets - 1}
               for pe_id, (pe, _) in pes.items() if pe_id in painful and pe.sets > 1]
    if not changes:
        return None
    names = ", ".join(pes[uuid.UUID(c["plan_exercise_id"])][1] for c in changes)
    n = len(changes)
    return (f"Reduce sets on {n} exercise{'s' if n > 1 else ''}",
            f"{flag.summary}. {names} {'were' if n > 1 else 'was'} logged as hard or painful in the last {LOOKBACK_DAYS} days. "
            "Suggest one set fewer until you review.", changes)


def _pause_all(db: Session, plan: CarePlan, flag: TwinFlag, today: date) -> tuple[str, str, list[dict]] | None:
    changes = [{"plan_exercise_id": str(pe.id), "field": "is_active", "before": True, "after": False}
               for pe, _ in _plan_exercises(db, plan.id).values() if pe.is_active]
    if not changes:
        return None
    return ("Pause home exercises until reviewed",
            f"Red flag: {flag.summary}. Pausing the home program until you've spoken to the patient is the cautious option. "
            "Paused exercises can be restored from Prescribe exercises.", changes)


PROPOSERS = {"pain_rising": _reduce_painful, "pain_high": _reduce_painful, "red_flag": _pause_all}


def propose(db: Session, plan: CarePlan, flag: TwinFlag, today: date) -> PlanSuggestion | None:
    """Rule-authored suggestion for a newly opened (or re-opened) flag, at most one per flag episode."""
    proposer = PROPOSERS.get(flag.rule.split(":", 1)[0])
    if proposer is None:
        return None
    already = db.scalar(select(PlanSuggestion.id).where(PlanSuggestion.flag_id == flag.id, PlanSuggestion.created_at >= flag.opened_at).limit(1))
    if already is not None:
        return None
    made = proposer(db, plan, flag, today)
    if made is None:
        return None
    title, rationale, changes = made
    check_changes(db, plan.id, changes, SuggestionAuthor.RULES)  # rules can't propose an increase
    # created_at set here (not by the database) so it's comparable with flag.opened_at, which is also set in Python.
    s = PlanSuggestion(care_plan_id=plan.id, flag_id=flag.id, author=SuggestionAuthor.RULES, title=title, rationale=rationale,
                       changes=changes, created_at=datetime.now(UTC))
    db.add(s)
    return s


def expire_for_flag(db: Session, flag_id: uuid.UUID) -> None:
    db.execute(update(PlanSuggestion).where(PlanSuggestion.flag_id == flag_id, PlanSuggestion.status == SuggestionStatus.PENDING)
               .values(status=SuggestionStatus.EXPIRED, decided_at=datetime.now(UTC), decision_note="Flag closed"))


def expire_for_ended_plans(db: Session) -> int:
    return db.execute(
        update(PlanSuggestion)
        .where(PlanSuggestion.status == SuggestionStatus.PENDING,
               PlanSuggestion.care_plan_id.in_(select(CarePlan.id).where(CarePlan.status != CarePlanStatus.ACTIVE)))
        .values(status=SuggestionStatus.EXPIRED, decided_at=datetime.now(UTC), decision_note="Care plan ended")
    ).rowcount


# ── Deciding ────────────────────────────────────────────────────────────────


def approve(db: Session, s: PlanSuggestion, user_id: uuid.UUID, edited: list[dict] | None, note: str | None) -> None:
    """Apply the suggestion (or the physio's edited version). Raises StaleSuggestion (after marking it expired) or InvalidChange."""
    changes = edited if edited is not None else s.changes
    author = SuggestionAuthor.PHYSIO if edited is not None else s.author
    try:
        pairs = check_changes(db, s.care_plan_id, changes, author)
    except StaleSuggestion:
        s.status, s.decided_at, s.decision_note = SuggestionStatus.EXPIRED, datetime.now(UTC), "Plan changed before approval"
        raise
    names = {pe.id: name for pe, name in _plan_exercises(db, s.care_plan_id).values()}
    for pe, c in pairs:
        setattr(pe, c["field"], c["after"])
    now = datetime.now(UTC)
    s.status, s.decided_by, s.decided_at, s.decision_note = SuggestionStatus.APPROVED, user_id, now, note
    s.applied_changes = changes if edited is not None else None
    if s.flag_id:
        flag = db.get(TwinFlag, s.flag_id)
        if flag and flag.status in ACTIVE_FLAG_STATUSES:
            flag.status, flag.resolved_at, flag.resolved_by, flag.cleared = FlagStatus.RESOLVED, now, user_id, False
            flag.resolution_note = f"Plan change approved: {s.title}"
    plan = db.get(CarePlan, s.care_plan_id)
    summary = "; ".join(describe(c, names[pe.id]) for pe, c in pairs)
    notify_plan_update(db, plan, "Your physio updated your exercise program", body=(f"{summary}. {note}" if note else summary)[:1000])


def reject(s: PlanSuggestion, user_id: uuid.UUID, note: str | None) -> None:
    s.status, s.decided_by, s.decided_at, s.decision_note = SuggestionStatus.REJECTED, user_id, datetime.now(UTC), note


def suggestion_out(db: Session, s: PlanSuggestion) -> SuggestionOut:
    pes = _plan_exercises(db, s.care_plan_id)
    stale = False
    if s.status == SuggestionStatus.PENDING:
        try:
            check_changes(db, s.care_plan_id, s.changes, SuggestionAuthor.PHYSIO)
        except (StaleSuggestion, InvalidChange):
            stale = True
    by = db.get(User, s.decided_by) if s.decided_by else None
    shown = s.applied_changes or s.changes
    return SuggestionOut(
        id=s.id, care_plan_id=s.care_plan_id, flag_id=s.flag_id, author=s.author, title=s.title, rationale=s.rationale,
        changes=[PlanChangeOut(**c, exercise_name=pes.get(uuid.UUID(str(c["plan_exercise_id"])), (None, "Removed exercise"))[1]) for c in shown],
        status=s.status, stale=stale, created_at=s.created_at, decided_at=s.decided_at,
        decided_by_name=by.full_name if by else None, decision_note=s.decision_note,
    )


def pending_for_flag(db: Session, flag_id: uuid.UUID) -> PlanSuggestion | None:
    return db.scalar(select(PlanSuggestion).where(PlanSuggestion.flag_id == flag_id, PlanSuggestion.status == SuggestionStatus.PENDING))
