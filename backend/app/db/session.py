from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

settings = get_settings()

# Serverless functions are short-lived and Neon's pooler (PgBouncer) already pools
# connections, so we don't keep a client-side pool.
engine = create_engine(settings.sqlalchemy_url, poolclass=NullPool, pool_pre_ping=False)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db
