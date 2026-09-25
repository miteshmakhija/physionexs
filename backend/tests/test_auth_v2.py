"""Email sign-up, forgot/reset password, Google sign-in (Google itself is stubbed).

Opt-in (writes to the configured database, cleans up afterwards):
    PNX_INTEGRATION=1 python -m pytest tests/test_auth_v2.py
"""

import os
import re

import pytest
from sqlalchemy import select

pytestmark = pytest.mark.skipif(os.getenv("PNX_INTEGRATION") != "1", reason="set PNX_INTEGRATION=1 to run")

EMAIL = "patient-v2@demo.physionexs.com"
PHONE = "+919000000991"
PHYSIO_PHONE = "+919000000992"


@pytest.fixture(scope="module")
def env():
    from fastapi.testclient import TestClient

    from app.db.session import SessionLocal
    from app.devtools import purge_demo, purge_users
    from app.main import app
    from app.models import User
    from app.routers import auth as auth_router
    from app.services import google

    sent: dict[str, str] = {}
    orig_mail, orig_sms, orig_google = auth_router.mailer.send_email, auth_router.msg91.send_otp, google.identity_from_code
    auth_router.mailer.send_email = lambda to, subject, text, html=None: sent.__setitem__(to, re.search(r"\b(\d{6})\b", text).group(1))
    auth_router.msg91.send_otp = lambda phone, code: sent.__setitem__(phone, code)
    identities: dict[str, google.GoogleIdentity] = {}
    google.identity_from_code = lambda code, redirect_uri: identities[code]
    with SessionLocal() as db:
        purge_demo(db)
    yield {"c": TestClient(app), "sent": sent, "identities": identities, "GoogleIdentity": google.GoogleIdentity}
    auth_router.mailer.send_email, auth_router.msg91.send_otp, google.identity_from_code = orig_mail, orig_sms, orig_google
    with SessionLocal() as db:
        phones = [PHONE, PHYSIO_PHONE]
        purge_users(db, list(db.scalars(select(User.id).where(User.phone.in_(phones)))), phones)
        purge_demo(db)


def test_patient_email_signup_and_password_reset(env):
    c, sent = env["c"], env["sent"]
    reg = c.post("/auth/register/patient", json={"full_name": "Asha Patel", "email": EMAIL, "password": "first-password-1"})
    assert reg.status_code == 201, reg.text
    old_refresh = reg.json()["refresh_token"]
    assert c.post("/auth/login", json={"identifier": EMAIL.upper(), "password": "first-password-1"}).status_code == 200

    # Unknown accounts get the same answer (no account discovery).
    assert c.post("/auth/password/forgot", json={"identifier": "nobody@demo.physionexs.com"}).json()["channel"] == "email"
    assert "nobody@demo.physionexs.com" not in sent

    r = c.post("/auth/password/forgot", json={"identifier": EMAIL})
    assert r.status_code == 200 and r.json()["channel"] == "email"
    code = sent[EMAIL]
    wrong = "000000" if code != "000000" else "111111"
    assert c.post("/auth/password/reset", json={"identifier": EMAIL, "code": wrong, "new_password": "second-password-2"}).status_code == 400
    assert c.post("/auth/password/reset", json={"identifier": EMAIL, "code": code, "new_password": "second-password-2"}).status_code == 204
    assert c.post("/auth/password/reset", json={"identifier": EMAIL, "code": code, "new_password": "third-password-3"}).status_code == 400  # single use
    assert c.post("/auth/refresh", json={"refresh_token": old_refresh}).status_code == 401  # old sessions signed out
    assert c.post("/auth/login", json={"identifier": EMAIL, "password": "first-password-1"}).status_code == 401
    assert c.post("/auth/login", json={"identifier": EMAIL, "password": "second-password-2"}).status_code == 200


def test_reset_by_phone(env):
    c, sent = env["c"], env["sent"]
    c.post("/auth/register/patient", json={"full_name": "Ravi Kumar", "phone": PHONE, "password": "phone-password-1"})
    assert c.post("/auth/password/forgot", json={"identifier": "90000 00991"}).json()["channel"] == "sms"
    assert c.post("/auth/password/reset", json={"identifier": PHONE, "code": sent[PHONE], "new_password": "phone-password-2"}).status_code == 204
    assert c.post("/auth/login", json={"identifier": PHONE, "password": "phone-password-2"}).status_code == 200


def test_google_is_for_patients_only(env):
    c, ids, G = env["c"], env["identities"], env["GoogleIdentity"]
    uri = "http://localhost:5173/auth/google/callback"
    ids["patient-code-0001"] = G(sub="g-patient-1", email="gpatient@demo.physionexs.com", name="Neha Gupta", picture=None)
    first = c.post("/auth/google", json={"code": "patient-code-0001", "redirect_uri": uri, "intent": "patient"})
    assert first.status_code == 200 and first.json()["user"]["role"] == "patient" and first.json()["user"]["patient_id"]
    again = c.post("/auth/google", json={"code": "patient-code-0001", "redirect_uri": uri, "intent": "patient"}).json()
    assert again["user"]["id"] == first.json()["user"]["id"]
    assert c.post("/auth/google", json={"code": "patient-code-0001", "redirect_uri": uri, "intent": "physio"}).status_code == 400

    # A physio's email can't be used to sign in with Google as a patient.
    reg = c.post("/auth/register/physio", json={"full_name": "Dr. Kiran Rao", "email": "gphysio@demo.physionexs.com", "phone": PHYSIO_PHONE,
                                                "password": "physio-password-1", "registration_no": "IAP-DEMO-G1", "council": "IAP",
                                                "qualification": "MPT", "clinic_name": "Rao Physio", "city": "Pune"})
    assert reg.status_code == 201, reg.text
    ids["physio-code-0001"] = G(sub="g-physio-1", email="gphysio@demo.physionexs.com", name="Dr. Kiran Rao", picture=None)
    assert c.post("/auth/google", json={"code": "physio-code-0001", "redirect_uri": uri, "intent": "patient"}).status_code == 409

    # Registration needs every field, including council and qualification.
    missing = c.post("/auth/register/physio", json={"full_name": "Dr. X", "email": "x@demo.physionexs.com", "phone": "+919000000993", "password": "physio-password-1",
                                                    "registration_no": "IAP-X", "clinic_name": "X Clinic", "city": "Pune"})
    assert missing.status_code == 422
