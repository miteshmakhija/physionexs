"""Exercise adherence, streaks and streak rewards.

A day's adherence = exercise completions logged ÷ completions scheduled that day. A streak counts
consecutive days on which everything scheduled was done; days with nothing scheduled don't break it,
and today only counts once it's complete.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.clinical import CarePlan, CarePlanExercise, CarePlanStatus, ExerciseLog, Frequency
from app.models.engagement import Notification, PointsLedger
from app.models.patient import ClinicPatient, Patient
from app.services.settings import get_setting

STREAK_LOOKBACK_DAYS = 120


def scheduled_times(pe: CarePlanExercise, start: date, day: date) -> int:
    """How many times this exercise is due on `day`."""
    if not pe.is_active or day < start:
        return 0
    delta = (day - start).days
    due = {
        Frequency.DAILY: True,
        Frequency.ALTERNATE_DAYS: delta % 2 == 0,
        Frequency.WEEKLY_3X: day.weekday() in (0, 2, 4),
        Frequency.WEEKLY: day.weekday() == start.weekday(),
    }[pe.frequency]
    return pe.times_per_day if due else 0


@dataclass
class DayStat:
    day: date
    scheduled: int
    done: int

    @property
    def pct(self) -> int | None:
        return None if self.scheduled == 0 else min(100, round(100 * self.done / self.scheduled))


def _plan_exercises(db: Session, patient_id: uuid.UUID, plan_ids: list[uuid.UUID] | None):
    stmt = (
        select(CarePlanExercise, CarePlan.starts_on)
        .join(CarePlan, CarePlan.id == CarePlanExercise.care_plan_id)
        .join(ClinicPatient, ClinicPatient.id == CarePlan.clinic_patient_id)
        .where(ClinicPatient.patient_id == patient_id, CarePlan.status == CarePlanStatus.ACTIVE)
    )
    if plan_ids is not None:
        stmt = stmt.where(CarePlan.id.in_(plan_ids))
    return db.execute(stmt).all()


def day_stats(db: Session, patient_id: uuid.UUID, start: date, end: date, plan_ids: list[uuid.UUID] | None = None) -> list[DayStat]:
    """Per-day scheduled vs done for [start, end], optionally limited to some care plans."""
    exercises = _plan_exercises(db, patient_id, plan_ids)
    ids = [pe.id for pe, _ in exercises]
    done: dict[tuple[uuid.UUID, date], int] = defaultdict(int)
    if ids:
        rows = db.execute(
            select(ExerciseLog.plan_exercise_id, ExerciseLog.logged_on, func.count())
            .where(ExerciseLog.plan_exercise_id.in_(ids), ExerciseLog.logged_on >= start, ExerciseLog.logged_on <= end)
            .group_by(ExerciseLog.plan_exercise_id, ExerciseLog.logged_on)
        ).all()
        for pe_id, day, n in rows:
            done[(pe_id, day)] = n

    stats = []
    day = start
    while day <= end:
        scheduled = completed = 0
        for pe, plan_start in exercises:
            first = max(plan_start, pe.created_at.date())
            n = scheduled_times(pe, first, day)
            scheduled += n
            completed += min(n, done.get((pe.id, day), 0))
        stats.append(DayStat(day, scheduled, completed))
        day += timedelta(days=1)
    return stats


def adherence_pct(stats: list[DayStat]) -> int | None:
    scheduled = sum(s.scheduled for s in stats)
    return None if scheduled == 0 else round(100 * sum(s.done for s in stats) / scheduled)


def current_streak(db: Session, patient_id: uuid.UUID, today: date) -> int:
    stats = day_stats(db, patient_id, today - timedelta(days=STREAK_LOOKBACK_DAYS), today)
    streak = 0
    for s in reversed(stats):
        if s.scheduled == 0:
            continue
        if s.done >= s.scheduled:
            streak += 1
        elif s.day == today:
            continue  # today isn't over yet
        else:
            break
    return streak


def refresh_streak_and_reward(db: Session, patient: Patient, today: date) -> list[int]:
    """Recompute the patient's streak; award any newly reached reward tier. Returns points awarded."""
    streak = current_streak(db, patient.id, today)
    patient.current_streak_days = streak
    patient.best_streak_days = max(patient.best_streak_days, streak)

    awarded = []
    for tier in get_setting(db, "rewards").get("tiers", []):
        days, points = int(tier["days"]), int(tier["points"])
        if streak < days:
            continue
        reason = f"streak_{days}"
        # One award per streak run: skip if this tier was already paid during the current run.
        recent = db.scalar(
            select(PointsLedger.id).where(
                PointsLedger.patient_id == patient.id,
                PointsLedger.reason == reason,
                PointsLedger.created_at >= func.now() - timedelta(days=streak),
            ).limit(1)
        )
        if recent:
            continue
        patient.points_balance += points
        db.add(PointsLedger(patient_id=patient.id, delta=points, reason=reason))
        if patient.user_id:
            db.add(Notification(user_id=patient.user_id, kind="points_earned", title=f"{days}-day streak! +{points} points", body="Redeem your Health Points at checkout on your next booking."))
        awarded.append(points)
    return awarded
