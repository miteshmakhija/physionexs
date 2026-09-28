"""The signed-in user's notification feed and push devices (patients and clinic staff alike)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update

from app.core.deps import DB, CurrentUser
from app.models.engagement import Notification
from app.models.user import DeviceToken

router = APIRouter(prefix="/me", tags=["notifications"])


class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: str
    title: str
    body: str | None
    data: dict
    created_at: datetime
    read_at: datetime | None


class NotificationsOut(BaseModel):
    unread: int
    items: list[NotificationOut]


class ReadIn(BaseModel):
    ids: list[uuid.UUID] | None = Field(default=None, max_length=100)  # omit to mark everything read


class DeviceIn(BaseModel):
    token: Annotated[str, Field(pattern=r"^Expo(nent)?PushToken\[[^\]]{10,180}\]$")]
    platform: Literal["ios", "android"]


@router.get("/notifications", response_model=NotificationsOut)
def my_notifications(user: CurrentUser, db: DB, limit: int = 30) -> NotificationsOut:
    limit = max(1, min(limit, 100))
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(limit))
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))) or 0
    return NotificationsOut(unread=unread, items=[NotificationOut(id=n.id, kind=n.kind, title=n.title, body=n.body, data=n.data or {},
                                                                   created_at=n.created_at, read_at=n.read_at) for n in rows])


@router.post("/notifications/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(body: ReadIn, user: CurrentUser, db: DB) -> None:
    stmt = update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if body.ids is not None:
        stmt = stmt.where(Notification.id.in_(body.ids))
    db.execute(stmt.values(read_at=datetime.now(UTC)))
    db.commit()


@router.post("/devices", status_code=status.HTTP_204_NO_CONTENT)
def register_device(body: DeviceIn, user: CurrentUser, db: DB) -> None:
    """Register this phone for push. A token moves to whoever signed in on the phone most recently."""
    d = db.scalar(select(DeviceToken).where(DeviceToken.expo_token == body.token))
    if d is None:
        db.add(DeviceToken(user_id=user.id, expo_token=body.token, platform=body.platform))
    else:
        d.user_id, d.platform = user.id, body.platform
    db.commit()


@router.delete("/devices", status_code=status.HTTP_204_NO_CONTENT)
def remove_device(body: DeviceIn, user: CurrentUser, db: DB) -> None:
    """Called on sign-out, so the phone stops getting this user's notifications."""
    db.execute(delete(DeviceToken).where(DeviceToken.expo_token == body.token, DeviceToken.user_id == user.id))
    db.commit()
