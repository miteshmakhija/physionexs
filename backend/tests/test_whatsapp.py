"""WhatsApp check-ins (design C): the conversation, webhook parsing/signatures, and the full loop.

Unit tests always run. The end-to-end test is opt-in (PNX_INTEGRATION=1), uses the "log" provider (nothing is sent)
and runs inside a transaction that's rolled back, so it leaves nothing behind.
"""

import hashlib
import hmac
import json
import os
import uuid

import pytest

from app.services.whatsapp_flow import INVITE, Reply, handle, prompt, score
from app.services.whatsapp_provider import parse_webhook, verify_signature

# ── Conversation (pure) ─────────────────────────────────────────────────────


def run(replies: list[Reply]) -> tuple[str, dict]:
    step, answers = "invite", {}
    for r in replies:
        step, answers, _ = handle(step, answers, r)
    return step, answers


def test_full_conversation_by_taps_and_typing():
    step, a = run([Reply(choice="start"), Reply(text="6"), Reply(text=" 4/10 "), Reply(choice="mild"), Reply(text="Okay"),
                   Reply(choice="all"), Reply(choice="no")])
    assert step == "done" and a == {"pain": 6, "stiffness": 4, "swelling": "mild", "sleep": "ok", "exercises": "all", "red_flags": []}
    step, a = run([Reply(text="hi"), Reply(text="3"), Reply(text="2"), Reply(text="none"), Reply(choice="good"), Reply(text="some"),
                   Reply(choice="yes"), Reply(choice="fever")])
    assert step == "done" and a["red_flags"] == ["fever"] and a["swelling"] == "none"


def test_bad_answers_repeat_the_question():
    assert handle("pain", {}, Reply(text="eleven"))[0] == "pain"
    assert handle("pain", {}, Reply(text="11"))[2][0].body.startswith("Please reply with a single number")
    assert handle("sleep", {}, Reply(text="meh"))[:2] == ("sleep", {})
    assert handle("red_which", {}, Reply(text="fever"))[0] == "red_which"  # must pick from the list
    assert handle("invite", {}, Reply(text="what?"))[2] == [INVITE]
    assert handle("invite", {}, Reply(choice="skip"))[0] == "skipped"
    assert [score(t) for t in ["0", "10", "7/10", "7.", "-1", "5 or 6", ""]] == [0, 10, 7, 7, None, None, None]


def test_messages_fit_whatsapp_limits():
    for step in ["pain", "stiffness", "swelling", "sleep", "exercises", "red", "red_which"]:
        m = prompt(step)
        assert len(m.body) <= 1024
        if m.kind == "buttons":
            assert len(m.options) <= 3 and all(len(t) <= 20 for _, t, _ in m.options)
        if m.kind == "list":
            assert len(m.options) <= 10 and all(len(t) <= 24 and (d is None or len(d) <= 72) for _, t, d in m.options) and len(m.button) <= 20


# ── Webhooks ────────────────────────────────────────────────────────────────


def envelope(*messages: dict) -> dict:
    return {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {"messages": list(messages), "statuses": [{"id": "x", "status": "read"}]}}]}]}


def test_parse_webhook():
    msgs = parse_webhook(envelope(
        {"id": "a", "from": "919812345678", "type": "text", "text": {"body": "7"}},
        {"id": "b", "from": "919812345678", "type": "interactive", "interactive": {"type": "button_reply", "button_reply": {"id": "good", "title": "Well"}}},
        {"id": "c", "from": "919812345678", "type": "interactive", "interactive": {"type": "list_reply", "list_reply": {"id": "mild", "title": "Mild"}}},
        {"id": "d", "from": "919812345678", "type": "button", "button": {"text": "Start", "payload": "start"}},
        {"id": "e", "from": "919812345678", "type": "image", "image": {}},
    ))
    assert [(m.provider_id, m.phone, m.choice, m.text) for m in msgs] == [
        ("a", "+919812345678", None, "7"), ("b", "+919812345678", "good", None), ("c", "+919812345678", "mild", None), ("d", "+919812345678", "start", None)]
    assert parse_webhook({}) == []


