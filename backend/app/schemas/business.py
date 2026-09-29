import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field, field_validator, model_validator

from app.core.phone import normalize_phone
from app.models.billing import InvoiceStatus
from app.models.clinic import MembershipRole, SubscriptionPlan, SubscriptionStatus
from app.models.hr import AttendanceStatus, LeaveStatus, LeaveType, PayslipStatus

Phone = Annotated[str, AfterValidator(normalize_phone)]
Method = Literal["cash", "upi", "card", "netbanking", "other"]
GSTIN_RE = r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"

# ── Billing ─────────────────────────────────────────────────────────────────


class InvoiceLineIn(BaseModel):
    description: Annotated[str, Field(min_length=1, max_length=200)]
    detail: Annotated[str, Field(max_length=200)] | None = None
    quantity: Annotated[int, Field(ge=1, le=100)] = 1
    rate_paise: Annotated[int, Field(ge=0, le=100_000_000)]


class InvoiceIn(BaseModel):
    clinic_patient_id: uuid.UUID
    branch_id: uuid.UUID | None = None
    items: list[InvoiceLineIn] = Field(min_length=1, max_length=30)
    due_on: date | None = None
    notes: Annotated[str, Field(max_length=1000)] | None = None
    paid_via: Method | None = None  # set to record the invoice as already paid


class PayIn(BaseModel):
    method: Method


class InvoiceLineOut(InvoiceLineIn):
    amount_paise: int


class InvoiceListItem(BaseModel):
    id: uuid.UUID
    number: str
    patient_name: str
    clinic_patient_id: uuid.UUID
    service: str
    issued_on: date
    due_on: date | None
    total_paise: int
    status: InvoiceStatus
    paid_via: str | None
    paid_at: datetime | None
    from_app: bool


class BillingSummary(BaseModel):
    collected_today_paise: int
    collected_today_count: int
    outstanding_paise: int
    outstanding_count: int
    month_paise: int
    prev_month_paise: int


class InvoicePage(BaseModel):
    summary: BillingSummary
    items: list[InvoiceListItem]


class InvoiceOut(InvoiceListItem):
    subtotal_paise: int
    tax_paise: int
    notes: str | None
    items: list[InvoiceLineOut]
    patient: dict  # name, phone, age, sex
    clinic: dict  # letterhead: name, logo_url, address, phone, email, gstin


# ── Dashboard & analytics ───────────────────────────────────────────────────


class BranchStat(BaseModel):
    id: uuid.UUID
    name: str
    area: str | None
    lead_name: str | None
    today: int
    waiting: int
    patients: int
    revenue_week_paise: int | None


class ScheduleItem(BaseModel):
    id: uuid.UUID
    starts_at: datetime
    patient_name: str
    reason: str | None
    mode: str
    status: str


class AttentionItem(BaseModel):
    clinic_patient_id: uuid.UUID
    name: str
    note: str
    adherence: int


class SubscriptionOut(BaseModel):
    plan: SubscriptionPlan
    price_paise: int
    status: SubscriptionStatus
    trial_ends_at: datetime | None
    current_period_end: datetime | None
    days_left: int | None
    due_soon: bool


class DashboardOut(BaseModel):
    appointments_today: int
    tokens_waiting: int
    active_patients: int
    staff_on_roll: int
    revenue_week_paise: int | None  # hidden from staff
    branches: list[BranchStat]
    schedule: list[ScheduleItem]
    attention: list[AttentionItem]
    subscription: SubscriptionOut | None


class SeriesPoint(BaseModel):
    day: date
    value: int


class Share(BaseModel):
    label: str
    count: int
    pct: int


class AnalyticsOut(BaseModel):
    days: int
    revenue_paise: int
    revenue_prev_paise: int
    appointments: int
    appointments_prev: int
    avg_adherence: int | None
    no_show_pct: float | None
    revenue_by_day: list[SeriesPoint]
    conditions: list[Share]
    returning_pct: int | None
    new_patients: int
    online_pct: int | None
    rating_avg: float | None
    reviews: int


# ── Clinic profile & branches ───────────────────────────────────────────────


