import uuid
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field, model_validator

from app.core.phone import normalize_phone
from app.models.clinic import MembershipRole, SubscriptionPlan, VerificationStatus
from app.models.user import UserRole

Phone = Annotated[str, AfterValidator(normalize_phone)]
Password = Annotated[str, Field(min_length=8, max_length=128)]
Name = Annotated[str, Field(min_length=2, max_length=120)]


class OtpRequestIn(BaseModel):
    phone: Phone


class OtpRequestOut(BaseModel):
    expires_in: int


class OtpVerifyIn(BaseModel):
    phone: Phone
    code: Annotated[str, Field(pattern=r"^\d{4,8}$")]
    full_name: Name | None = None  # required the first time (new patient)


class PatientRegisterIn(BaseModel):
    full_name: Name
    phone: Phone | None = None
    email: EmailStr | None = None
    password: Password

    @model_validator(mode="after")
    def phone_or_email(self):
        if not self.phone and not self.email:
            raise ValueError("Provide a phone number or email")
        return self


class PhysioRegisterIn(BaseModel):
    full_name: Name
    email: EmailStr
    phone: Phone
    password: Password
    registration_no: Annotated[str, Field(min_length=3, max_length=60)]
    council: str | None = Field(default=None, max_length=80)
    qualification: str | None = Field(default=None, max_length=120)
    clinic_name: Annotated[str, Field(min_length=2, max_length=160)]
    city: Annotated[str, Field(min_length=2, max_length=80)]
    plan: SubscriptionPlan = SubscriptionPlan.MONTHLY


class LoginIn(BaseModel):
    identifier: Annotated[str, Field(min_length=3, max_length=254)]  # email or phone
    password: Annotated[str, Field(min_length=1, max_length=128)]
    totp_code: str | None = Field(default=None, pattern=r"^\d{6}$")


class RefreshIn(BaseModel):
    refresh_token: str | None = None  # mobile sends it; web uses the httpOnly cookie


class MembershipOut(BaseModel):
    clinic_id: uuid.UUID
    clinic_name: str
    role: MembershipRole
    branch_id: uuid.UUID | None


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
