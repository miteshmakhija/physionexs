import pyotp
import pytest

from app.core.phone import normalize_phone
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_otp,
    hash_password,
    verify_password,
    verify_totp,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("9812345678", "+919812345678"),
        ("09812345678", "+919812345678"),
        ("+91 98123 45678", "+919812345678"),
        ("919812345678", "+919812345678"),
        ("+44 7700 900123", "+447700900123"),
    ],
)
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize("raw", ["12345", "abc", ""])
def test_normalize_phone_rejects(raw):
    with pytest.raises(ValueError):
        normalize_phone(raw)


def test_password_roundtrip():
    h = hash_password("correct horse battery")
    assert verify_password("correct horse battery", h)
    assert not verify_password("wrong", h)
    assert not verify_password("anything", None)


def test_access_token_roundtrip():
    import uuid

    uid = uuid.uuid4()
    payload = decode_access_token(create_access_token(uid, "patient"))
    assert payload["sub"] == str(uid)
    assert payload["role"] == "patient"


def test_otp_hash_is_bound_to_phone():
    assert hash_otp("+919812345678", "123456") != hash_otp("+919800000000", "123456")


def test_totp():
    secret = pyotp.random_base32()
    assert verify_totp(secret, pyotp.TOTP(secret).now())
    assert not verify_totp(secret, "000000") or pyotp.TOTP(secret).now() == "000000"
    assert not verify_totp(None, "123456")


def test_google_redirect_allowlist(monkeypatch):
    from app.services import google

    monkeypatch.setattr(google.settings, "google_client_id", "client-id")
    monkeypatch.setattr(google.settings, "google_client_secret", "client-secret")
    with pytest.raises(google.GoogleAuthError, match="Redirect URI"):
        google.identity_from_code("some-code", "https://evil.example.com/auth/google/callback")


def test_purpose_tokens_are_not_interchangeable():
    import jwt as pyjwt

    from app.core.security import create_purpose_token, decode_purpose_token

    t = create_purpose_token("google_signup", {"sub": "x"}, minutes=5)
    assert decode_purpose_token(t, "google_signup")["sub"] == "x"
    with pytest.raises(pyjwt.InvalidTokenError):
        decode_purpose_token(t, "totp_pending")
