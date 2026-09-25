from sqlalchemy.orm import Session

from app.models.platform import PlatformSetting

DEFAULT_SETTINGS: dict[str, dict] = {
    "rewards": {"tiers": [{"days": 7, "points": 50}, {"days": 14, "points": 100}, {"days": 21, "points": 150}], "paise_per_point": 100},
    "support": {
        "email": "connect@physionexs.com",
        "phone": "+91 90499 77677",
        "address": "TEN Labs Cowork, udChalo House, 10, Phoenix Boundary Road, Viman Nagar, Pune, Maharashtra 411014",
        "hours": "Monday to Saturday · 10:00 – 19:00 IST",
    },
    "reminders": {"appointment_hours_before": [24, 2]},
    "pms_pricing": {"monthly_paise": 50_000, "yearly_paise": 500_000, "trial_days": 14},
    "platform_fee": {"default_bps": 1000, "allowed_bps": [1000, 1500]},
}


def get_setting(db: Session, key: str) -> dict:
    """Platform setting edited by the Super Admin, falling back to the built-in default."""
    row = db.get(PlatformSetting, key)
    return row.value if row else DEFAULT_SETTINGS[key]


def paise_per_point(db: Session) -> int:
    return int(get_setting(db, "rewards").get("paise_per_point", 100))