def test_signature(monkeypatch):
    from app.services import whatsapp_provider as wp

    monkeypatch.setattr(wp.settings, "whatsapp_provider", "meta")
    monkeypatch.setattr(wp.settings, "whatsapp_app_secret", "s3cret")
    body = b'{"entry":[]}'
    good = "sha256=" + hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()
    assert verify_signature(body, good)
    assert not verify_signature(body + b" ", good) and not verify_signature(body, None) and not verify_signature(body, "sha256=00")


# ── End to end (rolled back) ────────────────────────────────────────────────


@pytest.fixture
def env(monkeypatch):
    if os.getenv("PNX_INTEGRATION") != "1":
        pytest.skip("set PNX_INTEGRATION=1 to run")
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.core.config import get_settings
    from app.core.security import create_access_token
    from app.db.session import engine, get_db
    from app.main import app
    from app.models import Clinic, ClinicMember, ClinicPatient, Patient, User
    from app.models.clinic import MembershipRole
    from app.models.user import UserRole
    from app.services import whatsapp_provider

    monkeypatch.setattr(get_settings(), "whatsapp_provider", "log")
    whatsapp_provider.SENT.clear()
    conn = engine.connect()
    outer = conn.begin()
    db = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    physio = User(full_name="PNX TEST Physio", email=f"pnx-wa-{tag}@test.physionexs.com", role=UserRole.PHYSIO)
    pu = User(full_name="PNX TEST Asha Rao", email=f"pnx-wa-pt-{tag}@test.physionexs.com", role=UserRole.PATIENT)
    db.add_all([physio, pu])
    db.flush()
    clinic = Clinic(name="PNX TEST Knee Clinic", slug=f"pnx-wa-{tag}", owner_user_id=physio.id, phone="+912000000000", twin_pilot=True)
    db.add(clinic)
    db.flush()
    db.add(ClinicMember(clinic_id=clinic.id, user_id=physio.id, role=MembershipRole.OWNER))
    phone = "+9190" + str(uuid.uuid4().int)[:8]
    patient = Patient(full_name="PNX TEST Asha Rao", user_id=pu.id, phone=phone)
    db.add(patient)
    db.flush()
    cp = ClinicPatient(clinic_id=clinic.id, patient_id=patient.id)
    db.add(cp)
    db.flush()
    app.dependency_overrides[get_db] = lambda: db
    h = {"Authorization": f"Bearer {create_access_token(physio.id, physio.role.value)}", "X-Clinic-Id": str(clinic.id)}
    ph = {"Authorization": f"Bearer {create_access_token(pu.id, pu.role.value)}"}
    try:
        yield TestClient(app), h, ph, str(cp.id), phone, db
    finally:
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        conn.close()


