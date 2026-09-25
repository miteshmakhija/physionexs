import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Computed, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models._types import str_enum


class ExerciseCategory(StrEnum):
    STRENGTH = "strength"
    MOBILITY = "mobility"  # range of motion
    STRETCH = "stretch"
    BALANCE = "balance"
    PROPRIOCEPTION = "proprioception"
    ENDURANCE = "endurance"
    BREATHING = "breathing"
    FUNCTIONAL = "functional"


class ExercisePosition(StrEnum):
    STANDING = "standing"
    SITTING = "sitting"
    SUPINE = "supine"
    PRONE = "prone"
    SIDE_LYING = "side_lying"
    QUADRUPED = "quadruped"
    KNEELING = "kneeling"


class DoseUnit(StrEnum):
    REPS = "reps"
    SECONDS = "seconds"


class ExerciseSource(StrEnum):
    PLATFORM = "platform"  # Physionexs core library, reviewed by our physio team
    CLINIC = "clinic"  # uploaded by a clinic


class ExerciseVisibility(StrEnum):
    PUBLIC = "public"  # every clinic can prescribe it
    CLINIC = "clinic"  # only owner_clinic_id


class ExerciseStatus(StrEnum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    PUBLISHED = "published"
    REJECTED = "rejected"


class Exercise(UUIDPk, Timestamps, Base):
    __tablename__ = "exercises"
    __table_args__ = (Index("ix_exercises_search", "search_vector", postgresql_using="gin"),)

    slug: Mapped[str] = mapped_column(String(160), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    body_region: Mapped[str] = mapped_column(String(40), index=True)  # knee, shoulder, lumbar, cervical, ankle, hip …
    category: Mapped[ExerciseCategory] = mapped_column(str_enum(ExerciseCategory))
    position: Mapped[ExercisePosition | None] = mapped_column(str_enum(ExercisePosition))
    equipment: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    difficulty: Mapped[int] = mapped_column(SmallInteger, default=1)  # 1–5

    dose_unit: Mapped[DoseUnit] = mapped_column(str_enum(DoseUnit), default=DoseUnit.REPS)
    default_sets: Mapped[int] = mapped_column(SmallInteger, default=3)
    default_reps: Mapped[int | None] = mapped_column(SmallInteger)
    default_hold_seconds: Mapped[int | None] = mapped_column(SmallInteger)
    default_rest_seconds: Mapped[int] = mapped_column(SmallInteger, default=30)

    steps: Mapped[list[str]] = mapped_column(JSONB, default=list)
    cues: Mapped[str | None] = mapped_column(Text)
    common_mistakes: Mapped[str | None] = mapped_column(Text)
    precautions: Mapped[str | None] = mapped_column(Text)
    contraindications: Mapped[str | None] = mapped_column(Text)
    conditions: Mapped[list[str]] = mapped_column(ARRAY(String(80)), default=list)  # suggested for …

    source: Mapped[ExerciseSource] = mapped_column(str_enum(ExerciseSource), default=ExerciseSource.PLATFORM)
    owner_clinic_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    visibility: Mapped[ExerciseVisibility] = mapped_column(str_enum(ExerciseVisibility), default=ExerciseVisibility.PUBLIC)
    status: Mapped[ExerciseStatus] = mapped_column(str_enum(ExerciseStatus), default=ExerciseStatus.DRAFT, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)

    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('english', coalesce(name, '') || ' ' || coalesce(body_region, '') || ' ' "
            "|| coalesce(category, '') || ' ' || coalesce(cues, ''))",
            persisted=True,
        ),
    )


class MediaKind(StrEnum):
    VIDEO = "video"
    IMAGE = "image"


class ExerciseMedia(UUIDPk, Timestamps, Base):
    __tablename__ = "exercise_media"

    exercise_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("exercises.id", ondelete="CASCADE"), index=True)
    kind: Mapped[MediaKind] = mapped_column(str_enum(MediaKind))
    provider: Mapped[str] = mapped_column(String(30))  # cloudflare_stream | blob
    provider_asset_id: Mapped[str | None] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(500))
    thumbnail_url: Mapped[str | None] = mapped_column(String(500))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(SmallInteger, default=0)


class ExerciseTranslation(UUIDPk, Timestamps, Base):
    """Localised text for an exercise. English lives on `exercises`; other locales here."""

    __tablename__ = "exercise_translations"
    __table_args__ = (UniqueConstraint("exercise_id", "locale"),)

    exercise_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("exercises.id", ondelete="CASCADE"))
    locale: Mapped[str] = mapped_column(String(10))  # hi, mr, ta …
    name: Mapped[str] = mapped_column(String(160))
    steps: Mapped[list[str]] = mapped_column(JSONB, default=list)
    cues: Mapped[str | None] = mapped_column(Text)
    common_mistakes: Mapped[str | None] = mapped_column(Text)
    precautions: Mapped[str | None] = mapped_column(Text)
