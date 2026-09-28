import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.models.clinical import AffectedSide
from app.models.twin import MeasurementSource, Side

Code = Annotated[str, Field(min_length=2, max_length=40)]
Value = Annotated[float, Field(ge=-999, le=9999)]  # range per code is checked in services/twin.py


class TargetIn(BaseModel):
    code: Code
    side: Side
    target_value: Value
    by_week: Annotated[int, Field(ge=1, le=104)] | None = None


class TargetOut(TargetIn):
    id: uuid.UUID


class MeasurementIn(BaseModel):
    code: Code
    side: Side
    value: Value
    method: Annotated[str, Field(min_length=2, max_length=30)] = "goniometer"
    measured_at: datetime | None = None  # default: now
    consultation_id: uuid.UUID | None = None
    note: Annotated[str, Field(max_length=500)] | None = None


class MeasurementOut(BaseModel):
    id: uuid.UUID
    code: str
    label: str
    unit: str
    side: Side
    value: float
    source: MeasurementSource
    method: str
    measured_at: datetime
    trusted: bool
    confidence: float | None
    note: str | None
    consultation_id: uuid.UUID | None
    recorded_by_name: str | None


class MeasurementUpdate(BaseModel):
    trusted: Literal[True]  # the physio confirms a reading that was held back as implausible


class TwinMeasureOut(BaseModel):
    """One tracked measure (e.g. right knee flexion): latest trusted value against the plan's target."""

    code: str
    label: str
    unit: str
    side: Side
    higher_is_better: bool
    latest: MeasurementOut | None
    baseline: float | None  # first trusted reading
    target: float | None
    by_week: int | None
    status: Literal["no_data", "no_target", "in_progress", "target_met"]
    progress_pct: int | None  # share of the way from baseline to target


class CodeOut(BaseModel):
    code: str
    label: str
    unit: str
    sided: bool
    min: float
    max: float
    higher_is_better: bool


class TwinOut(BaseModel):
    care_plan_id: uuid.UUID | None
    protocol: str | None
    protocol_label: str | None
    surgery_date: date | None
    affected_side: AffectedSide | None
    weeks_since_surgery: int | None
    measures: list[TwinMeasureOut]
    measurements: list[MeasurementOut]  # newest first
    codes: list[CodeOut]  # what the console can record
