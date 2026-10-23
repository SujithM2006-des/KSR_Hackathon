"""
ReHabRep - Login tokens and role checks (shared by every API module).

Tokens
  HMAC-SHA256 signed, expire after TOKEN_HOURS. The signing secret comes from
  REHABREP_SECRET, or from secrets\\token.secret (random, created on first run).
  There is no hard-coded fallback secret.

Role checks (FastAPI dependencies)
  current_user            any logged-in, non-suspended user
  require_admin           ADMIN
  require_therapist_any   THERAPIST, verified or not (own verification pages)
  require_therapist       THERAPIST whose verification is APPROVED (patient management)
  require_patient         PATIENT
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session as DbSession

from clock import iso_utc
from crypto import KEY_DIR
from crud import latest_consent
from database import get_db
from models import User

TOKEN_HOURS = 12
TOKEN_SECRET_FILE = os.path.join(KEY_DIR, "token.secret")


def _load_token_secret() -> bytes:
    env = os.getenv("REHABREP_SECRET")
    if env:
        return env.encode()
    if os.path.isfile(TOKEN_SECRET_FILE):
        with open(TOKEN_SECRET_FILE, "rb") as f:
            return f.read().strip()
    os.makedirs(KEY_DIR, exist_ok=True)
    value = secrets.token_urlsafe(48).encode()
    with open(TOKEN_SECRET_FILE, "wb") as f:
        f.write(value)
    print(f"[SECURITY] New token secret created: {TOKEN_SECRET_FILE}")
    return value


SECRET = _load_token_secret()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(user: User) -> str:
    payload = {"uid": user.id, "role": user.role, "exp": int(time.time()) + TOKEN_HOURS * 3600}
    body = _b64(json.dumps(payload).encode())
    sig = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(token: str) -> Optional[dict]:
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if payload["exp"] < time.time():
            return None
        return payload
    except Exception:
        return None


bearer = HTTPBearer(auto_error=False)


def current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: DbSession = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    payload = read_token(creds.credentials)
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.query(User).filter(User.id == payload["uid"]).first()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    if user.status == "SUSPENDED":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account suspended. Contact the administrator.")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrators only")
    return user


def require_therapist_any(user: User = Depends(current_user)) -> User:
    if user.role != "THERAPIST":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Therapists only")
    return user


def require_therapist(user: User = Depends(require_therapist_any)) -> User:
    profile = user.therapist_profile
    if profile is None or profile.status != "APPROVED":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your professional verification is not approved yet. Patient features unlock after approval.",
        )
    return user


def require_patient(user: User = Depends(current_user)) -> User:
    if user.role != "PATIENT" or user.patient_profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Patients only")
    return user


def therapist_status_out(profile) -> Optional[dict]:
    if profile is None:
        return None
    return {
        "status": profile.status,
        "profession": profile.profession,
        "workplace": profile.workplace,
        "phone": profile.phone,
        "registration_number": profile.registration_number,
        "issuing_body": profile.issuing_body,
        "decision_reason": profile.decision_reason,
        "reviewed_at": iso_utc(profile.reviewed_at),
        "submitted_at": iso_utc(profile.submitted_at),
        "has_document": bool(profile.document_file),
        "document_name": profile.document_name,
    }


def user_out(user: User, db: DbSession = None) -> dict:
    """What the frontend needs to know about the logged-in user."""
    consent = None
    if user.role == "PATIENT" and db is not None:
        from serializers import consent_out  # local import: serializers imports crud, avoid a cycle at load

        consent = consent_out(latest_consent(db, user.id))
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "patient_id": user.patient_profile.id if user.patient_profile else None,
        "therapist": therapist_status_out(user.therapist_profile) if user.role == "THERAPIST" else None,
        "consent": consent,  # patients only: {given, camera_allowed, needs_consent, ...}
    }