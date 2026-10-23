"""
ReHabRep - Backend API (FastAPI).

Run from D:\\PROJECT\\KSR (venv active):
    uvicorn api:app --reload --app-dir src

Interactive docs: http://127.0.0.1:8000/docs

GENERAL
  POST  /auth/login                      -> token (suspended accounts are refused)
  GET   /me                              who am I (role, status, therapist verification)
  GET   /exercises                       exercise library (names, camera view, default ranges)
  GET   /health                          is the API up (used by the Integration Status page)

THERAPIST REGISTRATION / VERIFICATION   -> therapist_routes.py
ADMIN                                   -> admin_routes.py
ADD PATIENT, INVITATIONS, PRESCRIPTIONS -> patient_routes.py
CONSENT, SAFETY, TODAY, GUIDED / SKIP   -> me_routes.py

THERAPIST (verified only)
  GET   /patients                        patient list + adherence badge + pain flag
  GET   /patients/{id}                   profile + active plan items
  GET   /patients/{id}/sessions          session history (adherence reports)
  GET   /patients/{id}/trend             data for progress charts
  GET   /sessions/{id}                   one report with every rep

PATIENT
  GET   /my/plans                        active plan items (with days, time, side, scheduled_today)
  GET   /my/sessions/input?plan_id=     test video or live camera for that exercise
  POST  /my/sessions/start               opens the camera exercise window (needs camera consent)
  GET   /my/sessions                     my past sessions
  PATCH /sessions/{id}/pain              pain check-in (0-10) + optional note after a session
"""

import os
import secrets
import subprocess
import sys
from datetime import datetime
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

import admin_routes
import exercise_routes
import me_routes
import patient_routes
import therapist_routes
from crud import get_active_plans, migrate_legacy_documents, get_sessions, get_user_by_email, latest_consent, verify_password
from database import PROJECT_ROOT, SessionLocal, get_db, init_db
from exercises import exercise_list, load_custom_exercises
from models import Patient, Session, User
from patient_routes import therapist_patient
from security import current_user, make_token, require_patient, require_therapist, user_out
from serializers import exercise_info, patient_summary, plan_out, session_out

SRC_DIR = os.path.dirname(os.path.abspath(__file__))
# Default input for a tracked session. "video" plays the recorded test video for the exercise
# (for testing/demo); "camera" uses the live webcam. Switch with REHABREP_INPUT=camera.
# In video mode the patient can still pick the live webcam per session (StartIn.use_camera).
INPUT_MODE = os.getenv("REHABREP_INPUT", "video").strip().lower()
CAMERA_INDEX = os.getenv("REHABREP_CAMERA_INDEX", "0")
# The running session shows its video in the web page (session_runner --stream-port).
STREAM_PORT = int(os.getenv("REHABREP_STREAM_PORT", "8765"))
STREAM_HOST = os.getenv("REHABREP_STREAM_HOST", "127.0.0.1")  # 0.0.0.0 to watch from a phone on the hotspot
_runner = {"proc": None}  # the one session running on this computer
TEST_VIDEOS = {  # exercise key -> recorded test video in videos/
    "mini_squat": "squat_test.mp4",
    "seated_knee_extension": "knee_ext_1.mp4",
    "seated_knee_flexion": "knee_flex_1.mp4",
    "hamstring_curl": "ham_curl_1.mp4",
    "hip_flexion": "hip_flex_1.mp4",
    "hip_abduction": "hip_abd_1.mp4",
    "shoulder_flexion": "shoulder_flex_1.mp4",
    "shoulder_abduction": "shoulder_abd_1.mp4",
    "elbow_flexion": "elbow_flex_1.mp4",
}
FRONTEND_ORIGINS = os.getenv(
    "REHABREP_FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
).split(",")
# The frontend opened from a phone on the same private network (home Wi-Fi or the laptop's hotspot,
# e.g. http://192.168.137.1:5173). Private address ranges only - never public internet addresses.
LAN_ORIGIN_REGEX = r"http://(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):5173"

app = FastAPI(title="ReHabRep API", version="1.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in FRONTEND_ORIGINS if o.strip()],
    allow_origin_regex=LAN_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(therapist_routes.router)
app.include_router(admin_routes.router)
app.include_router(patient_routes.router)
app.include_router(me_routes.router)
app.include_router(exercise_routes.router)


@app.on_event("startup")
def on_startup():
    init_db()
    db = SessionLocal()
    try:
        migrate_legacy_documents(db)  # older single certificates -> credential_documents
        load_custom_exercises(db)  # therapist-added exercises join the library
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------
class LoginIn(BaseModel):
    email: str
    password: str


class StartIn(BaseModel):
    plan_id: int
    use_camera: bool = False  # True = live webcam even while test videos are the default


class PainIn(BaseModel):
    pain_score: Optional[int] = Field(None, ge=0, le=10)  # None = skipped the pain question
    note: Optional[str] = Field(None, max_length=500)


# ---------------------------------------------------------------------------
# Routes - general
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    return {"app": "ReHabRep API", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat(timespec="seconds")}


@app.post("/auth/login")
def login(body: LoginIn, db: DbSession = Depends(get_db)):
    user = get_user_by_email(db, body.email)
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Wrong email or password. New patients: open the invitation link from your therapist first.",
        )
    if user.status == "SUSPENDED":
        reason = f" Reason: {user.status_reason}" if user.status_reason else ""
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"This account is suspended.{reason}")
    return {"token": make_token(user), "user": user_out(user, db)}


