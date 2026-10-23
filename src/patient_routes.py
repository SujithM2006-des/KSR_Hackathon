"""
ReHabRep - Patients, invitations and prescriptions (Phase 3).

THERAPIST (verified only)
  POST  /patients                          add a patient; send an invitation now or save as draft
  PATCH /patients/{id}                     edit name / assessed condition / clinical notes
  POST  /patients/{id}/invitation          (re)send the invitation link - older links stop working
  GET   /patients/{id}/exercise-plans      every plan version, newest first (history is kept)
  POST  /patients/{id}/exercise-plans      save a NEW plan version (ACTIVE) or a DRAFT
  PATCH /exercise-plans/{id}               PAUSE | RESUME | END a live plan, DISCARD a draft

PUBLIC (invitation link)
  GET   /invitations/{token}               who the link is for (name, masked email, expiry)
  POST  /auth/invitations/{token}/accept   patient chooses their own password -> logged in

Rules
  - The therapist never sees or sets the patient's password.
  - Links are single-use, expire after 7 days, and only their SHA-256 is stored.
  - Editing a plan creates a new version; sessions keep pointing at the old version's rows,
    so old reports never change. Patients cannot change plans (there is no route for it).
  - No email service yet: the invitation link is printed in the backend terminal and
    returned to the therapist so they can copy it to the patient (WhatsApp, SMS, email).
"""

import os
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from clock import iso_utc
from crud import (
    accept_invitation,
    change_prescription_status,
    create_invitation,
    create_patient,
    find_invitation,
    get_user_by_email,
    list_prescriptions,
    log_action,
    save_prescription,
)
from database import get_db
from exercises import resolve_exercise
from models import Patient, Prescription, User
from security import make_token, require_therapist, user_out
from serializers import patient_summary, prescription_out

router = APIRouter()

