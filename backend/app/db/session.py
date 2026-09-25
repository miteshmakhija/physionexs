import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

settings = get_settings()

if os.getenv("VERCEL"):
    # Serverless functions are short-lived and Neon's pooler (PgBouncer) already pools
    # connections, so we don't keep a client-side pool.
    engine = create_engine(settings.sqlalchemy_url, poolclass=NullPool)
else:
    # Long-running servers (local dev, tests): reuse connections, and check each one before use
    # so connections Neon closed while idle are replaced transparently.
    engine = create_engine(settings.sqlalchemy_url, pool_size=5, max_overflow=5, pool_pre_ping=True, pool_recycle=240)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db
