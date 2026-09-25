import uuid
from datetime import date, datetime, time
from typing import Annotated

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.scheduling import AppointmentKind, AppointmentStatus, ConsultMode

# ── Directory ───────────────────────────────────────────────────────────────


class BranchBrief(BaseModel):
    id: uuid.UUID
    name: str
    area: str | None
    city: str
    address: str | None = None


class PhysioCard(BaseModel):
    id: uuid.UUID  # the physio's user id
    full_name: str
    avatar_url: str | None
    qualification: str | None
    specializations: list[str]
    experience_years: int | None
    rating_avg: float
    reviews_count: int
    offers_in_clinic: bool
    offers_online: bool
    fee_in_clinic_paise: int | None
    fee_online_paise: int | None
    clinic_name: str
    branch: BranchBrief
    distance_km: float | None = None
    next_slot_at: datetime | None = None


class DirectoryPage(BaseModel):
    items: list[PhysioCard]
    total: int


class ReviewOut(BaseModel):
    rating: int
    tags: list[str]
    comment: str | None
    patient_name: str  # first name + initial only
    created_at: datetime


class PhysioDetail(PhysioCard):
    bio: str | None
    college: str | None
    languages: list[str]
    branches: list[BranchBrief]
    reviews: list[ReviewOut]


class SlotOut(BaseModel):
    starts_at: datetime
    ends_at: datetime
    branch_id: uuid.UUID
    available: bool


class DayOut(BaseModel):
    date: date
    slots: list[SlotOut]


# ── Booking ─────────────────────────────────────────────────────────────────

REFERRAL_SOURCES = ["search", "friend_family", "doctor_referral", "social_media", "google", "walk_by", "other"]


class BookingIn(BaseModel):
    physio_id: uuid.UUID
    starts_at: datetime
    mode: ConsultMode
    referral_source: str | None = None
    redeem_points: bool = False

    @field_validator("starts_at")
    @classmethod
    def aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("starts_at must include a timezone")
        return v

    @field_validator("referral_source")
    @classmethod
    def known_source(cls, v: str | None) -> str | None:
        if v is not None and v not in REFERRAL_SOURCES:
            raise ValueError("Unknown referral source")
        return v


class RazorpayCheckout(BaseModel):
    key_id: str
    order_id: str
    amount: int
    currency: str = "INR"
    name: str = "Physionexs"
    description: str
    prefill: dict[str, str]


class CheckoutOut(BaseModel):
    appointment_id: uuid.UUID
    status: AppointmentStatus
    fee_paise: int
    discount_paise: int
    points_redeemed: int
    amount_paise: int
    hold_expires_at: datetime | None
    razorpay: RazorpayCheckout | None  # None when fully paid with points


class VerifyPaymentIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class PhysioBrief(BaseModel):
    id: uuid.UUID
    full_name: str
    qualification: str | None


class AppointmentOut(BaseModel):
    id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    mode: ConsultMode
    kind: AppointmentKind
    status: AppointmentStatus
    physio: PhysioBrief
    clinic_name: str
    branch: BranchBrief
    fee_paise: int
    amount_paid_paise: int
    points_redeemed: int
    paid: bool
    hold_expires_at: datetime | None


class PointsOut(BaseModel):
    balance: int
    paise_per_point: int


# ── Clinic side ─────────────────────────────────────────────────────────────


class PhysioProfileIn(BaseModel):
    qualification: str | None = Field(default=None, max_length=120)
    bio: str | None = Field(default=None, max_length=2000)
    college: str | None = Field(default=None, max_length=160)
    experience_years: Annotated[int, Field(ge=0, le=70)] | None = None
    specializations: list[Annotated[str, Field(min_length=1, max_length=60)]] = Field(default_factory=list, max_length=12)
    languages: list[Annotated[str, Field(min_length=1, max_length=40)]] = Field(default_factory=list, max_length=10)
    offers_in_clinic: bool = True
    offers_online: bool = False
    fee_in_clinic_paise: Annotated[int, Field(ge=0, le=10_000_000)] | None = None
    fee_online_paise: Annotated[int, Field(ge=0, le=10_000_000)] | None = None


class PhysioProfileOut(PhysioProfileIn):
    registration_no: str
    council: str | None
    verification_status: str


class AvailabilityItem(BaseModel):
    branch_id: uuid.UUID
    weekday: Annotated[int, Field(ge=0, le=6)]  # 0 = Monday
    start_time: time
    end_time: time
    slot_minutes: Annotated[int, Field(ge=10, le=180)] = 30

    @model_validator(mode="after")
    def ordered(self):
        if self.end_time <= self.start_time:
            raise ValueError("End time must be after start time")
        return self


class AvailabilityIn(BaseModel):
    items: list[AvailabilityItem] = Field(max_length=70)


class ClinicAppointmentOut(BaseModel):
    id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    mode: ConsultMode
    kind: AppointmentKind
    status: AppointmentStatus
    source: str
    patient_name: str
    patient_phone: str | None
    physio_name: str
    branch_name: str
    reason: str | None
    fee_paise: int
    paid: bool


class AppointmentStatusIn(BaseModel):
    status: AppointmentStatus


# ── Admin ───────────────────────────────────────────────────────────────────


class VerificationItem(BaseModel):
    user_id: uuid.UUID
    full_name: str
    email: str | None
    phone: str | None
    qualification: str | None
    registration_no: str
    council: str | None
    clinic_name: str | None
    city: str | None
    status: str
    submitted_at: datetime


class RejectIn(BaseModel):
    reason: Annotated[str, Field(min_length=3, max_length=500)]
