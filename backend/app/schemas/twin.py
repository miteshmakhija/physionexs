import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.models.clinical import AffectedSide
from app.models.twin import CheckinSource, ExercisesDone, MeasurementSource, Side, Sleep, Swelling

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


RedFlag = Literal["calf_pain", "fever", "wound_redness", "chest_breathless"]


class CheckinIn(BaseModel):
    day: date  # patient's local date
    pain: Annotated[int, Field(ge=0, le=10)]
    stiffness: Annotated[int, Field(ge=0, le=10)]
    swelling: Swelling
    sleep: Sleep
    exercises: ExercisesDone
    red_flags: list[RedFlag] = Field(default_factory=list, max_length=4)
    note: Annotated[str, Field(max_length=500)] | None = None


class CheckinOut(CheckinIn):
    id: uuid.UUID
    red_flags: list[str]
    source: CheckinSource
    updated_at: datetime


class OptionOut(BaseModel):
    code: str
    label: str


class AdviceOut(BaseModel):
    level: Literal["emergency", "urgent"]
    title: str
    body: str
    call_label: str | None
    call_number: str | None


class ConsentStateOut(BaseModel):
    purpose: str
    version: str  # current version of the text
    title: str
    body: str
    granted: bool  # granted for the current version
    granted_at: datetime | None


class ConsentIn(BaseModel):
    purpose: Literal["twin_tracking"]
    version: Annotated[str, Field(max_length=20)]


class CheckinPlanOut(BaseModel):
    care_plan_id: uuid.UUID
    condition: str
    clinic_name: str


class CheckinStateOut(BaseModel):
    """Everything the patient app needs to show the check-in card."""

    eligible: bool  # has an active plan that uses check-ins
    plan: CheckinPlanOut | None
    consent: ConsentStateOut
    today: CheckinOut | None
    advice: AdviceOut | None  # for red flags reported today
    recent: list[CheckinOut]  # last 7 days, newest first
    red_flag_options: list[OptionOut]


class CheckinResultOut(BaseModel):
    checkin: CheckinOut
    advice: AdviceOut | None


class RedFlagReportOut(BaseModel):
    clinic_patient_id: uuid.UUID
    patient_name: str
    day: date
    red_flags: list[OptionOut]
    pain: int


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
    checkins: list[CheckinOut] = Field(default_factory=list)  # last 30 days, newest first
    red_flag_labels: dict[str, str] = Field(default_factory=dict)
