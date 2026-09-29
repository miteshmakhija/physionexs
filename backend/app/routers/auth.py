import html
import uuid
from datetime import UTC, datetime, timedelta

import jwt

from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.deps import DB, CurrentUser
from app.core.phone import normalize_phone
from app.core.security import (
    create_purpose_token,
    decode_purpose_token,
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
from app.models.user import OtpPurpose, OtpRequest, RefreshToken, User, UserRole
from app.schemas.auth import (
    ForgotPasswordIn,
    ForgotPasswordOut,
    GoogleIn,
    GoogleTotpIn,
    LoginIn,
    MeOut,
    OtpRequestIn,
    OtpRequestOut,
    OtpVerifyIn,
    PatientRegisterIn,
    PhysioRegisterIn,
    RefreshIn,
    ResetLinkIn,
    ResetPasswordIn,
    TokenOut,
    TotpCodeIn,
    TotpSetupOut,
)
from app.services import audit, google, msg91
from app.services import email as mailer
from app.services.settings import get_setting
from app.services.auth import REFRESH_COOKIE, build_me, clear_refresh_cookie, issue_tokens, unique_slug

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

OTP_WINDOW = timedelta(minutes=10)
OTP_MAX_PER_WINDOW = 3
TRIAL_DAYS = 14
# Phone one-time codes are switched off for everyone for now; staff sign in with email too. Flip to re-enable for staff.
STAFF_PHONE_SIGN_IN = False
PHONE_SIGN_IN_OFF = "Mobile number sign-in is no longer available. Please sign in with your email address."
PATIENT_ON_CLINIC_PAGE = "This email is registered as a patient. Please sign in on the patient portal, or use a different email for your physiotherapist account."
CLINIC_ON_PATIENT_PAGE = "This email belongs to a clinic account. Please sign in on the practice console."


# ── Phone OTP (clinic staff only) ───────────────────────────────────────────


@router.post("/otp/request", response_model=OtpRequestOut)
def request_otp(body: OtpRequestIn, db: DB) -> OtpRequestOut:
    if not STAFF_PHONE_SIGN_IN or body.intent != "staff":
        raise HTTPException(status.HTTP_403_FORBIDDEN, PHONE_SIGN_IN_OFF)
    now = datetime.now(UTC)
    recent = db.scalar(
        select(func.count()).select_from(OtpRequest).where(
            OtpRequest.destination == body.phone, OtpRequest.purpose == OtpPurpose.LOGIN, OtpRequest.created_at > now - OTP_WINDOW
        )
    )
    if recent >= OTP_MAX_PER_WINDOW:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many codes requested. Try again in a few minutes.")

    staff = db.scalar(select(User).where(User.phone == body.phone))
    if staff is None or staff.role != UserRole.STAFF or not staff.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This number isn't registered by a clinic. Ask your clinic to add you from Staff management.")

    code = generate_otp(settings.otp_length)
    db.add(
        OtpRequest(
            destination=body.phone,
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
    if not STAFF_PHONE_SIGN_IN or body.intent != "staff":
        raise HTTPException(status.HTTP_403_FORBIDDEN, PHONE_SIGN_IN_OFF)
    now = datetime.now(UTC)
    otp = db.scalar(
        select(OtpRequest)
        .where(OtpRequest.destination == body.phone, OtpRequest.purpose == OtpPurpose.LOGIN, OtpRequest.consumed_at.is_(None), OtpRequest.expires_at > now)
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
    if user is None or user.role != UserRole.STAFF:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This number isn't registered by a clinic. Ask your clinic to add you from Staff management.")
    otp.consumed_at = now
    if not user.is_active:
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")

    audit.record(db, action="login", entity="user", entity_id=user.id, actor_user_id=user.id, summary="OTP login", request=request)
    return issue_tokens(db, user, request, response)


# ── Registration ────────────────────────────────────────────────────────────


@router.post("/register/patient", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register_patient(body: PatientRegisterIn, db: DB, request: Request, response: Response) -> TokenOut:
    _ensure_unique(db, phone=body.phone, email=body.email, signing_up_as=UserRole.PATIENT)
    user = _create_patient_user(db, full_name=body.full_name, phone=body.phone, email=body.email, password=body.password)
    audit.record(db, action="register", entity="user", entity_id=user.id, actor_user_id=user.id, summary="Patient signed up", request=request)
    return issue_tokens(db, user, request, response)


@router.post("/register/physio", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register_physio(body: PhysioRegisterIn, db: DB, request: Request, response: Response) -> TokenOut:
    """Creates the physio, their clinic (they are the owner), a main branch and a 14-day PMS trial.

    The public profile stays hidden until a Super Admin verifies the council registration.
    """
    email = body.email.lower()
    _ensure_unique(db, phone=body.phone, email=email, signing_up_as=UserRole.PHYSIO)
    user = User(
        full_name=body.full_name,
        phone=body.phone,
        email=email,
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
    pricing = get_setting(db, "pms_pricing")
    commission = body.plan == SubscriptionPlan.COMMISSION
    clinic = Clinic(
        name=body.clinic_name, slug=unique_slug(db, body.clinic_name), owner_user_id=user.id, phone=body.phone,
        # Subscription plans pay no fee on app bookings; "pay per booking" pays a percentage instead.
        platform_fee_bps=int(pricing.get("commission_bps", 300)) if commission else 0,
    )
    db.add(clinic)
    db.flush()
    branch = Branch(clinic_id=clinic.id, name=body.clinic_name, city=body.city, lead_user_id=user.id)
    db.add(branch)
    db.flush()
    db.add(ClinicMember(clinic_id=clinic.id, user_id=user.id, branch_id=branch.id, role=MembershipRole.OWNER, job_title="Physiotherapist"))
    now = datetime.now(UTC)
    trial = timedelta(days=int(pricing.get("trial_days", TRIAL_DAYS)))
    if commission:
        db.add(Subscription(clinic_id=clinic.id, plan=body.plan, price_paise=0, status=SubscriptionStatus.ACTIVE))
    else:
        db.add(
            Subscription(
                clinic_id=clinic.id,
                plan=body.plan,
                price_paise=int(pricing["monthly_paise"] if body.plan == SubscriptionPlan.MONTHLY else pricing["yearly_paise"]),
                status=SubscriptionStatus.TRIAL,
                trial_ends_at=now + trial,
                current_period_end=now + trial,
            )
        )
    audit.record(db, action="register", entity="user", entity_id=user.id, actor_user_id=user.id, clinic_id=clinic.id, summary=f"Physio signed up · {body.clinic_name}", request=request)
    return issue_tokens(db, user, request, response)


# ── Password login ──────────────────────────────────────────────────────────


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: DB, request: Request, response: Response) -> TokenOut:
    if "@" not in body.identifier:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, PHONE_SIGN_IN_OFF)
    user = _find_by_identifier(db, body.identifier)
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    # Checked after the password so the page can't be used to learn which role an email has.
    if body.intent == "clinic" and user.role == UserRole.PATIENT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, PATIENT_ON_CLINIC_PAGE)
    if body.intent == "patient" and user.role != UserRole.PATIENT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, CLINIC_ON_PATIENT_PAGE)
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


# ── Forgot password ─────────────────────────────────────────────────────────

RESET_TTL = timedelta(minutes=15)


def _reset_destination(identifier: str) -> tuple[str, str]:
    """(normalised destination, channel) for an email or phone identifier."""
    identifier = identifier.strip()
    if "@" in identifier:
        return identifier.lower(), "email"
    try:
        return normalize_phone(identifier), "sms"
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter your email or mobile number")


@router.post("/password/forgot", response_model=ForgotPasswordOut)
def forgot_password(body: ForgotPasswordIn, db: DB, request: Request) -> ForgotPasswordOut:
    """Send a 6-digit reset code. The response is the same whether or not the account exists."""
    destination, channel = _reset_destination(body.identifier)
    now = datetime.now(UTC)
    recent = db.scalar(
        select(func.count()).select_from(OtpRequest).where(
            OtpRequest.destination == destination, OtpRequest.purpose == OtpPurpose.PASSWORD_RESET, OtpRequest.created_at > now - OTP_WINDOW
        )
    )
    if recent >= OTP_MAX_PER_WINDOW:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Try again in a few minutes.")
    out = ForgotPasswordOut(channel=channel, expires_in=int(RESET_TTL.total_seconds()))
    user = _find_by_identifier(db, destination)
    if user is None or not user.is_active or user.role == UserRole.SUPER_ADMIN:
        return out  # same answer either way, so this can't be used to discover accounts

    code = generate_otp(6)
    otp = OtpRequest(destination=destination, purpose=OtpPurpose.PASSWORD_RESET, code_hash=hash_otp(destination, code), expires_at=now + RESET_TTL)
    db.add(otp)
    audit.record(db, action="password_reset_requested", entity="user", entity_id=user.id, actor_user_id=user.id, request=request)
    db.commit()
    try:
        if channel == "email":
            _send_reset_email(user, destination, code)
        else:
            msg91.send_otp(destination, code)
    except (mailer.EmailError, msg91.SmsError):
        # Nothing reached the person, so this attempt shouldn't count toward the 3-per-10-minutes limit.
        db.delete(otp)
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "We couldn't send the email just now. Please try again in a minute.")
    return out


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(body: ResetPasswordIn, db: DB, request: Request) -> Response:
    destination, _ = _reset_destination(body.identifier)
    now = datetime.now(UTC)
    otp = db.scalar(
        select(OtpRequest)
        .where(OtpRequest.destination == destination, OtpRequest.purpose == OtpPurpose.PASSWORD_RESET,
               OtpRequest.consumed_at.is_(None), OtpRequest.expires_at > now)
        .order_by(OtpRequest.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if otp is None or otp.attempts >= settings.otp_max_attempts:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code expired. Request a new one.")
    if otp.code_hash != hash_otp(destination, body.code):
        otp.attempts += 1
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Incorrect code")
    user = _find_by_identifier(db, destination)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code expired. Request a new one.")
    otp.consumed_at = now
    user.password_hash = hash_password(body.new_password)
    for token in db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))):
        token.revoked_at = now  # sign out every existing session
    audit.record(db, action="password_reset", entity="user", entity_id=user.id, actor_user_id=user.id, request=request)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _password_fingerprint(user: User) -> str:
    """Changes whenever the password does, so a reset link works once."""
    return sha256(user.password_hash or f"none:{user.id}")[:16]


def _send_reset_email(user: User, to: str, code: str) -> None:
    token = create_purpose_token("password_reset", {"uid": str(user.id), "pw": _password_fingerprint(user)}, minutes=int(RESET_TTL.total_seconds() // 60))
    link = f"{settings.web_url.rstrip('/')}/reset-password?token={token}"
    first = user.full_name.split()[0]
    text = (
        f"Hi {first},\n\n"
        f"Choose a new Physionexs password here:\n{link}\n\n"
        f"Or enter this code in the app: {code}\n\n"
        "The link and the code work once and expire in 15 minutes. If you didn't ask to reset your password, ignore this email."
    )
    body = f"""<div style="font-family:Arial,sans-serif;font-size:15px;color:#141414;max-width:480px">
<p>Hi {html.escape(first)},</p>
<p>Tap the button to choose a new Physionexs password.</p>
<p><a href="{html.escape(link)}" style="display:inline-block;background:#141414;color:#ffffff;padding:12px 22px;text-decoration:none;font-weight:bold;letter-spacing:1px">RESET PASSWORD</a></p>
<p style="color:#555">Or enter this code in the app: <b style="color:#141414;letter-spacing:2px">{code}</b></p>
<p style="color:#555">The link and the code work once and expire in 15 minutes. If you didn't ask to reset your password, you can ignore this email.</p>
</div>"""
    mailer.send_email(to, "Reset your Physionexs password", text, body)


@router.post("/password/reset-link", status_code=status.HTTP_204_NO_CONTENT)
def reset_password_with_link(body: ResetLinkIn, db: DB, request: Request) -> Response:
    """Set a new password from the emailed link."""
    try:
        claims = decode_purpose_token(body.token, "password_reset")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link has expired. Request a new one.")
    user = db.get(User, uuid.UUID(claims["uid"]))
    if user is None or not user.is_active or user.role == UserRole.SUPER_ADMIN or claims.get("pw") != _password_fingerprint(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link has already been used or has expired. Request a new one.")
    now = datetime.now(UTC)
    user.password_hash = hash_password(body.new_password)
    for token in db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))):
        token.revoked_at = now  # sign out every existing session
    for otp in db.scalars(select(OtpRequest).where(OtpRequest.purpose == OtpPurpose.PASSWORD_RESET, OtpRequest.consumed_at.is_(None),
                                                   OtpRequest.destination.in_([d for d in (user.email, user.phone) if d]))):
        otp.consumed_at = now  # the emailed code dies with the link
    audit.record(db, action="password_reset", entity="user", entity_id=user.id, actor_user_id=user.id, summary="via email link", request=request)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Google sign-in ──────────────────────────────────────────────────────────


@router.post("/google", response_model=TokenOut)
def google_sign_in(body: GoogleIn, db: DB, request: Request, response: Response) -> TokenOut:
    """Exchange a Google authorization code. Google sign-in is for patients; they're created on first sign-in."""
    if body.intent != "patient":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Physiotherapists sign in with their email and password")
    try:
        who = google.identity_from_code(body.code, body.redirect_uri)
    except google.GoogleAuthError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    user = db.scalar(select(User).where(User.google_sub == who.sub)) or db.scalar(select(User).where(func.lower(User.email) == who.email))
    if user is None:
        user = _create_patient_user(db, full_name=who.name, email=who.email)
        user.google_sub = who.sub
        user.avatar_url = who.picture
        audit.record(db, action="register", entity="user", entity_id=user.id, actor_user_id=user.id, summary="Patient signed up with Google", request=request)
    else:
        if user.role == UserRole.SUPER_ADMIN:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Super Admin signs in with a password")
        if not user.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
        if user.role != UserRole.PATIENT:
            raise HTTPException(status.HTTP_409_CONFLICT, CLINIC_ON_PATIENT_PAGE)
        if user.google_sub is None:
            user.google_sub = who.sub  # link on first Google sign-in (Google has verified the email)
        if user.totp_enabled:
            db.commit()
            token = create_purpose_token("totp_pending", {"uid": str(user.id)}, minutes=5)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, {"code": "totp_required", "pending_token": token})
    audit.record(db, action="login", entity="user", entity_id=user.id, actor_user_id=user.id, summary="Google sign-in", request=request)
    return issue_tokens(db, user, request, response)


