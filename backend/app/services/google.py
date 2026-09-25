"""Google sign-in: exchange an OAuth authorization code and verify the ID token."""

import logging
from dataclasses import dataclass

import httpx
import jwt

from app.core.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

TOKEN_URL = "https://oauth2.googleapis.com/token"
CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("accounts.google.com", "https://accounts.google.com")
_jwks = jwt.PyJWKClient(CERTS_URL, cache_keys=True, lifespan=3600)


class GoogleAuthError(RuntimeError):
    pass


@dataclass
class GoogleIdentity:
    sub: str
    email: str
    name: str
    picture: str | None


def is_configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def identity_from_code(code: str, redirect_uri: str) -> GoogleIdentity:
    if not is_configured():
        raise GoogleAuthError("Google sign-in is not configured")
    if redirect_uri not in settings.google_redirect_uris:
        raise GoogleAuthError("Redirect URI not allowed")
    try:
        resp = httpx.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise GoogleAuthError("Could not reach Google") from exc
    if resp.status_code != 200:
        log.warning("Google token exchange failed: %s", resp.text[:300])
        raise GoogleAuthError("Google sign-in failed — please try again")
    id_token = resp.json().get("id_token")
    if not id_token:
        raise GoogleAuthError("Google didn't return an identity")
    return verify_id_token(id_token)


def verify_id_token(id_token: str) -> GoogleIdentity:
    try:
        key = _jwks.get_signing_key_from_jwt(id_token).key
        claims = jwt.decode(id_token, key, algorithms=["RS256"], audience=settings.google_client_id, issuer=ISSUERS)
    except jwt.PyJWTError as exc:
        raise GoogleAuthError("Invalid Google identity") from exc
    if not claims.get("email") or not claims.get("email_verified"):
        raise GoogleAuthError("Your Google account's email isn't verified")
    return GoogleIdentity(
        sub=str(claims["sub"]),
        email=str(claims["email"]).lower(),
        name=claims.get("name") or claims["email"].split("@")[0],
        picture=claims.get("picture"),
    )
