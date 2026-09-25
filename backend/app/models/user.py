import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models._types import str_enum


class UserRole(StrEnum):
    PATIENT = "patient"
    PHYSIO = "physio"
    STAFF = "staff"
    SUPER_ADMIN = "super_admin"


class User(UUIDPk, Timestamps, Base):
    __tablename__ = "users"

    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)  # E.164, e.g. +919812345678
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(str_enum(UserRole), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500))

    # Google account id ("sub" claim) when the user signs in with Google.
    google_sub: Mapped[str | None] = mapped_column(String(64), unique=True)

    totp_secret: Mapped[str | None] = mapped_column(String(64))
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(UUIDPk, Base):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OtpPurpose(StrEnum):
    LOGIN = "login"
    PASSWORD_RESET = "password_reset"


class OtpRequest(UUIDPk, Base):
    __tablename__ = "otp_requests"

    # E.164 phone number or lower-cased email address the code was sent to.
    destination: Mapped[str] = mapped_column(String(254), index=True)
    purpose: Mapped[OtpPurpose] = mapped_column(str_enum(OtpPurpose), default=OtpPurpose.LOGIN)
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DeviceToken(UUIDPk, Timestamps, Base):
    """Expo push tokens for the mobile app."""

    __tablename__ = "device_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expo_token: Mapped[str] = mapped_column(String(200), unique=True)
    platform: Mapped[str] = mapped_column(String(10))  # ios | android
