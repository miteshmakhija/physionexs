import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field, model_validator

from app.core.phone import normalize_phone
from app.models.clinical import CarePlanStatus, Feel, Frequency, TestOrderStatus
from app.models.exercise import DoseUnit, ExerciseCategory, ExercisePosition, ExerciseStatus
from app.models.patient import ClinicPatientStatus, CoreGrade, Sex
from app.models.scheduling import TokenStatus

Phone = Annotated[str, AfterValidator(normalize_phone)]
ShortText = Annotated[str, Field(max_length=200)]
LongText = Annotated[str, Field(max_length=5000)]

class MediaOut(BaseModel):
    kind: str  # video | image
    url: str
    thumbnail_url: str | None = None
    duration_seconds: int | None = None


# ── Token queue ─────────────────────────────────────────────────────────────


class WalkInIn(BaseModel):
    branch_id: uuid.UUID
    patient_id: uuid.UUID | None = None  # existing patient; otherwise phone + name
    phone: Phone | None = None
    full_name: Annotated[str, Field(min_length=2, max_length=120)] | None = None
    age: Annotated[int, Field(ge=0, le=120)] | None = None
    sex: Sex | None = None
    reason: ShortText | None = None
    physio_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def who(self):
        if not self.patient_id and not self.full_name:
            raise ValueError("Pick an existing patient or enter the patient's name")
        return self


class QueueTokenOut(BaseModel):
    id: uuid.UUID
    label: str
    number: int
    status: TokenStatus
    patient_id: uuid.UUID
    clinic_patient_id: uuid.UUID | None
    patient_name: str
    patient_age: int | None
    patient_sex: Sex | None
    reason: str | None
    physio_name: str | None
    created_at: datetime
    called_at: datetime | None


class QueueOut(BaseModel):
    branch_id: uuid.UUID
    service_date: date
    now_serving: QueueTokenOut | None
    waiting: list[QueueTokenOut]
    done: list[QueueTokenOut]
    avg_wait_minutes: int | None


class TokenStatusIn(BaseModel):
    status: TokenStatus


class MyTokenOut(BaseModel):
    label: str
    status: TokenStatus
    clinic_name: str
    branch_name: str
    ahead: int
    est_wait_minutes: int
    now_serving: str | None


# ── Patients ────────────────────────────────────────────────────────────────


class PatientIn(BaseModel):
    full_name: Annotated[str, Field(min_length=2, max_length=120)]
    phone: Phone | None = None
    email: str | None = Field(default=None, max_length=254)
    age: Annotated[int, Field(ge=0, le=120)] | None = None
    sex: Sex | None = None


class PatientListItem(BaseModel):
    id: uuid.UUID  # clinic_patient id
    patient_id: uuid.UUID
    full_name: str
    phone: str | None
    age: int | None
    sex: Sex | None
    condition: str | None
    last_visit_on: date | None
    adherence_7d: int | None
    status: ClinicPatientStatus
    has_app: bool


class BackgroundIn(BaseModel):
    past_history: LongText | None = None
    conditions: list[Annotated[str, Field(min_length=1, max_length=80)]] = Field(default_factory=list, max_length=30)
    prior_medicines: list[dict] = Field(default_factory=list, max_length=30)  # [{name, frequency, note}]
    core_strengths: LongText | None = None
    weaknesses: LongText | None = None
    core_grade: CoreGrade | None = None


class BackgroundOut(BackgroundIn):
    updated_at: datetime | None = None


class PlanExerciseIn(BaseModel):
    exercise_id: uuid.UUID
    sets: Annotated[int, Field(ge=1, le=20)]
    reps: Annotated[int, Field(ge=1, le=200)] | None = None
    hold_seconds: Annotated[int, Field(ge=1, le=600)] | None = None
    rest_seconds: Annotated[int, Field(ge=0, le=600)] = 30
    frequency: Frequency = Frequency.DAILY
    times_per_day: Annotated[int, Field(ge=1, le=6)] = 1
    notes: ShortText | None = None

    @model_validator(mode="after")
    def dose(self):
        if not self.reps and not self.hold_seconds:
            raise ValueError("Set reps or hold time")
        return self


class PlanExerciseOut(PlanExerciseIn):
    id: uuid.UUID
    name: str
    body_region: str
    dose_unit: DoseUnit
    thumbnail_url: str | None = None


class MedicationIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=160)]
    dose: Annotated[str, Field(max_length=60)] | None = None
    frequency: Annotated[str, Field(pattern=r"^([0-9½]-[0-9½]-[0-9½]|SOS|Once daily|Twice daily|Weekly)$")]
    timing: Annotated[str, Field(max_length=60)] | None = None
    duration_days: Annotated[int, Field(ge=1, le=365)] | None = None
    instructions: ShortText | None = None


class MedicationOut(MedicationIn):
    id: uuid.UUID
    reminder_times: list[str]
    starts_on: date


class TestOrderIn(BaseModel):
    name: Annotated[str, Field(min_length=2, max_length=120)]


class TestOrderUpdate(BaseModel):
    status: TestOrderStatus
    result_note: LongText | None = None


class TestOrderOut(BaseModel):
    id: uuid.UUID
    name: str
    status: TestOrderStatus
    result_note: str | None
    created_at: datetime
    result_at: datetime | None