@router.post("/google/totp", response_model=TokenOut)
def google_totp(body: GoogleTotpIn, db: DB, request: Request, response: Response) -> TokenOut:
    try:
        claims = decode_purpose_token(body.pending_token, "totp_pending")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sign-in expired — continue with Google again")
    user = db.get(User, uuid.UUID(claims["uid"]))
    if user is None or not user.is_active or not verify_totp(user.totp_secret, body.code):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect authentication code")
    audit.record(db, action="login", entity="user", entity_id=user.id, actor_user_id=user.id, summary="Google sign-in + 2FA", request=request)
    return issue_tokens(db, user, request, response)


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


def _ensure_unique(db: DB, *, phone: str | None, email: str | None, signing_up_as: UserRole) -> None:
    """One email (and one mobile) per account, so a patient's email can't also become a physio login, or vice versa."""
    if email and (taken := db.scalar(select(User.role).where(func.lower(User.email) == email.lower()))):
        raise HTTPException(status.HTTP_409_CONFLICT, _taken_message("email", taken, signing_up_as))
    if phone and (taken := db.scalar(select(User.role).where(User.phone == phone))):
        raise HTTPException(status.HTTP_409_CONFLICT, _taken_message("mobile number", taken, signing_up_as))


def _taken_message(what: str, taken: UserRole, signing_up_as: UserRole) -> str:
    if signing_up_as == UserRole.PHYSIO and taken == UserRole.PATIENT:
        return f"This {what} is already registered as a patient. Please use a different {what} for your physiotherapist account."
    if signing_up_as == UserRole.PATIENT and taken != UserRole.PATIENT:
        return f"This {what} belongs to a clinic account. Please use a different {what} for your patient account."
    return f"An account with this {what} already exists. Please sign in instead."


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