FRONTEND_URL = os.getenv("REHABREP_FRONTEND_URL", "http://localhost:5173").rstrip("/")
SIDES = ("LEFT", "RIGHT", "BOTH")
MAX_ITEMS = 20
MIN_PASSWORD = 8
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def therapist_patient(db: DbSession, therapist: User, patient_id: int) -> Patient:
    """The patient, only if it belongs to this therapist. Another therapist's patient -> 404 (no leak)."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if patient is None or patient.therapist_id != therapist.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return patient


def invite_link(token: str) -> str:
    return f"{FRONTEND_URL}/invite/{token}"


def send_invitation(db: DbSession, therapist: User, patient: Patient) -> dict:
    token, inv = create_invitation(db, patient.user, therapist.id)
    link = invite_link(token)
    # No email provider yet: print it like an outgoing email (Appendix C default)
    print("\n[EMAIL] -------------------------------------------")
    print(f"[EMAIL] To      : {patient.user.email}")
    print(f"[EMAIL] Subject : {therapist.name} invited you to ReHabRep")
    print(f"[EMAIL] Link    : {link}   (valid until {inv.expires_at:%d %b %Y %H:%M} UTC)")
    print("[EMAIL] -------------------------------------------\n")
    log_action(db, therapist.id, "PATIENT_INVITED", "PATIENT", patient.id, None)
    return {"url": link, "expires_at": iso_utc(inv.expires_at)}


def mask_email(email: str) -> str:
    name, _, domain = (email or "").partition("@")
    if not domain:
        return "***"
    return (name[:2] + "***" if len(name) > 2 else name[:1] + "***") + "@" + domain


def clean(text: Optional[str], limit: int) -> Optional[str]:
    if text is None:
        return None
    text = text.strip()
    if len(text) > limit:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Text is longer than {limit} characters")
    return text or None


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------
class PatientIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    surgery_type: Optional[str] = None  # assessed condition entered by the therapist
    notes: Optional[str] = None
    send_invite: bool = True  # False = save as draft (no invitation yet)


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    surgery_type: Optional[str] = None
    notes: Optional[str] = None


class AcceptIn(BaseModel):
    password: str


class ItemIn(BaseModel):
    exercise_type: str
    condition: Optional[str] = None
    sets: int = Field(ge=1, le=10)
    reps_per_set: int = Field(ge=1, le=50)
    hold_s: int = Field(0, ge=0, le=120)
    rest_s: int = Field(30, ge=0, le=600)
    side: str = "BOTH"
    min_angle: float = Field(ge=0, le=180)
    max_angle: float = Field(ge=0, le=180)
    days: List[int] = [0, 1, 2, 3, 4, 5, 6]
    time_of_day: Optional[str] = None
    note: Optional[str] = None


class PrescriptionIn(BaseModel):
    status: str = "ACTIVE"  # ACTIVE = save and show to patient, DRAFT = hidden from patient
    note: Optional[str] = None
    draft_id: Optional[int] = None  # the draft being published / replaced
    items: List[ItemIn]


class PlanAction(BaseModel):
    action: str  # PAUSE | RESUME | END | DISCARD
    reason: Optional[str] = None


def validate_items(items: List[ItemIn]) -> List[dict]:
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Select at least one exercise")
    if len(items) > MAX_ITEMS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"A plan can have at most {MAX_ITEMS} exercises")
    out, seen = [], set()
    for n, it in enumerate(items, start=1):
        key = resolve_exercise(it.exercise_type)
        if key is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Exercise {n}: unknown exercise '{it.exercise_type}'")
        side = (it.side or "BOTH").upper()
        if side not in SIDES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Exercise {n}: side must be LEFT, RIGHT or BOTH")
        if (key, side) in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Exercise {n}: this exercise and side is already in the plan")
        seen.add((key, side))
        if it.min_angle >= it.max_angle:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Exercise {n}: minimum angle must be below maximum angle")
        days = sorted(set(it.days))
        if not days or any(d < 0 or d > 6 for d in days):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Exercise {n}: choose at least one day (0 = Monday ... 6 = Sunday)")
        time_of_day = (it.time_of_day or "").strip() or None
        if time_of_day and not TIME_RE.match(time_of_day):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Exercise {n}: time must look like 08:30")
        out.append(
            {
                "exercise_type": key,
                "condition": clean(it.condition, 120),
                "sets": it.sets,
                "reps_per_set": it.reps_per_set,
                "hold_s": it.hold_s,
                "rest_s": it.rest_s,
                "side": side,
                "min_angle": it.min_angle,
                "max_angle": it.max_angle,
                "days": days,
                "time_of_day": time_of_day,
                "note": clean(it.note, 300),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Patients + invitations (therapist)
# ---------------------------------------------------------------------------
@router.post("/patients", status_code=201)
def add_patient(body: PatientIn, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please enter a valid email")
    if get_user_by_email(db, email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    patient = create_patient(
        db,
        body.name.strip(),
        email,
        None,  # no password: the patient chooses it through the invitation
        therapist.id,
        surgery_type=clean(body.surgery_type, 200),
        notes=clean(body.notes, 1000),
        status="INVITED" if body.send_invite else "DRAFT",
    )
    log_action(db, therapist.id, "PATIENT_CREATED", "PATIENT", patient.id, None)
    invitation = send_invitation(db, therapist, patient) if body.send_invite else None
    db.refresh(patient)
    return {**patient_summary(db, patient), "invitation": invitation}


@router.patch("/patients/{patient_id}")
def update_patient(
    patient_id: int, body: PatientUpdate, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)
):
    patient = therapist_patient(db, therapist, patient_id)
    if body.name is not None:
        name = body.name.strip()
        if len(name) < 2:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name is too short")
        patient.user.name = name
    if body.surgery_type is not None:
        patient.surgery_type = clean(body.surgery_type, 200)
    if body.notes is not None:
        patient.notes = clean(body.notes, 1000)
    db.commit()
    log_action(db, therapist.id, "PATIENT_UPDATED", "PATIENT", patient.id, None)
    db.refresh(patient)
    return patient_summary(db, patient)


@router.post("/patients/{patient_id}/invitation")
def resend_invitation(patient_id: int, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    patient = therapist_patient(db, therapist, patient_id)
    if patient.user.status not in ("INVITED", "DRAFT"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This patient has already activated their account")
    return send_invitation(db, therapist, patient)


# ---------------------------------------------------------------------------
# Invitation link (public)
# ---------------------------------------------------------------------------
@router.get("/invitations/{token}")
def invitation_info(token: str, db: DbSession = Depends(get_db)):
    inv, problem = find_invitation(db, token)
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, problem)
    if problem:
        raise HTTPException(status.HTTP_410_GONE, problem)
    return {
        "name": inv.user.name,
        "email": mask_email(inv.user.email),
        "therapist": inv.created_by.name if inv.created_by else None,
        "expires_at": iso_utc(inv.expires_at),
        "min_password_length": MIN_PASSWORD,
    }


@router.post("/auth/invitations/{token}/accept")
def accept(token: str, body: AcceptIn, db: DbSession = Depends(get_db)):
    inv, problem = find_invitation(db, token)
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, problem)
    if problem:
        raise HTTPException(status.HTTP_410_GONE, problem)
    if len(body.password or "") < MIN_PASSWORD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Password must be at least {MIN_PASSWORD} characters")
    user = accept_invitation(db, inv, body.password)
    log_action(db, user.id, "INVITE_ACCEPTED", "USER", user.id, None)
    return {"token": make_token(user), "user": user_out(user, db)}


# ---------------------------------------------------------------------------
# Prescriptions (therapist)
# ---------------------------------------------------------------------------
def _own_prescription(db: DbSession, therapist: User, plan_id: int) -> Prescription:
    pres = db.query(Prescription).filter(Prescription.id == plan_id).first()
    if pres is None or pres.patient.therapist_id != therapist.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    return pres


@router.get("/patients/{patient_id}/exercise-plans")
def list_plans(patient_id: int, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    therapist_patient(db, therapist, patient_id)
    return [prescription_out(db, p) for p in list_prescriptions(db, patient_id)]


@router.post("/patients/{patient_id}/exercise-plans", status_code=201)
def save_plan(
    patient_id: int, body: PrescriptionIn, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)
):
    patient = therapist_patient(db, therapist, patient_id)
    status_value = (body.status or "").upper()
    if status_value not in ("ACTIVE", "DRAFT"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Status must be ACTIVE or DRAFT")
    if body.draft_id is not None:
        draft = _own_prescription(db, therapist, body.draft_id)
        if draft.patient_id != patient.id or draft.status != "DRAFT":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That draft can no longer be edited")
    items = validate_items(body.items)
    pres = save_prescription(
        db, patient.id, therapist.id, items, status=status_value, note=clean(body.note, 500), draft_id=body.draft_id
    )
    log_action(
        db, therapist.id, "PLAN_SAVED" if status_value == "ACTIVE" else "PLAN_DRAFT_SAVED", "PLAN", pres.id,
        f"Version {pres.version}, {len(items)} exercise(s)",
    )
    return prescription_out(db, pres)


@router.patch("/exercise-plans/{plan_id}")
def change_plan(plan_id: int, body: PlanAction, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    pres = _own_prescription(db, therapist, plan_id)
    action = (body.action or "").upper()
    reason = clean(body.reason, 300)
    if action in ("PAUSE", "END") and (not reason or len(reason) < 3):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please give a short reason")
    try:
        pres = change_prescription_status(db, pres, action, reason)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    names = {"PAUSE": "PLAN_PAUSED", "RESUME": "PLAN_RESUMED", "END": "PLAN_ENDED", "DISCARD": "PLAN_DRAFT_DISCARDED"}
    log_action(db, therapist.id, names[action], "PLAN", pres.id, reason)
    return prescription_out(db, pres)