class ClinicProfileIn(BaseModel):
    name: Annotated[str, Field(min_length=2, max_length=160)]
    phone: Phone | None = None
    email: Annotated[str, Field(max_length=254)] | None = None
    address: Annotated[str, Field(max_length=500)] | None = None
    gstin: Annotated[str, Field(pattern=GSTIN_RE)] | None = None
    # data:image/png;base64,… (≤ 300 KB) — or null to remove and use the Physionexs mark
    logo_url: str | None = None

    @field_validator("gstin", mode="before")
    @classmethod
    def upper(cls, v):
        return v.strip().upper() if isinstance(v, str) and v.strip() else None

    @field_validator("logo_url")
    @classmethod
    def logo(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not v.startswith(("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,", "https://")):
            raise ValueError("Logo must be a PNG, JPG or WebP image")
        if len(v) > 400_000:
            raise ValueError("Logo is too large — use an image under 300 KB")
        return v


class ClinicProfileOut(ClinicProfileIn):
    id: uuid.UUID
    slug: str
    platform_fee_bps: int


class BranchIn(BaseModel):
    name: Annotated[str, Field(min_length=2, max_length=160)]
    area: Annotated[str, Field(max_length=120)] | None = None
    city: Annotated[str, Field(min_length=2, max_length=80)]
    address: Annotated[str, Field(max_length=500)] | None = None
    latitude: Annotated[float, Field(ge=-90, le=90)] | None = None
    longitude: Annotated[float, Field(ge=-180, le=180)] | None = None
    hours: Annotated[str, Field(max_length=120)] | None = None
    therapy_rooms: Annotated[int, Field(ge=1, le=100)] = 1
    lead_user_id: uuid.UUID | None = None
    is_active: bool = True


class BranchOut(BranchIn):
    id: uuid.UUID
    lead_name: str | None
    staff_count: int
    timezone: str


class CheckoutIn(BaseModel):
    plan: SubscriptionPlan | None = None  # switch plan when paying


# ── Staff ───────────────────────────────────────────────────────────────────


class StaffIn(BaseModel):
    full_name: Annotated[str, Field(min_length=2, max_length=120)]
    email: EmailStr  # they sign in with this email
    password: Annotated[str, Field(min_length=8, max_length=128)]  # temporary; the owner shares it, they can reset it later
    phone: Phone | None = None
    role: Literal[MembershipRole.STAFF, MembershipRole.PHYSIO] = MembershipRole.STAFF
    job_title: Annotated[str, Field(max_length=80)] | None = None
    department: Annotated[str, Field(max_length=80)] | None = None
    monthly_salary_paise: Annotated[int, Field(ge=0, le=100_000_000)] | None = None
    branch_id: uuid.UUID | None = None
    joined_on: date | None = None
    employee_code: Annotated[str, Field(max_length=20)] | None = None
    registration_no: Annotated[str, Field(max_length=60)] | None = None  # physiotherapists: council reg. no.


class StaffUpdate(BaseModel):
    full_name: Annotated[str, Field(min_length=2, max_length=120)] | None = None
    email: EmailStr | None = None
    phone: Phone | None = None
    password: Annotated[str, Field(min_length=8, max_length=128)] | None = None  # a new temporary password
    role: Literal[MembershipRole.STAFF, MembershipRole.PHYSIO] | None = None
    job_title: Annotated[str, Field(max_length=80)] | None = None
    department: Annotated[str, Field(max_length=80)] | None = None
    monthly_salary_paise: Annotated[int, Field(ge=0, le=100_000_000)] | None = None
    branch_id: uuid.UUID | None = None  # sent as null: works at all branches
    employee_code: Annotated[str, Field(max_length=20)] | None = None
    is_active: bool | None = None


class StaffOut(BaseModel):
    id: uuid.UUID  # membership id
    user_id: uuid.UUID
    full_name: str
    phone: str | None
    email: str | None = None
    role: MembershipRole
    job_title: str | None
    department: str | None
    employee_code: str | None
    monthly_salary_paise: int | None
    branch_id: uuid.UUID | None
    branch_name: str | None
    joined_on: date | None
    is_active: bool
    today: AttendanceStatus | None
    check_in: time | None


class AttendanceIn(BaseModel):
    member_id: uuid.UUID
    day: date
    status: AttendanceStatus
    check_in: time | None = None
    check_out: time | None = None


class AttendanceDay(BaseModel):
    day: date
    present: int
    half_day: int
    on_leave: int
    absent: int
    unmarked: int
    rows: list[StaffOut]


class LeaveIn(BaseModel):
    leave_type: LeaveType
    from_date: date
    to_date: date
    reason: Annotated[str, Field(max_length=500)] | None = None
    half_day: bool = False

    @model_validator(mode="after")
    def order(self):
        if self.to_date < self.from_date:
            raise ValueError("End date is before start date")
        if (self.to_date - self.from_date).days > 60:
            raise ValueError("Leave can be at most 60 days")
        if self.half_day and self.to_date != self.from_date:
            raise ValueError("Half-day leave must be a single day")
        return self


class LeaveOut(BaseModel):
    id: uuid.UUID
    member_id: uuid.UUID
    name: str
    leave_type: LeaveType
    from_date: date
    to_date: date
    days: float
    reason: str | None
    status: LeaveStatus
    created_at: datetime


class PayslipOut(BaseModel):
    id: uuid.UUID | None  # None = not generated yet (preview)
    member_id: uuid.UUID
    name: str
    employee_code: str | None
    role: str
    department: str | None
    gross_paise: int
    deductions_paise: int
    net_paise: int
    unpaid_days: float
    status: PayslipStatus | None
    paid_at: datetime | None


class PayrollOut(BaseModel):
    period: date
    total_net_paise: int
    pending_net_paise: int
    pending_count: int
    rows: list[PayslipOut]
