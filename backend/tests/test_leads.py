"""Home page "Become a pilot clinic" form → Super Admin Records. Opt-in (PNX_INTEGRATION=1), rolled back."""

import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(os.getenv("PNX_INTEGRATION") != "1", reason="set PNX_INTEGRATION=1 to run")


@pytest.fixture
def env(monkeypatch):
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.core.security import create_access_token
    from app.db.session import engine, get_db
    from app.main import app
    from app.models import User
    from app.models.user import UserRole
    from app.routers import platform

    mails: list[tuple] = []
    monkeypatch.setattr(platform, "send_email", lambda to, subject, text, html=None: mails.append((to, subject, text)))
    conn = engine.connect()
    outer = conn.begin()
    db = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False)
    admin = User(full_name="PNX TEST Admin", email=f"pnx-lead-{uuid.uuid4().hex[:8]}@test.physionexs.com", role=UserRole.SUPER_ADMIN, totp_enabled=True)
    db.add(admin)
    db.flush()
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app), {"Authorization": f"Bearer {create_access_token(admin.id, admin.role.value)}"}, mails
    finally:
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        conn.close()


def test_pilot_lead(env):
    c, ah, mails = env
    phone = "98" + str(uuid.uuid4().int)[:8]
    lead = {"clinic_name": "PNX TEST Knee Clinic", "contact_name": "Dr. Test", "city": "Nashik", "phone": phone,
            "email": "pnx-lead@example.com", "knee_patients_per_month": "10-30", "message": "Keen to try the check-ins"}
    assert c.post("/platform/pilot-leads", json=lead).status_code == 201
    assert len(mails) == 1 and "PNX TEST Knee Clinic, Nashik" in mails[0][1] and "10-30" in mails[0][2]

    # Duplicate within a day, a bot (hidden field filled) and bad input: nothing new saved or sent.
    assert c.post("/platform/pilot-leads", json=lead).status_code == 201
    assert c.post("/platform/pilot-leads", json=lead | {"phone": "9811111111", "email": None, "website": "http://spam"}).status_code == 201
    assert c.post("/platform/pilot-leads", json=lead | {"phone": "12"}).status_code == 422
    assert c.post("/platform/pilot-leads", json=lead | {"knee_patients_per_month": "lots"}).status_code == 422
    assert len(mails) == 1

    # The Super Admin sees it in Records and marks it contacted.
    rows = c.get("/admin/records/pilot_leads", headers=ah, params={"q": "PNX TEST Knee"}).json()["rows"]
    assert len(rows) == 1 and rows[0]["phone"] == "+91" + phone and rows[0]["status"] == "new"
    assert c.post(f"/admin/records/pilot_leads/{rows[0]['id']}/action", headers=ah, json={"action": "mark_contacted"}).status_code == 200
    assert c.get("/admin/records/pilot_leads", headers=ah, params={"q": "PNX TEST Knee"}).json()["rows"][0]["status"] == "contacted"
