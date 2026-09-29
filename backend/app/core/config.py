from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Physionexs API"
    environment: Literal["development", "test", "production"] = "development"

    # Neon pooled connection string (postgresql://...). Converted to the psycopg driver internally.
    database_url: str
    # Optional direct (non-pooled) URL for migrations. Falls back to database_url.
    database_url_direct: str | None = None

    jwt_secret: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    cors_origins: list[str] = [
        "https://physionexs.com",
        "https://www.physionexs.com",
        "http://localhost:5173",
    ]
    # Cookie domain for the web refresh token (".physionexs.com" in production, None locally).
    cookie_domain: str | None = None

    # MSG91 — OTP over SMS
    msg91_auth_key: str | None = None
    msg91_otp_template_id: str | None = None
    otp_length: int = 6
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5

    # Razorpay
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None

    # Google sign-in (OAuth 2.0 web client)
    google_client_id: str | None = None
    google_client_secret: str | None = None
    # Redirect URIs the web app may use; each must also be listed in Google Cloud Console.
    google_redirect_uris: list[str] = [
        "https://physionexs.com/auth/google/callback",
        "https://www.physionexs.com/auth/google/callback",
        "https://physionexs-web.vercel.app/auth/google/callback",
        "http://localhost:5173/auth/google/callback",
    ]

    # Transactional email (password resets). SMTP (e.g. Google Workspace: smtp.gmail.com, the mailbox address and an
    # app password) is used when set, else Resend. With neither, dev logs the message and production refuses.
    smtp_host: str | None = None
    smtp_port: int = 587  # STARTTLS; 465 = implicit TLS
    smtp_user: str | None = None
    smtp_password: str | None = None
    resend_api_key: str | None = None
    email_from: str = "Physionexs <no-reply@physionexs.com>"  # with Gmail SMTP, use the mailbox (or one of its aliases)

    # The website, for links in emails (password reset).
    web_url: str = "https://physionexs.com"

    # Vercel Cron authenticates with "Authorization: Bearer <CRON_SECRET>".
    cron_secret: str | None = None

    # WhatsApp check-ins (docs/digital-twin/C-whatsapp-checkins.md). Off unless a provider is set:
    # "meta" = WhatsApp Cloud API; "log" = development only, messages are logged instead of sent.
    whatsapp_provider: str | None = None
    whatsapp_token: str | None = None
    whatsapp_phone_number_id: str | None = None
    whatsapp_app_secret: str | None = None  # verifies webhook signatures
    whatsapp_verify_token: str | None = None  # Meta's webhook set-up handshake
    whatsapp_checkin_template: str = "daily_checkin"  # approved utility template: {{1}} = first name; buttons Start / Skip today
    whatsapp_template_language: str = "en"

    # AI assist for physios (Claude). Off unless set; clinics are also switched on individually by the Super Admin.
    anthropic_api_key: str | None = None

    # Expo push (mobile). Works without a token; set one if "enhanced push security" is on in the Expo project.
    expo_access_token: str | None = None

    @property
    def is_dev(self) -> bool:
        return self.environment != "production"

    @property
    def whatsapp_enabled(self) -> bool:
        if self.whatsapp_provider == "log":
            return self.is_dev
        return self.whatsapp_provider == "meta" and bool(self.whatsapp_token and self.whatsapp_phone_number_id and self.whatsapp_app_secret)

    @property
    def sqlalchemy_url(self) -> str:
        return _to_psycopg(self.database_url)

    @property
    def sqlalchemy_url_direct(self) -> str:
        return _to_psycopg(self.database_url_direct or self.database_url)


def _to_psycopg(url: str) -> str:
    for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
