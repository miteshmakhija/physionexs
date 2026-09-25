import uuid

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.platform import AuditLog


def record(
    db: Session,
    *,
    action: str,
    entity: str,
    entity_id: uuid.UUID | str | None = None,
    actor_user_id: uuid.UUID | None = None,
    clinic_id: uuid.UUID | None = None,
    summary: str | None = None,
    changes: dict | None = None,
    request: Request | None = None,
) -> None:
    """Add an audit row to the current transaction (committed with the change it describes)."""
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            clinic_id=clinic_id,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id else None,
            summary=summary,
            changes=changes or {},
            ip=_client_ip(request) if request else None,
        )
    )


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:45]
    return request.client.host if request.client else None
