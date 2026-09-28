import uuid
from datetime import date, datetime
from typing import Annotated, Any

from pydantic import BaseModel, EmailStr, Field, model_validator

from app.models.clinic import SubscriptionPlan, SubscriptionStatus


class RevenueSplit(BaseModel):
    commission_paise: int  # platform fee on patient bookings
    pms_paise: int  # clinic subscription fees
    gmv_paise: int  # booking value
    payout_paise: int  # owed to clinics
    avg_fee_pct: float | None


class CategoryShare(BaseModel):
    label: str
    count: int
    pct: int


class ActivityItem(BaseModel):
    id: uuid.UUID
    action: str
    entity: str
    summary: str | None
    actor: str | None
    created_at: datetime


class AdminDashboard(BaseModel):
    pending_verifications: int
    patients: int
    patients_this_month: int
    physios: int
    bookings: int
    reviews: int
    rating_avg: float | None
    revenue: RevenueSplit
    by_speciality: list[CategoryShare]
    activity: list[ActivityItem]


class MonthPoint(BaseModel):
    month: date
    patients: int
    physios: int
    bookings: int
    commission_paise: int
    pms_paise: int


class AdminAnalytics(BaseModel):
    months: list[MonthPoint]
    by_speciality: list[CategoryShare]
    plan_monthly: int
    plan_yearly: int
    plan_commission: int
    avg_fee_pct: float | None
    revenue: RevenueSplit


class SubscriptionRow(BaseModel):
    clinic_id: uuid.UUID
    clinic_name: str
    owner_name: str
    owner_email: str | None
    plan: SubscriptionPlan
    price_paise: int
    status: SubscriptionStatus
    current_period_end: datetime | None
    trial_ends_at: datetime | None
    platform_fee_bps: int


class SubscriptionKpis(BaseModel):
    mrr_paise: int
    arr_paise: int
    active: int
    trial: int
    overdue: int
    cancelled: int


class SubscriptionPage(BaseModel):
    kpis: SubscriptionKpis
    rows: list[SubscriptionRow]


class SubscriptionUpdate(BaseModel):
    plan: SubscriptionPlan
    price_paise: Annotated[int, Field(ge=0, le=10_000_000)]
    status: SubscriptionStatus
    current_period_end: datetime | None = None
    platform_fee_bps: Annotated[int, Field(ge=0, le=5000)]


class AuditRow(BaseModel):
    id: uuid.UUID
    action: str
    entity: str
    entity_id: str | None
    summary: str | None
    actor: str | None
    clinic: str | None
    ip: str | None
    created_at: datetime


class AuditPage(BaseModel):
    rows: list[AuditRow]
    total: int


class ReviewRow(BaseModel):
    id: uuid.UUID
    rating: int
    tags: list[str]
    comment: str | None
    physio_name: str
    patient_name: str
    is_hidden: bool
    created_at: datetime


# ── Settings (one model per key; unknown keys are rejected) ─────────────────


class RewardTier(BaseModel):
    days: Annotated[int, Field(ge=1, le=365)]
    points: Annotated[int, Field(ge=0, le=100_000)]


class RewardsSetting(BaseModel):
    tiers: list[RewardTier] = Field(max_length=8)
    paise_per_point: Annotated[int, Field(ge=1, le=10_000)]

    @model_validator(mode="after")
    def sorted_unique(self):
        days = [t.days for t in self.tiers]
        if len(days) != len(set(days)):
            raise ValueError("Each streak length can only appear once")
        self.tiers = sorted(self.tiers, key=lambda t: t.days)
        return self


class SupportSetting(BaseModel):
    email: EmailStr
    phone: Annotated[str, Field(min_length=8, max_length=30)]
    address: Annotated[str, Field(max_length=300)]
    hours: Annotated[str, Field(max_length=120)]


class PricingSetting(BaseModel):
    monthly_paise: Annotated[int, Field(ge=0, le=10_000_000)]
    yearly_paise: Annotated[int, Field(ge=0, le=100_000_000)]
    trial_days: Annotated[int, Field(ge=0, le=180)]
    commission_bps: Annotated[int, Field(ge=0, le=5000)] = 300  # "Pay per booking" plan


class PlatformFeeSetting(BaseModel):
    default_bps: Annotated[int, Field(ge=0, le=5000)]
    allowed_bps: list[Annotated[int, Field(ge=0, le=5000)]] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def default_allowed(self):
        if self.default_bps not in self.allowed_bps:
            raise ValueError("The default fee must be one of the allowed fees")
        self.allowed_bps = sorted(set(self.allowed_bps))
        return self


class TwinRulesSetting(BaseModel):
    """Recovery-twin flag thresholds (services/twin_rules.py), tuned by the clinical lead."""

    pain_rising_delta: Annotated[int, Field(ge=1, le=6)]  # 3-day average this many points above the week before
    pain_high: Annotated[int, Field(ge=5, le=10)]  # any check-in at or above this pain
    plateau_min_change_deg: Annotated[int, Field(ge=1, le=20)]  # knee bend changed less than this…
    plateau_min_span_days: Annotated[int, Field(ge=3, le=28)]  # …across readings at least this many days apart
    rom_drop_deg: Annotated[int, Field(ge=3, le=40)]  # knee bend this far below the best reading
    missed_days: Annotated[int, Field(ge=2, le=14)]  # scheduled days in a row with nothing logged
    no_checkin_days: Annotated[int, Field(ge=2, le=14)]
    auto_resolve_days: Annotated[int, Field(ge=1, le=14)]  # a flag closes after this many days back to normal


SETTINGS_MODELS: dict[str, type[BaseModel]] = {
    "rewards": RewardsSetting,
    "support": SupportSetting,
    "pms_pricing": PricingSetting,
    "platform_fee": PlatformFeeSetting,
    "twin_rules": TwinRulesSetting,
}


class SettingOut(BaseModel):
    key: str
    value: dict[str, Any]
    updated_at: datetime | None
    updated_by: str | None


# ── Records browser ─────────────────────────────────────────────────────────


class Collection(BaseModel):
    key: str
    label: str
    count: int
    actions: list[str]


class RecordsPage(BaseModel):
    key: str
    label: str
    columns: list[str]
    rows: list[dict[str, Any]]  # each row has "id" plus the columns
    total: int
    actions: list[str]


class RecordAction(BaseModel):
    action: Annotated[str, Field(max_length=40)]
    value: Any = None
