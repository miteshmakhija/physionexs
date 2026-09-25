from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select

from app.core.config import get_settings
from app.core.deps import DB, CurrentUser
from app.core.phone import normalize_phone
from app.core.security import (
    generate_otp,
    hash_otp,
    hash_password,
    new_totp_secret,
    sha256,
    totp_uri,
    verify_password,
    verify_totp,
)
from app.models.clinic import (
    Branch,
    Clinic,
    ClinicMember,
    MembershipRole,
    PhysioProfile,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
)
from app.models.patient import Patient
from app.models.user import OtpRequest, RefreshToken, User, UserRole
from app.schemas.auth import (
    LoginIn,
    MeOut,
    OtpRequestIn,
    OtpRequestOut,
    OtpVerifyIn,
    PatientRegisterIn,
    PhysioRegisterIn,
    RefreshIn,
    TokenOut,
    TotpCodeIn,
    TotpSetupOut,
)
from app.services import audit, msg91
from app.services.auth import REFRESH_COOKIE, build_me, clear_refresh_cookie, issue_tokens, unique_slug

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

OTP_WINDOW = timedelta(minutes=10)
OTP_MAX_PER_WINDOW = 3
TRIAL_DAYS = 14
# Roles that must sign in with password (+ TOTP), never OTP alone.
PASSWORD_ONLY_ROLES = {UserRole.PHYSIO, UserRole.SUPER_ADMIN}


# ── Phone OTP (patients & staff) ────────────────────────────────────────────


@router.post("/otp/request", response_model=OtpRequestOut)
def request_otp(body: OtpRequestIn, db: DB) -> OtpRequestOut:
    now = datetime.now(UTC)
    recent = db.scalar(
        select(func.count()).select_from(OtpRequest).where(
            OtpRequest.phone == body.phone, OtpRequest.created_at > now - OTP_WINDOW
        )
    )
    if recent >= OTP_MAX_PER_WINDOW:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many codes requested. Try again in a few minutes.")

    code = generate_otp(settings.otp_length)
    db.add(
        OtpRequest(
            phone=body.phone,
            code_hash=hash_otp(body.phone, code),
            expires_at=now + timedelta(seconds=settings.otp_ttl_seconds),
        )
    )
    db.commit()
    try:
        msg91.send_otp(body.phone, code)
    except msg91.SmsError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not send the code. Please try again.")
    return OtpRequestOut(expires_in=settings.otp_ttl_seconds)


@router.post("/otp/verify", response_model=TokenOut)
def verify_otp(body: OtpVerifyIn, db: DB, request: Request, response: Response) -> TokenOut:
    now = datetime.now(UTC)
    otp = db.scalar(
        select(OtpRequest)
        .where(OtpRequest.phone == body.phone, OtpRequest.consumed_at.is_(None), OtpRequest.expires_at > now)
        .order_by(OtpRequest.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if otp is None or otp.attempts >= settings.otp_max_attempts:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code expired. Request a new one.")
    if otp.code_hash != hash_otp(body.phone, body.code):
        otp.attempts += 1
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Incorrect code")
    user = db.scalar(select(User).where(User.phone == body.phone))
    if user is None and not body.full_name:
        # New number: the code stays valid so the client can ask for a name and resubmit it.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "full_name_required")
    otp.consumed_at = now

    if user is None:
        user = _create_patient_user(db, full_name=body.full_name, phone=body.phone)
        audit.record(db, action="register", entity="user", entity_id=user.id, actor_user_id=user.id, summary="Patient signed up with OTP", request=request)
    elif user.role in PASSWORD_ONLY_ROLES:
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please sign in with your password")
    elif not user.is_active:
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")

    audit.record(db, action="login", entity="user", entity_id=user.id, actor_user_id=user.id, summary="OTP login", request=request)
    return issue_tokens(db, user, request, response)


# ── Registration ────────────────────────────────────────────────────────────


@router.post("/register/patient", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register_patient(body: PatientRegisterIn, db: DB, request: Request, response: Response) -> TokenOut:
    _ensure_unique(db, phone=body.phone, email=body.email)
    user = _create_patient_user(db, full_name=body.full_name, phone=body.phone, email=body.email, password=body.password)
    audit.record(db, action="register", entity="user", entity_id=user.id, actor_user_id=user.id, summary="Patient signed up", request=request)
    return issue_tokens(db, user, request, response)


@router.post("/register/physio", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register_physio(body: PhysioRegisterIn, db: DB, request: Request, response: Response) -> TokenOut:
    """Creates the physio, their clinic (they are the owner), a main branch and a 14-day PMS trial.

    The public profile stays hidden until a Super Admin verifies the council registration.
    """
    _ensure_unique(db, phone=body.phone, email=body.email)
    user = User(
        full_name=body.full_name,
        phone=body.phone,
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        role=UserRole.PHYSIO,
    )
    db.add(user)
    db.flush()
    db.add(
        PhysioProfile(
            user_id=user.id,
            registration_no=body.registration_no.strip(),
            council=body.council,
            qualification=body.qualification,
        )
    )
    clinic = Clinic(name=body.clinic_name, slug=unique_slug(db, body.clinic_name), owner_user_id=user.id, phone=body.phone)
    db.add(clinic)
    db.flush()
    branch = Branch(clinic_id=clinic.id, name=body.clinic_name, city=body.city, lead_user_id=user.id)
    db.add(branch)
    db.flush()
    db.add(ClinicMember(clinic_id=clinic.id, user_id=user.id, branch_id=branch.id, role=MembershipRole.OWNER, job_title="Physiotherapist"))
    now = datetime.now(UTC)
    db.add(
        Subscription(
            clinic_id=clinic.id,
            plan=body.plan,
            price_paise=50_000 if body.plan == SubscriptionPlan.MONTHLY else 500_000,
            status=SubscriptionStatus.TRIAL,
            trial_ends_at=now + timedelta(days=TRIAL_DAYS),
            current_period_end=now + timedelta(days=TRIAL_DAYS),
        )
    )
    audit.record(db, action="register", entity="user", entity_id=user.id, actor_user_id=user.id, clinic_id=clinic.id, summary=f"Physio signed up · {body.clinic_name}", request=request)
    return issue_tokens(db, user, request, response)


# ── Password login ──────────────────────────────────────────────────────────


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: DB, request: Request, response: Response) -> TokenOut:
    user = _find_by_identifier(db, body.identifier)
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email/phone or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    if user.totp_enabled:
        if not body.totp_code:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "totp_required")
        if not verify_totp(user.totp_secret, body.totp_code):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect authentication code")
    audit.record(db, action="login", entity="user", entity_id=user.id, actor_user_id=user.id, summary="Password login", request=request)
    return issue_tokens(db, user, request, response)


# ── Session ─────────────────────────────────────────────────────────────────


@router.post("/refresh", response_model=TokenOut)
def refresh(
    db: DB,
    request: Request,
    response: Response,
    body: RefreshIn | None = None,
    cookie_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> TokenOut:
    raw = (body.refresh_token if body else None) or cookie_token
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No session")
    token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256(raw)).with_for_update())
    now = datetime.now(UTC)
    if token is None or token.revoked_at is not None or token.expires_at <= now:
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    user = db.get(User, token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled")
    token.revoked_at = now  # rotate: each refresh token works once
    return issue_tokens(db, user, request, response)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    db: DB,
    response: Response,
    body: RefreshIn | None = None,
    cookie_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> Response:
    raw = (body.refresh_token if body else None) or cookie_token
    if raw:
        token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256(raw)))
        if token and token.revoked_at is None:
            token.revoked_at = datetime.now(UTC)
            db.commit()
    response.status_code = status.HTTP_204_NO_CONTENT
    clear_refresh_cookie(response)
    return response


