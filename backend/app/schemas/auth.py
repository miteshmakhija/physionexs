import uuid
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field

from app.core.phone import normalize_phone
from app.models.clinic import MembershipRole, SubscriptionPlan, VerificationStatus
from app.models.user import UserRole

Phone = Annotated[str, AfterValidator(normalize_phone)]
Password = Annotated[str, Field(min_length=8, max_length=128)]
Name = Annotated[str, Field(min_length=2, max_length=120)]


class OtpRequestIn(BaseModel):
    phone: Phone
    # Only clinic staff sign in with a phone code; patients and physios use their email.
    intent: Literal["patient", "staff"] = "patient"


class OtpRequestOut(BaseModel):
    expires_in: int


class OtpVerifyIn(BaseModel):
    phone: Phone
    code: Annotated[str, Field(pattern=r"^\d{4,8}$")]
    full_name: Name | None = None  # required the first time (new patient)
    intent: Literal["patient", "staff"] = "patient"


class PatientRegisterIn(BaseModel):
    full_name: Name
    phone: Phone | None = None  # contact only; sign-in is by email
    email: EmailStr
    password: Password


class PhysioRegisterIn(BaseModel):
    full_name: Name
    email: EmailStr
    phone: Phone
    password: Password
    registration_no: Annotated[str, Field(min_length=3, max_length=60)]
    council: Annotated[str, Field(min_length=2, max_length=80)]
    qualification: Annotated[str, Field(min_length=2, max_length=120)]
    clinic_name: Annotated[str, Field(min_length=2, max_length=160)]
    city: Annotated[str, Field(min_length=2, max_length=80)]
    plan: SubscriptionPlan = SubscriptionPlan.MONTHLY


class LoginIn(BaseModel):
    identifier: Annotated[str, Field(min_length=3, max_length=254)]  # email
    password: Annotated[str, Field(min_length=1, max_length=128)]
    totp_code: str | None = Field(default=None, pattern=r"^\d{6}$")
    # Which sign-in page: "patient" admits only patients, "clinic" (practice console) only clinic accounts.
    intent: Literal["patient", "clinic"] | None = None


class RefreshIn(BaseModel):
    refresh_token: str | None = None  # mobile sends it; web uses the httpOnly cookie


class MembershipOut(BaseModel):
    clinic_id: uuid.UUID
    clinic_name: str
    role: MembershipRole
    branch_id: uuid.UUID | None
    twin_pilot: bool = False  # recovery-twin features switched on for this clinic
    ai_assist: bool = False  # AI assist switched on for this clinic and configured on the server


class MeOut(BaseModel):
    id: uuid.UUID
    full_name: str
    phone: str | None
    email: str | None
    role: UserRole
    avatar_url: str | None
    totp_enabled: bool
    patient_id: uuid.UUID | None = None
    physio_verification: VerificationStatus | None = None
    memberships: list[MembershipOut] = []


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int
    user: MeOut


class TotpSetupOut(BaseModel):
    secret: str
    otpauth_uri: str


class TotpCodeIn(BaseModel):
    code: Annotated[str, Field(pattern=r"^\d{6}$")]


class ForgotPasswordIn(BaseModel):
    identifier: Annotated[str, Field(min_length=3, max_length=254)]  # email or phone


class ForgotPasswordOut(BaseModel):
    channel: str  # "email" | "sms" — where the code goes if the account exists
    expires_in: int


class ResetPasswordIn(BaseModel):
    identifier: Annotated[str, Field(min_length=3, max_length=254)]
    code: Annotated[str, Field(pattern=r"^\d{6}$")]
    new_password: Password


class GoogleIn(BaseModel):
    code: Annotated[str, Field(min_length=10, max_length=2048)]
    redirect_uri: Annotated[str, Field(max_length=300)]
    intent: Literal["patient", "physio"]  # Google sign-in is for patients; "physio" is refused


class GoogleTotpIn(BaseModel):
    pending_token: str
    code: Annotated[str, Field(pattern=r"^\d{6}$")]
