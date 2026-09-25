from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.exercise import Exercise, ExerciseSource, ExerciseStatus, ExerciseVisibility
from app.routers.exercises import unique_slug
from app.seed.exercises import EXERCISES

DRAFT_NOTE = "Starter draft — needs clinical review before publishing."


def seed_exercises(db: Session, publish: bool = False) -> int:
    """Insert starter exercises that don't exist yet (matched by name). Returns how many were added."""
    existing = set(db.scalars(select(Exercise.name).where(Exercise.source == ExerciseSource.PLATFORM)))
    added = 0
    for draft in EXERCISES:
        if draft.name in existing:
            continue
        db.add(
            Exercise(
                slug=unique_slug(db, draft.name),
                source=ExerciseSource.PLATFORM,
                visibility=ExerciseVisibility.PUBLIC,
                status=ExerciseStatus.PUBLISHED if publish else ExerciseStatus.IN_REVIEW,
                review_note=None if publish else DRAFT_NOTE,
                **asdict(draft),
            )
        )
        added += 1
    db.commit()
    return added