@router.get("/me", response_model=MeOut)
def me(user: CurrentUser, db: DB) -> MeOut:
    return build_me(db, user)


# ── Two-factor (TOTP) ───────────────────────────────────────────────────────


@router.post("/totp/setup", response_model=TotpSetupOut)
def totp_setup(user: CurrentUser, db: DB) -> TotpSetupOut:
    if user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor is already enabled")
    user.totp_secret = new_totp_secret()
    db.commit()
    return TotpSetupOut(secret=user.totp_secret, otpauth_uri=totp_uri(user.totp_secret, user.email or user.phone or str(user.id)))


@router.post("/totp/enable", response_model=MeOut)
def totp_enable(body: TotpCodeIn, user: CurrentUser, db: DB, request: Request) -> MeOut:
    if not verify_totp(user.totp_secret, body.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Incorrect code")
    user.totp_enabled = True
    audit.record(db, action="enable_2fa", entity="user", entity_id=user.id, actor_user_id=user.id, request=request)
    db.commit()
    return build_me(db, user)


# ── helpers ─────────────────────────────────────────────────────────────────


def _find_by_identifier(db: DB, identifier: str) -> User | None:
    identifier = identifier.strip()
    if "@" in identifier:
        return db.scalar(select(User).where(func.lower(User.email) == identifier.lower()))
    try:
        phone = normalize_phone(identifier)
    except ValueError:
        return None
    return db.scalar(select(User).where(User.phone == phone))


def _ensure_unique(db: DB, *, phone: str | None, email: str | None) -> None:
    conditions = []
    if phone:
        conditions.append(User.phone == phone)
    if email:
        conditions.append(func.lower(User.email) == email.lower())
    if conditions and db.scalar(select(User.id).where(or_(*conditions))):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this phone or email already exists")


def _create_patient_user(
    db: DB, *, full_name: str, phone: str | None = None, email: str | None = None, password: str | None = None
) -> User:
    user = User(
        full_name=full_name,
        phone=phone,
        email=email.lower() if email else None,
        password_hash=hash_password(password) if password else None,
        role=UserRole.PATIENT,
    )
    db.add(user)
    db.flush()
    # Link an existing walk-in record (registered at reception) with the same phone, if any.
    patient = db.scalar(select(Patient).where(Patient.phone == phone, Patient.user_id.is_(None))) if phone else None
    if patient:
        patient.user_id = user.id
    else:
        db.add(Patient(user_id=user.id, full_name=full_name, phone=phone, email=user.email))
    return user