@app.get("/me")
def me(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    return user_out(user, db)


@app.get("/exercises")
def exercises():
    return exercise_list()


# ---------------------------------------------------------------------------
# Routes - therapist (verified)
# ---------------------------------------------------------------------------
@app.get("/patients")
def list_patients(therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    patients = db.query(Patient).filter(Patient.therapist_id == therapist.id).order_by(Patient.id).all()
    return [patient_summary(db, p) for p in patients]


@app.get("/patients/{patient_id}")
def get_patient(patient_id: int, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    return patient_summary(db, therapist_patient(db, therapist, patient_id))


@app.get("/patients/{patient_id}/sessions")
def patient_sessions(patient_id: int, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    therapist_patient(db, therapist, patient_id)
    return [session_out(s) for s in get_sessions(db, patient_id)]


@app.get("/patients/{patient_id}/trend")
def patient_trend(patient_id: int, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    therapist_patient(db, therapist, patient_id)
    # oldest first; only camera-measured sessions have angles to chart
    sessions = [s for s in reversed(get_sessions(db, patient_id)) if s.max_angle_reached is not None]
    return [
        {
            "session_id": s.id,
            **exercise_info(s.plan.exercise_type if s.plan else "mini_squat"),
            "date": s.ended_at.strftime("%d %b %H:%M") if s.ended_at else "",
            "max_angle": s.max_angle_reached,
            "avg_peak_angle": s.avg_peak_angle,
            "accuracy_pct": s.accuracy_pct,
            "adherence_pct": s.adherence_pct,
            "pain_score": s.pain_score,
            "target_min": s.min_angle,
            "target_max": s.max_angle,
        }
        for s in sessions
    ]


@app.get("/sessions/{session_id}")
def session_detail(session_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    s = db.query(Session).filter(Session.id == session_id).first()
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    is_owner_therapist = (
        user.role == "THERAPIST"
        and s.patient.therapist_id == user.id
        and user.therapist_profile is not None
        and user.therapist_profile.status == "APPROVED"
    )
    is_owner_patient = user.role == "PATIENT" and user.patient_profile and user.patient_profile.id == s.patient_id
    if not (is_owner_therapist or is_owner_patient):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return session_out(s, with_reps=True)


# ---------------------------------------------------------------------------
# Routes - patient
# ---------------------------------------------------------------------------
@app.get("/my/plans")
def my_plans(user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    return [plan_out(p) for p in get_active_plans(db, user.patient_profile.id)]


@app.get("/my/sessions")
def my_sessions(user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    return [session_out(s) for s in get_sessions(db, user.patient_profile.id)]


def session_input(plan, use_camera=False):
    """Where the tracked session reads frames from: {"mode", "source", "video", "available"}."""
    if INPUT_MODE == "camera" or use_camera:
        return {"mode": "camera", "source": CAMERA_INDEX, "video": None, "available": True}
    video = TEST_VIDEOS.get(plan.exercise_type)
    source = os.path.join("videos", video) if video else None
    available = bool(source) and os.path.isfile(os.path.join(PROJECT_ROOT, source))
    return {"mode": "video", "source": source, "video": video, "available": available}


def _my_active_plan(plan_id, user, db):
    plan = next((p for p in get_active_plans(db, user.patient_profile.id) if p.id == plan_id), None)
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    return plan


@app.get("/my/sessions/input")
def my_session_input(plan_id: int, user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    info = session_input(_my_active_plan(plan_id, user, db))
    return {k: info[k] for k in ("mode", "video", "available")}


@app.post("/my/sessions/start")
def start_session(body: StartIn, user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    """Starts tracking for the chosen plan; the web page shows the live video from the stream."""
    plan = _my_active_plan(body.plan_id, user, db)
    consent = latest_consent(db, user.id)
    if consent is None or not consent.camera_allowed:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Camera use is not allowed in your consent settings. Allow the camera in Settings to exercise.",
        )

    info = session_input(plan, use_camera=body.use_camera)
    if not info["available"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "There is no test video for this exercise yet. Start with your camera instead.",
        )
    source = info["source"]

    # only one session at a time: a new Start ends the previous one (it frees the camera and the port)
    old = _runner["proc"]
    if old is not None and old.poll() is None:
        old.terminate()
        try:
            old.wait(timeout=5)
        except subprocess.TimeoutExpired:
            old.kill()

    token = secrets.token_urlsafe(16)
    cmd = [
        sys.executable,
        os.path.join(SRC_DIR, "session_runner.py"),
        "--plan-id", str(body.plan_id),
        "--source", source,
        "--stream-port", str(STREAM_PORT),
        "--stream-host", STREAM_HOST,
        "--stream-token", token,
    ]
    # stdin=DEVNULL: no terminal pain question - the web page asks instead
    proc = subprocess.Popen(cmd, cwd=PROJECT_ROOT, stdin=subprocess.DEVNULL)
    _runner["proc"] = proc
    return {
        "started": True,
        "pid": proc.pid,
        "mode": info["mode"],
        "started_at": datetime.now().isoformat(),
        "stream": {"port": STREAM_PORT, "token": token},
    }


@app.patch("/sessions/{session_id}/pain")
def set_pain(session_id: int, body: PainIn, user: User = Depends(require_patient), db: DbSession = Depends(get_db)):
    s = db.query(Session).filter(Session.id == session_id).first()
    if s is None or s.patient_id != user.patient_profile.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    s.pain_score = body.pain_score
    if body.note is not None:
        s.patient_note = body.note.strip() or s.patient_note
    db.commit()
    db.refresh(s)
    return session_out(s)