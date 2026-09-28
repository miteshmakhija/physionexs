import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.models.clinical import AffectedSide
from app.models.twin import (
    CheckinSource,
    ExercisesDone,
    FlagSeverity,
    FlagStatus,
    MeasurementSource,
    Side,
    Sleep,
    SuggestionAuthor,
    SuggestionStatus,
    Swelling,
)

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
    purpose: Literal["twin_tracking", "whatsapp"]
    version: Annotated[str, Field(max_length=20)]


class WhatsAppStateOut(BaseModel):
    consent: ConsentStateOut
    phone: str  # masked, e.g. +91 ••••• 45678


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
    whatsapp: WhatsAppStateOut | None = None  # present only when WhatsApp check-ins are switched on



class CheckinResultOut(BaseModel):
    checkin: CheckinOut
    advice: AdviceOut | None


ChangeField = Literal["sets", "reps", "hold_seconds", "is_active"]


class PlanChangeIn(BaseModel):
    """One edit to a prescribed exercise. `before` must match the plan when it's applied, or the suggestion is out of date."""

    plan_exercise_id: uuid.UUID
    field: ChangeField
    before: int | bool | None
    after: int | bool


class PlanChangeOut(PlanChangeIn):
    exercise_name: str


class SuggestionOut(BaseModel):
    id: uuid.UUID
    care_plan_id: uuid.UUID
    flag_id: uuid.UUID | None
    author: SuggestionAuthor
    title: str
    rationale: str
    changes: list[PlanChangeOut]
    status: SuggestionStatus
    stale: bool  # the plan changed since it was proposed; approving would fail
    created_at: datetime
    decided_at: datetime | None
    decided_by_name: str | None
    decision_note: str | None


class SuggestionApproveIn(BaseModel):
    changes: list[PlanChangeIn] | None = Field(default=None, max_length=30)  # the physio's edited version, if any
    note: Annotated[str, Field(max_length=300)] | None = None


class SuggestionRejectIn(BaseModel):
    note: Annotated[str, Field(max_length=300)] | None = None


class FlagOut(BaseModel):
    id: uuid.UUID
    clinic_patient_id: uuid.UUID
    patient_name: str
    rule: str
    rule_label: str
    severity: FlagSeverity
    status: FlagStatus
    summary: str
    evidence: dict
    opened_at: datetime
    last_seen_at: datetime
    resolved_at: datetime | None
    resolved_by_name: str | None
    resolution_note: str | None
    suggestion: SuggestionOut | None = None  # pending plan change proposed for this flag


class FlagCloseIn(BaseModel):
    note: Annotated[str, Field(max_length=300)] | None = None


class FlagDismissIn(BaseModel):
    note: Annotated[str, Field(min_length=3, max_length=300)]  # why it isn't a concern


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
    flags: list[FlagOut] = Field(default_factory=list)  # active, plus closed in the last 30 days


class CameraMeasurementIn(BaseModel):
    """A camera angle captured in clinic, with the goniometer reading taken at the same moment."""

    code: Literal["knee_flexion", "knee_extension_lag"]
    side: Literal["left", "right"]
    posture: Literal["supine", "seated", "standing"]
    camera_value: Annotated[float, Field(ge=-30, le=200)]
    camera_value_3d: Annotated[float, Field(ge=-30, le=200)] | None = None
    confidence: Annotated[float, Field(ge=0, le=1)]
    frames: Annotated[int, Field(ge=1, le=10000)]
    spread: Annotated[float, Field(ge=0, le=200)]
    fps: Annotated[float, Field(ge=0, le=240)] | None = None
    model: Annotated[str, Field(min_length=2, max_length=60)]
    goniometer_value: Value
    lighting: Literal["good", "dim", "mixed"] | None = None
    clothing: Literal["shorts", "fitted", "loose"] | None = None
    note: Annotated[str, Field(max_length=500)] | None = None
    patient_consented: Literal[True]  # the physio confirms the patient agreed to camera measurement


class ValidationPairOut(BaseModel):
    id: uuid.UUID
    patient_name: str | None  # omitted in the Physionexs-wide view
    code: str
    side: Side
    posture: str
    camera_value: float
    camera_value_3d: float | None
    reference_value: float
    confidence: float
    frames: int
    spread: float
    fps: float | None
    model: str
    lighting: str | None
    clothing: str | None
    note: str | None
    created_at: datetime


class AgreementOut(BaseModel):
    """Bland–Altman agreement, camera − goniometer, in degrees."""

    code: str
    posture: str
    n: int
    patients: int
    bias: float | None
    sd: float | None
    lower: float | None  # 95% limits of agreement
    upper: float | None
    bias_3d: float | None
    sd_3d: float | None


class ValidationOut(BaseModel):
    summary: list[AgreementOut]
    pairs: list[ValidationPairOut]


class CameraMeasurementOut(BaseModel):
    camera: MeasurementOut
    goniometer: MeasurementOut
    difference: float  # camera − goniometer


class RecoveryMeasureOut(BaseModel):
    """A measure as the patient sees it: latest clinic reading against the target their physio set."""

    code: str
    label: str
    hint: str | None
    side: Side
    unit: str
    higher_is_better: bool
    latest: float | None
    latest_on: date | None
    baseline: float | None
    target: float | None
    by_week: int | None
    status: Literal["no_data", "no_target", "in_progress", "target_met"]
    progress_pct: int | None


class RecoveryReadingOut(BaseModel):
    code: str
    side: Side
    value: float
    measured_on: date


class RecoveryDayOut(BaseModel):
    day: date
    pain: int
    stiffness: int


class RecoveryOut(BaseModel):
    """The patient's own recovery view. Only confirmed clinic readings and their own check-ins; no flags or notes."""

    available: bool
    condition: str | None = None
    clinic_name: str | None = None
    surgery_date: date | None = None
    weeks_since_surgery: int | None = None
    measures: list[RecoveryMeasureOut] = Field(default_factory=list)
    readings: list[RecoveryReadingOut] = Field(default_factory=list)  # oldest first
    checkins: list[RecoveryDayOut] = Field(default_factory=list)  # last 30 days, oldest first