def test_whatsapp_checkin_loop(env):
    from sqlalchemy import select

    from app.models import DailyCheckin, Patient
    from app.services.whatsapp import send_daily_invites
    from app.services.whatsapp_provider import SENT

    c, h, ph, cp_id, phone, db = env
    digits = phone.lstrip("+")
    n = iter(range(1000))

    def say(**m):
        msg = {"id": f"wamid.{uuid.uuid4().hex}-{next(n)}", "from": digits} | m
        r = c.post("/webhooks/whatsapp", content=json.dumps(envelope(msg)), headers={"Content-Type": "application/json"})
        assert r.status_code == 200, r.text
        return msg["id"]

    def last_text():
        p = SENT[-1]
        return p["text"]["body"] if p["type"] == "text" else p["interactive"]["body"]["text"]

    # Not opted in yet: nothing is sent in the morning, and messages get a pointer to the app.
    c.post(f"/clinic/patients/{cp_id}/care-plans", headers=h, json={"condition": "Right TKA", "protocol": "tka", "affected_side": "right"})
    state = c.get("/me/checkin", headers=ph).json()
    assert state["whatsapp"]["consent"]["granted"] is False and state["whatsapp"]["phone"].endswith(phone[-5:])
    assert send_daily_invites(db) == 0
    say(type="text", text={"body": "hi"})
    assert "turn on WhatsApp check-ins in the Physionexs app" in last_text()

    # Opt in (check-in sharing + WhatsApp); the morning invite goes out once, with only the first name.
    for purpose in ("twin_tracking", "whatsapp"):
        version = c.get("/me/checkin", headers=ph).json()["consent" if purpose == "twin_tracking" else "whatsapp"]
        version = version["version"] if purpose == "twin_tracking" else version["consent"]["version"]
        assert c.post("/me/consents", headers=ph, json={"purpose": purpose, "version": version}).status_code == 201
    assert send_daily_invites(db) == 1 and send_daily_invites(db) == 0
    invite = SENT[-1]
    assert invite["type"] == "template" and invite["to"] == digits
    assert invite["template"]["components"][0]["parameters"] == [{"type": "text", "text": "PNX"}]

    # The conversation, with a red flag: saved as a WhatsApp check-in, advice with the clinic's number, flag raised.
    say(type="button", button={"text": "Start", "payload": "start"})
    assert "pain" in last_text()
    say(type="text", text={"body": "seven"})
    assert last_text().startswith("Please reply with a single number")
    for m in [dict(type="text", text={"body": "7"}), dict(type="text", text={"body": "5"}),
              dict(type="interactive", interactive={"type": "list_reply", "list_reply": {"id": "moderate", "title": "Moderate"}}),
              dict(type="interactive", interactive={"type": "button_reply", "button_reply": {"id": "poor", "title": "Poorly"}}),
              dict(type="interactive", interactive={"type": "button_reply", "button_reply": {"id": "some", "title": "Some"}}),
              dict(type="interactive", interactive={"type": "button_reply", "button_reply": {"id": "yes", "title": "Yes"}})]:
        say(**m)
    assert SENT[-1]["interactive"]["type"] == "list" and len(SENT[-1]["interactive"]["action"]["sections"][0]["rows"]) == 4
    last_id = say(type="interactive", interactive={"type": "list_reply", "list_reply": {"id": "fever", "title": "Fever or chills"}})
    assert last_text().startswith("Contact your clinic now") and "+912000000000" in last_text()
    pid = db.scalar(select(Patient.id).where(Patient.phone == phone))
    ck = db.scalar(select(DailyCheckin).where(DailyCheckin.patient_id == pid))
    assert (ck.source.value, ck.pain, ck.stiffness, ck.swelling.value, ck.sleep.value, ck.exercises.value, ck.red_flags) == (
        "whatsapp", 7, 5, "moderate", "poor", "some", ["fever"])
    assert any(f["rule"] == "red_flag" for f in c.get("/clinic/flags", headers=h).json())

    # A webhook retry changes nothing; writing again today says they're done.
    sent = len(SENT)
    c.post("/webhooks/whatsapp", content=json.dumps(envelope({"id": last_id, "from": digits, "type": "text", "text": {"body": "x"}})),
           headers={"Content-Type": "application/json"})
    assert len(SENT) == sent
    say(type="text", text={"body": "hello"})
    assert "already checked in today" in last_text()

    # STOP turns it off (no more invites); START turns it back on.
    say(type="text", text={"body": "STOP"})
    assert c.get("/me/checkin", headers=ph).json()["whatsapp"]["consent"]["granted"] is False
    say(type="text", text={"body": "start"})
    assert "back on" in last_text() and c.get("/me/checkin", headers=ph).json()["whatsapp"]["consent"]["granted"] is True

    # Unknown numbers are told so; Meta's handshake needs the verify token.
    c.post("/webhooks/whatsapp", content=json.dumps(envelope({"id": "wamid.unknown", "from": "910000000000", "type": "text", "text": {"body": "hi"}})),
           headers={"Content-Type": "application/json"})
    assert "isn't linked" in last_text()
    assert c.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42"}).status_code == 403
