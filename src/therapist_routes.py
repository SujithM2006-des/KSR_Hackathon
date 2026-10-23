"""
ReHabRep - Therapist self-registration and own verification status.

  GET   /config/registration          professions + issuing bodies for the form (configurable)
  POST  /auth/register-therapist      create account (status PENDING) + upload one credential document
  GET   /therapist/verification       my verification status and the reason of the last decision
  POST  /therapist/verification       resubmit details / a new document (after rejection, or while pending)

Credential documents
  - PDF, JPG or PNG only, at most 5 MB, checked by content (not just the file name)
  - stored ENCRYPTED on disk under a random name; only admins can download them
"""

import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session as DbSession

from crud import create_therapist, get_user_by_email, log_action, save_credential_document
from database import get_db
from models import User
from security import require_therapist_any, therapist_status_out

router = APIRouter()

PROFESSIONS = ["PHYSIOTHERAPIST", "DOCTOR"]
# Configurable: set REHABREP_ISSUING_BODIES="A;B;C" to change. Confirm the exact list with a domain expert.
DEFAULT_ISSUING_BODIES = [
    "State Physiotherapy Council",
    "Indian Association of Physiotherapists (IAP)",
    "National Commission for Allied and Healthcare Professions (NCAHP)",
    "State Medical Council",
    "National Medical Commission (NMC)",
    "Other (explain in workplace field)",
]
MAX_DOC_BYTES = 5 * 1024 * 1024
ALLOWED_TYPES = {
    "application/pdf": b"%PDF",
    "image/png": b"\x89PNG",
    "image/jpeg": b"\xff\xd8\xff",
}
MIN_PASSWORD = 8


def issuing_bodies():
    env = os.getenv("REHABREP_ISSUING_BODIES")
    if env:
        return [b.strip() for b in env.split(";") if b.strip()]
    return DEFAULT_ISSUING_BODIES


async def read_document(document: UploadFile):
    """Validate type, size and file signature. Returns (bytes, content_type)."""
    content_type = (document.content_type or "").lower()
    if content_type == "image/jpg":
        content_type = "image/jpeg"
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Document must be a PDF, JPG or PNG file")
    data = await document.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The uploaded document is empty")
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Document is larger than 5 MB")
    if not data.startswith(ALLOWED_TYPES[content_type]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File content does not match its type (PDF, JPG or PNG)")
    return data, content_type


def clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


@router.get("/config/registration")
def registration_config():
    return {
        "professions": PROFESSIONS,
        "issuing_bodies": issuing_bodies(),
        "max_document_mb": MAX_DOC_BYTES // (1024 * 1024),
        "allowed_document_types": ["PDF", "JPG", "PNG"],
        "min_password_length": MIN_PASSWORD,
    }


@router.post("/auth/register-therapist", status_code=201)
async def register_therapist(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    profession: str = Form(...),
    registration_number: str = Form(...),
    issuing_body: str = Form(...),
    workplace: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    document: UploadFile = File(...),
    db: DbSession = Depends(get_db),
):
    name, email = clean(name), clean(email)
    registration_number, issuing_body = clean(registration_number), clean(issuing_body)
    if not name or len(name) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please enter your full name")
    if not email or "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please enter a valid email")
    if len(password or "") < MIN_PASSWORD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Password must be at least {MIN_PASSWORD} characters")
    if profession not in PROFESSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Profession must be PHYSIOTHERAPIST or DOCTOR")
    if not registration_number:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Registration number is required")
    if not issuing_body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Issuing body is required")
    if get_user_by_email(db, email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    data, content_type = await read_document(document)

    user = create_therapist(
        db,
        name,
        email,
        password,
        profession,
        registration_number,
        issuing_body,
        workplace=clean(workplace),
        phone=clean(phone),
        status="PENDING",
    )
    save_credential_document(db, user.therapist_profile, document.filename, content_type, data)
    log_action(db, user.id, "THERAPIST_REGISTERED", "USER", user.id, None)
    return {"message": "Registration received. You can log in; patient features unlock after an admin approves you."}


@router.get("/therapist/verification")
def my_verification(user: User = Depends(require_therapist_any)):
    return therapist_status_out(user.therapist_profile)


@router.post("/therapist/verification")
async def resubmit_verification(
    registration_number: Optional[str] = Form(None),
    issuing_body: Optional[str] = Form(None),
    workplace: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    document: Optional[UploadFile] = File(None),
    user: User = Depends(require_therapist_any),
    db: DbSession = Depends(get_db),
):
    profile = user.therapist_profile
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No therapist profile")
    if profile.status == "APPROVED":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You are already verified")

    if clean(registration_number):
        profile.registration_number = clean(registration_number)
    if clean(issuing_body):
        profile.issuing_body = clean(issuing_body)
    if workplace is not None:
        profile.workplace = clean(workplace)
    if phone is not None:
        profile.phone = clean(phone)

    if document is not None and document.filename:
        data, content_type = await read_document(document)
        save_credential_document(db, profile, document.filename, content_type, data)
    elif profile.status == "REJECTED" and not profile.document_file:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please upload a credential document")

    # The previous decision reason stays visible until the admin decides again
    profile.status = "PENDING"
    profile.submitted_at = datetime.utcnow()
    db.commit()
    log_action(db, user.id, "THERAPIST_RESUBMITTED", "USER", user.id, None)
    db.refresh(user)
    return therapist_status_out(user.therapist_profile)