class CarePlanIn(BaseModel):
    condition: Annotated[str, Field(min_length=2, max_length=160)]
    condition_detail: ShortText | None = None
    goal: ShortText | None = None
    stage: Annotated[str, Field(max_length=80)] | None = None
    notes: LongText | None = None
    sessions_planned: Annotated[int, Field(ge=1, le=200)] | None = None
    ends_on: date | None = None


class CarePlanOut(CarePlanIn):
    id: uuid.UUID
    status: CarePlanStatus
    starts_on: date
    physio_name: str
    clinic_name: str
    exercises: list[PlanExerciseOut]
    medications: list[MedicationOut]
    tests: list[TestOrderOut]


class ConsultationIn(BaseModel):
    title: Annotated[str, Field(max_length=120)] | None = None
    appointment_id: uuid.UUID | None = None
    subjective: LongText | None = None
    objective: LongText | None = None
    assessment: LongText | None = None
    plan: LongText | None = None
    vitals: dict[str, str | int | float] = Field(default_factory=dict, max_length=30)
    pain_vas: Annotated[int, Field(ge=0, le=10)] | None = None
    sign: bool = False


class ConsultationOut(BaseModel):
    id: uuid.UUID
    title: str | None
    physio_name: str
    subjective: str | None
    objective: str | None
    assessment: str | None
    plan: str | None
    vitals: dict
    pain_vas: int | None
    signed_at: datetime | None
    created_at: datetime


class PatientFileOut(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    full_name: str
    phone: str | None
    email: str | None
    age: int | None
    sex: Sex | None
    has_app: bool
    status: ClinicPatientStatus
    first_visit_on: date | None
    last_visit_on: date | None
    adherence_7d: int | None
    latest_pain: int | None
    first_pain: int | None
    sessions_done: int
    background: BackgroundOut | None
    active_plan: CarePlanOut | None
    past_plans: list[dict]
    consultations: list[ConsultationOut]


class PrescriptionOut(BaseModel):
    id: uuid.UUID
    rx_no: str
    issued_at: datetime
    snapshot: dict


# ── Exercise library ────────────────────────────────────────────────────────


class ExerciseIn(BaseModel):
    name: Annotated[str, Field(min_length=3, max_length=160)]
    body_region: Annotated[str, Field(min_length=2, max_length=40)]
    category: ExerciseCategory
    position: ExercisePosition | None = None
    equipment: list[Annotated[str, Field(max_length=40)]] = Field(default_factory=list, max_length=8)
    difficulty: Annotated[int, Field(ge=1, le=5)] = 1
    dose_unit: DoseUnit = DoseUnit.REPS
    default_sets: Annotated[int, Field(ge=1, le=20)] = 3
    default_reps: Annotated[int, Field(ge=1, le=200)] | None = 10
    default_hold_seconds: Annotated[int, Field(ge=1, le=600)] | None = None
    default_rest_seconds: Annotated[int, Field(ge=0, le=600)] = 30
    steps: list[Annotated[str, Field(min_length=2, max_length=400)]] = Field(min_length=1, max_length=15)
    cues: LongText | None = None
    common_mistakes: LongText | None = None
    precautions: LongText | None = None
    contraindications: LongText | None = None
    conditions: list[Annotated[str, Field(max_length=80)]] = Field(default_factory=list, max_length=15)


class ExerciseOut(ExerciseIn):
    id: uuid.UUID
    slug: str
    source: str
    visibility: str
    status: ExerciseStatus
    owner_clinic_id: uuid.UUID | None
    review_note: str | None
    media: list[MediaOut]


class ExercisePage(BaseModel):
    items: list[ExerciseOut]
    total: int


class ReviewDecisionIn(BaseModel):
    note: Annotated[str, Field(max_length=1000)] | None = None


# ── Patient app ─────────────────────────────────────────────────────────────


class TodayExercise(BaseModel):
    plan_exercise_id: uuid.UUID
    exercise_id: uuid.UUID
    name: str
    body_region: str
    sets: int
    reps: int | None
    hold_seconds: int | None
    rest_seconds: int
    dose_unit: DoseUnit
    notes: str | None
    steps: list[str]
    cues: str | None
    precautions: str | None
    media: list[MediaOut]
    scheduled: int
    done: int


class TodayDose(BaseModel):
    medication_id: uuid.UUID
    name: str
    dose: str | None
    timing: str | None
    slot: str  # "08:30"
    taken: bool


class TodayOut(BaseModel):
    day: date
    exercises: list[TodayExercise]
    doses: list[TodayDose]
    exercise_pct: int | None
    dose_pct: int | None
    streak_days: int


class ExerciseLogIn(BaseModel):
    plan_exercise_id: uuid.UUID
    logged_on: date
    feel: Feel | None = None
    pain: Annotated[int, Field(ge=0, le=10)] | None = None
    note: ShortText | None = None


class ExerciseLogOut(BaseModel):
    done: int
    scheduled: int
    streak_days: int
    points_awarded: int


class DoseLogIn(BaseModel):
    medication_id: uuid.UUID
    logged_on: date
    dose_slot: Annotated[str, Field(pattern=r"^\d{2}:\d{2}$")]


class ProgressDay(BaseModel):
    day: date
    scheduled: int
    done: int
    pct: int | None
    pain: float | None


class ProgressOut(BaseModel):
    days: list[ProgressDay]
    adherence_pct: int | None
    streak_days: int
    best_streak_days: int
    pain_now: float | None
    pain_start: float | None
    unlogged_doses_today: int
