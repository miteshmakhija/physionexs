"""Mobile push notifications through Expo's push service.

Every `Notification` row saved in a transaction is pushed to the user's registered devices *after* the transaction
commits (a rolled-back change never sends a push), so existing code that adds notifications needs no changes.

Lock screens are public: for health-related kinds the push says only that there's an update; the details stay in the
app's notification feed.
"""

import logging

import httpx
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.engagement import Notification
from app.models.user import DeviceToken

log = logging.getLogger(__name__)
EXPO_URL = "https://exp.host/--/api/v2/push/send"
PENDING = "pnx_pending_push"

# Kinds whose title/body may contain health details: shown generically on the lock screen.
PRIVATE = {
    "plan_updated": ("Your physio updated your plan", "Open Physionexs to see what's changed."),
    "red_flag": ("A patient reported a warning sign", "Open Physionexs to review it."),
}


def push_text(n: Notification) -> tuple[str, str]:
    return PRIVATE.get(n.kind, (n.title, n.body or "Open Physionexs for details."))


def _post_expo(messages: list[dict]) -> list[dict]:
    """Send up to 100 messages; returns Expo's per-message tickets. Best effort: failures are logged."""
    headers = {"Accept": "application/json"}
    if token := get_settings().expo_access_token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        r = httpx.post(EXPO_URL, json=messages, headers=headers, timeout=10)
        return (r.json() or {}).get("data") or []
    except (httpx.HTTPError, ValueError):
        log.exception("Expo push failed")
        return []


def send(db_factory, messages: list[dict]) -> None:
    """Push, then forget tokens Expo says are no longer registered (app uninstalled)."""
    dead = []
    for i in range(0, len(messages), 100):
        batch = messages[i:i + 100]
        for m, ticket in zip(batch, _post_expo(batch)):
            if ticket.get("status") == "error" and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                dead.append(m["to"])
    if dead and db_factory:
        with db_factory() as db:
            db.execute(delete(DeviceToken).where(DeviceToken.expo_token.in_(dead)))
            db.commit()


def messages_for(db: Session, notes: list[Notification]) -> list[dict]:
    tokens: dict = {}
    for user_id, token in db.execute(select(DeviceToken.user_id, DeviceToken.expo_token).where(DeviceToken.user_id.in_({n.user_id for n in notes}))):
        tokens.setdefault(user_id, []).append(token)
    out = []
    for n in notes:
        title, body = push_text(n)
        for t in tokens.get(n.user_id, []):
            out.append({"to": t, "title": title, "body": body, "sound": "default", "data": {"kind": n.kind, "notification_id": str(n.id)} | (n.data or {})})
    return out


FLUSHED = "pnx_flushed_notifications"


@event.listens_for(Session, "after_flush")
def _remember(session: Session, _ctx) -> None:
    # In after_flush, session.new still lists what this flush inserted.
    flushed = [o for o in session.new if isinstance(o, Notification)]
    if flushed:
        session.info.setdefault(FLUSHED, []).extend(flushed)


@event.listens_for(Session, "before_commit")
def _collect(session: Session) -> None:
    if not session.info.get(FLUSHED) and not any(isinstance(o, Notification) for o in session.new):
        return
    session.flush()  # everything pending is now in FLUSHED, with ids
    notes = session.info.pop(FLUSHED, [])
    session.info[PENDING] = session.info.get(PENDING, []) + messages_for(session, notes)


@event.listens_for(Session, "after_commit")
def _send(session: Session) -> None:
    messages = session.info.pop(PENDING, [])
    if messages:
        from app.db.session import SessionLocal

        send(SessionLocal, messages)


@event.listens_for(Session, "after_rollback")
def _discard(session: Session) -> None:
    session.info.pop(PENDING, None)
    session.info.pop(FLUSHED, None)
