import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.clinic import PhysioProfile
from app.models.engagement import Review

REVIEW_TAGS = ["Very caring", "Explained clearly", "On time", "Clean clinic", "Effective treatment", "Good follow-up"]


def recompute_rating(db: Session, physio_user_id: uuid.UUID) -> None:
    """Refresh the physio's cached rating from visible reviews."""
    avg, count = db.execute(
        select(func.avg(Review.rating), func.count()).where(Review.physio_user_id == physio_user_id, Review.is_hidden.is_(False))
    ).one()
    profile = db.scalar(select(PhysioProfile).where(PhysioProfile.user_id == physio_user_id))
    if profile:
        profile.rating_avg = Decimal(str(round(float(avg), 2))) if avg is not None else Decimal("0")
        profile.reviews_count = count or 0
