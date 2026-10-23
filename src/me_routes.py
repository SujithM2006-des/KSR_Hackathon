"""
ReHabRep - Patient self-service (Phase 4): consent, safety info, today's plan, guided sessions, skips.

PUBLIC
  GET   /consent                     consent text + version (shown before the patient agrees)
  GET   /safety                      emergency number + warning signs (needs clinician review)

PATIENT
  GET   /me/consent                  current consent state + history
  POST  /me/consent                  agree (camera yes/no) to the current consent version
  POST  /me/consent/camera           allow or withdraw camera use later (Settings)
  GET   /me/today                    today's exercises, plan status, streak, 7-day adherence
  POST  /my/sessions/guided          finish an exercise WITHOUT the camera (patient-confirmed)
  POST  /my/sessions/skip            skip today (optional reason; "not well" flags it for the therapist)
  GET   /me/emergency-alert          is an emergency contact set up (masked number)
  POST  /me/emergency-alert          call + SMS the emergency contact (see alerts.py)

Patients never change prescriptions here - there is no route for it.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

import alerts
from clock import iso_utc
from consent import CONSENT_SECTIONS, CONSENT_VERSION, EMERGENCY_NUMBER, RED_FLAGS
from crud import (
    consent_history,
    find_by_request_id,
    get_active_plans,
    latest_consent,
    log_action,
    record_consent,
    save_guided_session,
    save_skip,
)
from database import get_db
from models import User
from security import require_patient, user_out
from serializers import consent_out, session_out
from today import ADHERENCE_RULE, STREAK_RULE, build_today

router = APIRouter()


class ConsentIn(BaseModel):
    version: str
    camera_allowed: bool


class CameraIn(BaseModel):
    allow: bool


class GuidedIn(BaseModel):
    plan_id: int
    sets_done: int = Field(ge=0, le=10)
    stopped: bool = False  # True = the patient pressed Stop / "I feel pain"
    pain_stop: bool = False  # True = stopped because of pain -> therapist review flag
    duration_s: Optional[float] = Field(None, ge=0, le=36000)
    client_request_id: str = Field(min_length=8, max_length=64)


class SkipIn(BaseModel):
    plan_id: Optional[int] = None  # None = skip everything scheduled today
    reason: Optional[str] = Field(None, max_length=300)
    not_well: bool = False
    client_request_id: str = Field(min_length=8, max_length=64)


def _active_item(db: DbSession, user: User, plan_id: int):
    for p in get_active_plans(db, user.patient_profile.id):
        if p.id == plan_id:
            return p
    raise HTTPException(status.HTTP_404_NOT_FOUND, "This exercise is not in your active plan")


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------
@router.get("/consent")
def consent_text():
    return {"version": CONSENT_VERSION, "sections": CONSENT_SECTIONS, "review_note": "Draft wording - to be reviewed."}


@router.get("/safety")
def safety_info():
    return {
        "emergency_number": EMERGENCY_NUMBER,
        "red_flags": RED_FLAGS,
        "stop_rule": "Stop if you feel sharp, worsening or unusual pain.",
        "not_emergency": "ReHabRep is not an emergency service. Messages are not monitored in real time.",
        "review_note": "This list must be reviewed by a clinician before real patients use the app.",
    }


# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------
@router.get("/me/consent")
def my_consent(user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    history = [
        {"action": r.action, "version": r.version, "camera_allowed": r.camera_allowed,
         "created_at": iso_utc(r.created_at)}
        for r in consent_history(db, user.id)
    ]
    return {**consent_out(latest_consent(db, user.id)), "history": history}


@router.post("/me/consent")
def give_consent(body: ConsentIn, user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    if body.version != CONSENT_VERSION:
        raise HTTPException(status.HTTP_409_CONFLICT, "The consent text has changed. Please reload and read it again.")
    action = "AGREED" if body.camera_allowed else "AGREED_NO_CAMERA"
    record_consent(db, user.id, CONSENT_VERSION, action, body.camera_allowed)
    log_action(db, user.id, "CONSENT_" + action, "USER", user.id, f"version {CONSENT_VERSION}")
    return user_out(user, db)


@router.post("/me/consent/camera")
def change_camera(body: CameraIn, user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    current = latest_consent(db, user.id)
    if current is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please read and accept the consent screen first")
    action = "CAMERA_ALLOWED" if body.allow else "CAMERA_WITHDRAWN"
    record_consent(db, user.id, current.version, action, body.allow)
    log_action(db, user.id, "CONSENT_" + action, "USER", user.id, None)
    return user_out(user, db)


# ---------------------------------------------------------------------------
# Today + sessions without the camera
# ---------------------------------------------------------------------------
@router.get("/me/today")
def my_today(user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    data = build_today(db, user.patient_profile.id)
    data["consent"] = consent_out(latest_consent(db, user.id))
    return data


@router.post("/my/sessions/guided", status_code=201)
def guided_session(body: GuidedIn, user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    existing = find_by_request_id(db, user.patient_profile.id, body.client_request_id)
    if existing is not None:  # double click / retry -> same session, no duplicate
        return session_out(existing)
    item = _active_item(db, user, body.plan_id)
    s = save_guided_session(
        db, item, body.sets_done, stopped=body.stopped, duration_s=body.duration_s,
        client_request_id=body.client_request_id, review_flag="PAIN_STOP" if body.pain_stop else None,
    )
    return session_out(s)


@router.post("/my/sessions/skip", status_code=201)
def skip_today(body: SkipIn, user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    pid = user.patient_profile.id
    if find_by_request_id(db, pid, body.client_request_id) is not None:
        return {"skipped": 0, "duplicate": True}
    if body.plan_id is not None:
        items = [_active_item(db, user, body.plan_id)]
    else:
        today = build_today(db, pid)
        ids = {i["id"] for i in today["items"] if i["today_status"] != "DONE"}
        items = [p for p in get_active_plans(db, pid) if p.id in ids]
        if not items:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing left to skip today")
    reason = (body.reason or "").strip() or None
    out = []
    for n, item in enumerate(items):
        # only the first row carries the request id (the column is unique)
        s = save_skip(db, item, reason, body.not_well, body.client_request_id if n == 0 else None)
        out.append(s.id)
    return {"skipped": len(out), "session_ids": out}


@router.get("/rules")
def rules():
    return {"streak": STREAK_RULE, "adherence": ADHERENCE_RULE}

# ---------------------------------------------------------------------------
# Emergency alert (call + SMS to the emergency contact, via Twilio)
# ---------------------------------------------------------------------------
@router.get("/me/emergency-alert")
def emergency_alert_info(user: User = Depends(require_patient)):
    s = alerts.settings()
    return {"configured": alerts.configured(s), "to": alerts.masked(s["to"]) if alerts.configured(s) else None}


@router.post("/me/emergency-alert")
def emergency_alert(user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    result = alerts.send_emergency_alert(user.id, user.name)
    if result.get("configured") and not result.get("cooldown"):
        log_action(
            db, user.id, "EMERGENCY_ALERT", "USER", user.id,
            f"call {result.get('call')}, sms {result.get('sms')} to {result.get('to')}",
        )
    return result
