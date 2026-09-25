"""Admin commands.

    python -m app.cli create-admin --name "Aditya Kulkarni" --email admin@physionexs.com --phone 9800000000
    python -m app.cli seed-settings
"""

import argparse
import getpass
import sys

from sqlalchemy import select

from app.core.phone import normalize_phone
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.platform import PlatformSetting
from app.models.user import User, UserRole

DEFAULT_SETTINGS: dict[str, dict] = {
    "rewards": {"tiers": [{"days": 7, "points": 50}, {"days": 14, "points": 100}, {"days": 21, "points": 150}], "paise_per_point": 100},
    "support": {"helpline": "+91 80 4711 2200", "email": "contact@physionexs.com"},
    "reminders": {"appointment_hours_before": [24, 2]},
    "pms_pricing": {"monthly_paise": 50_000, "yearly_paise": 500_000, "trial_days": 14},
    "platform_fee": {"default_bps": 1000, "allowed_bps": [1000, 1500]},
}


def create_admin(name: str, email: str, phone: str | None) -> None:
    password = getpass.getpass("Password (min 12 chars): ")
    if len(password) < 12 or password != getpass.getpass("Repeat password: "):
        sys.exit("Passwords must match and be at least 12 characters.")
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.email == email.lower())):
            sys.exit(f"A user with {email} already exists.")
        user = User(
            full_name=name,
            email=email.lower(),
            phone=normalize_phone(phone) if phone else None,
            password_hash=hash_password(password),
            role=UserRole.SUPER_ADMIN,
        )
        db.add(user)
        db.commit()
        print(f"Super Admin created: {user.id}. Sign in and enable two-factor authentication.")


def seed_settings() -> None:
    with SessionLocal() as db:
        for key, value in DEFAULT_SETTINGS.items():
            if db.get(PlatformSetting, key) is None:
                db.add(PlatformSetting(key=key, value=value))
                print(f"+ {key}")
        db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    admin = sub.add_parser("create-admin")
    admin.add_argument("--name", required=True)
    admin.add_argument("--email", required=True)
    admin.add_argument("--phone")
    sub.add_parser("seed-settings")
    args = parser.parse_args()

    if args.cmd == "create-admin":
        create_admin(args.name, args.email, args.phone)
    elif args.cmd == "seed-settings":
        seed_settings()


if __name__ == "__main__":
    main()
