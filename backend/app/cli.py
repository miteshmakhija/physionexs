"""Admin commands.

    python -m app.cli create-admin --name "Aditya Kulkarni" --email admin@physionexs.com --phone 9800000000
    python -m app.cli seed-settings
    python -m app.cli seed-demo      # 3 verified demo physios in Pune (dev only)
    python -m app.cli purge-demo
    python -m app.cli seed-exercises  # starter library, status "in review" until a physio publishes each
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
from app.services.settings import DEFAULT_SETTINGS


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
    sub.add_parser("seed-demo")
    sub.add_parser("purge-demo")
    seed_ex = sub.add_parser("seed-exercises")
    seed_ex.add_argument("--publish", action="store_true", help="dev only: publish immediately, skipping clinical review")
    args = parser.parse_args()

    if args.cmd == "create-admin":
        create_admin(args.name, args.email, args.phone)
    elif args.cmd == "seed-settings":
        seed_settings()
    elif args.cmd == "seed-exercises":
        from app.core.config import get_settings
        from app.seed.loader import seed_exercises

        if args.publish and not get_settings().is_dev:
            sys.exit("--publish is only for development; publish reviewed exercises from Super Admin.")
        with SessionLocal() as db:
            n = seed_exercises(db, publish=args.publish)
        print(f"Added {n} starter exercises ({'published' if args.publish else 'in review'}).")
    elif args.cmd in ("seed-demo", "purge-demo"):
        from app.core.config import get_settings
        from app.devtools import DEMO_PASSWORD, purge_demo, seed_demo

        if not get_settings().is_dev:
            sys.exit("Demo data is only for development.")
        with SessionLocal() as db:
            if args.cmd == "seed-demo":
                users = seed_demo(db)
                print(f"Created {len(users)} demo physios (password: {DEMO_PASSWORD}).")
            else:
                print(f"Removed {purge_demo(db)} demo users.")


if __name__ == "__main__":
    main()
