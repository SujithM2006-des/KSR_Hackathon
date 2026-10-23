"""
ReHabRep - Database helper functions (used by session_runner, seed and the API).

All data columns are encrypted automatically by the Encrypted* column types
(crypto.py). The database can only see ciphertext, so:
  - users are found by email through the email_hash blind index
  - filtering by plan status and sorting by date are done in Python, after
    the rows have been decrypted (fine for clinic-sized data)
Rows are only ever selected by their plain ids (patient_id, plan_id ...).
"""

import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session as DbSession

from clock import local_now
from crypto import blind_index, decrypt_bytes, encrypt_bytes
from database import DATA_DIR
from models import (
    AuditLog,
    ConsentRecord,
    ExercisePlan,
    Invitation,
    Patient,
    Prescription,
    RepLog,
    Session,
    TherapistProfile,
    User,
)

CREDENTIAL_DIR = os.path.join(DATA_DIR, "credentials")  # encrypted credential files (never public)
NO_PASSWORD = "!"  # stored as password_hash until an invited patient sets their own password
INVITE_DAYS = 7

# ---------------------------------------------------------------------------
# Passwords (PBKDF2 from the standard library - no extra packages needed)
# ---------------------------------------------------------------------------
_ITERATIONS = 120_000


def hash_password(password):
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    if not stored or stored == NO_PASSWORD:
        return False
    try:
        salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), _ITERATIONS)
    return hmac.compare_digest(digest.hex(), digest_hex)


# ---------------------------------------------------------------------------
# Users / patients / plans
# ---------------------------------------------------------------------------
def get_user_by_email(db: DbSession, email):
    return db.query(User).filter(User.email_hash == blind_index(email)).first()


def create_user(db: DbSession, name, email, password, role, status="ACTIVE"):
    """password=None creates an account that cannot log in until a password is set (invited patient)."""
    clean_email = email.lower().strip()
    user = User(
        name=name,
        email=clean_email,
        email_hash=blind_index(clean_email),
        password_hash=hash_password(password) if password else NO_PASSWORD,
        role=role,
        status=status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_therapist(
    db: DbSession,
    name,
    email,
    password,
    profession,
    registration_number,
    issuing_body,
    workplace=None,
    phone=None,
    status="PENDING",
):
    """Therapist account + professional profile. New registrations start as PENDING."""
    user = create_user(db, name, email, password, "THERAPIST")
    profile = TherapistProfile(
        user_id=user.id,
        profession=profession,
        registration_number=registration_number,
        issuing_body=issuing_body,
        workplace=workplace,
        phone=phone,
        status=status,
        submitted_at=datetime.utcnow(),
    )
    db.add(profile)
    db.commit()
    db.refresh(user)
    return user


def save_credential_document(db: DbSession, profile: TherapistProfile, filename, content_type, data: bytes):
    """Store the uploaded credential ENCRYPTED on disk under a random name; keep only that name in the DB."""
    os.makedirs(CREDENTIAL_DIR, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.enc"
    with open(os.path.join(CREDENTIAL_DIR, stored_name), "wb") as f:
        f.write(encrypt_bytes(data))

    old = profile.document_file
    profile.document_file = stored_name
    profile.document_name = os.path.basename(filename or "document")
    profile.document_type = content_type
    db.commit()

    if old:  # remove the previous version of the document
        try:
            os.remove(os.path.join(CREDENTIAL_DIR, old))
        except OSError:
            pass
    return stored_name


def read_credential_document(profile: TherapistProfile):
    """Return the decrypted document bytes, or None if there is no document."""
    if not profile.document_file:
        return None
    path = os.path.join(CREDENTIAL_DIR, os.path.basename(profile.document_file))
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        return decrypt_bytes(f.read())


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
def log_action(db: DbSession, actor_id, action, target_type=None, target_id=None, reason=None):
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        created_at=datetime.utcnow(),
    )
    db.add(entry)
    db.commit()
    return entry


def list_audit(db: DbSession, limit=200):
    return _newest_first(db.query(AuditLog).all(), "created_at")[:limit]


def create_patient(
    db: DbSession, name, email, password, therapist_id, surgery_type=None, notes=None, status="ACTIVE"
):
    """password=None + status INVITED/DRAFT: the patient sets their own password through an invitation."""
    user = create_user(db, name, email, password, "PATIENT", status=status)
    patient = Patient(
        user_id=user.id,
        therapist_id=therapist_id,
        surgery_type=surgery_type,
        notes=notes,
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


# ---------------------------------------------------------------------------
# Invitations (single-use, expiring; only the SHA-256 of the token is stored)
# ---------------------------------------------------------------------------
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_invitation(db: DbSession, user: User, created_by_id: int):
    """New invitation link for this patient. Older unused links stop working. Returns (token, invitation)."""
    for old in db.query(Invitation).filter(Invitation.user_id == user.id).all():
        if old.used_at is None and not old.revoked:
            old.revoked = True
    token = secrets.token_urlsafe(32)
    inv = Invitation(
        user_id=user.id,
        created_by_id=created_by_id,
        token_hash=_token_hash(token),
        expires_at=datetime.utcnow() + timedelta(days=INVITE_DAYS),
        revoked=False,
        created_at=datetime.utcnow(),
    )
    db.add(inv)
    if user.status == "DRAFT":
        user.status = "INVITED"
    db.commit()
    db.refresh(inv)
    return token, inv


def find_invitation(db: DbSession, token: str):
    """Returns (invitation, problem). problem is None when the link can be used."""
    inv = db.query(Invitation).filter(Invitation.token_hash == _token_hash(token or "")).first()
    if inv is None or inv.revoked:
        return None, "This invitation link is not valid. Ask your therapist for a new one."
    if inv.used_at is not None:
        return inv, "This invitation has already been used. Log in with your email and password."
    if inv.expires_at < datetime.utcnow():
        return inv, "This invitation link has expired. Ask your therapist to send a new one."
    if inv.user.status != "INVITED":
        return inv, "This account cannot be activated with this link. Contact your therapist."
    return inv, None


def accept_invitation(db: DbSession, inv: Invitation, password: str) -> User:
    user = inv.user
    user.password_hash = hash_password(password)
    user.status = "ACTIVE"
    inv.used_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user


def latest_invitation(db: DbSession, user_id: int):
    invs = db.query(Invitation).filter(Invitation.user_id == user_id).all()
    return _newest_first(invs, "created_at")[0] if invs else None


# ---------------------------------------------------------------------------
# Prescriptions (versioned plans)
# ---------------------------------------------------------------------------
LIVE_STATUSES = ("ACTIVE", "PAUSED")


def list_prescriptions(db: DbSession, patient_id):
    rows = db.query(Prescription).filter(Prescription.patient_id == patient_id).all()
    return sorted(rows, key=lambda r: (r.version or 0, r.id), reverse=True)


def current_prescription(db: DbSession, patient_id):
    """The ACTIVE or PAUSED version (there is at most one)."""
    for p in list_prescriptions(db, patient_id):
        if p.status in LIVE_STATUSES:
            return p
    return None


def save_prescription(db: DbSession, patient_id, created_by_id, items, status="ACTIVE", note=None, draft_id=None):
    """
    Save a NEW version of the patient's plan.
      status ACTIVE: becomes the live plan; the previous ACTIVE/PAUSED version becomes SUPERSEDED
                     (its items stop being startable, but old sessions keep pointing at them).
      status DRAFT : hidden from the patient. Any older draft is DISCARDED (one draft at a time).
    `items` = list of dicts with the ExercisePlan fields.
    """
    if status not in ("ACTIVE", "DRAFT"):
        raise ValueError("status must be ACTIVE or DRAFT")
    existing = list_prescriptions(db, patient_id)
    version = max((p.version or 0 for p in existing), default=0) + 1
    previous = next((p for p in existing if p.status in LIVE_STATUSES), None)
    now = datetime.utcnow()

    for p in existing:
        if p.status == "DRAFT":  # saving any new version replaces the old draft
            p.status = "DISCARDED"
            p.ended_at = now

    pres = Prescription(
        patient_id=patient_id,
        created_by_id=created_by_id,
        previous_id=previous.id if previous else None,
        version=version,
        status=status,
        note=note,
        created_at=now,
        activated_at=now if status == "ACTIVE" else None,
    )
    db.add(pres)
    db.flush()

    if status == "ACTIVE" and previous is not None:
        previous.status = "SUPERSEDED"
        previous.ended_at = now
        for it in previous.items:
            it.active = False

    for it in items:
        days = it.get("days")
        db.add(
            ExercisePlan(
                patient_id=patient_id,
                prescription_id=pres.id,
                exercise_type=it["exercise_type"],
                condition=it.get("condition"),
                sets=it["sets"],
                reps_per_set=it["reps_per_set"],
                hold_s=it.get("hold_s"),
                rest_s=it.get("rest_s"),
                side=it.get("side"),
                min_angle=it["min_angle"],
                max_angle=it["max_angle"],
                days=",".join(str(d) for d in sorted(set(days))) if days else None,
                time_of_day=it.get("time_of_day"),
                note=it.get("note"),
                active=(status == "ACTIVE"),
                created_at=now,
            )
        )
    db.commit()
    db.refresh(pres)
    return pres


ALLOWED_CHANGES = {
    "PAUSE": ({"ACTIVE"}, "PAUSED"),
    "RESUME": ({"PAUSED"}, "ACTIVE"),
    "END": ({"ACTIVE", "PAUSED"}, "ENDED"),
    "DISCARD": ({"DRAFT"}, "DISCARDED"),
}


def change_prescription_status(db: DbSession, pres: Prescription, action: str, reason=None):
    if action not in ALLOWED_CHANGES:
        raise ValueError("Unknown action")
    allowed_from, new_status = ALLOWED_CHANGES[action]
    if pres.status not in allowed_from:
        raise ValueError(f"A {pres.status.lower()} plan cannot be changed with {action.lower()}")
    pres.status = new_status
    pres.status_reason = reason
    if new_status in ("ENDED", "DISCARDED"):
        pres.ended_at = datetime.utcnow()
    for it in pres.items:
        it.active = new_status == "ACTIVE"
    db.commit()
    db.refresh(pres)
    return pres


def create_plan(db: DbSession, patient_id, exercise_type, sets, reps_per_set, min_angle, max_angle, created_by_id=None):
    """Shortcut used by the seed script: an ACTIVE one-exercise prescription."""
    if min_angle >= max_angle:
        raise ValueError("min_angle must be smaller than max_angle")
    if created_by_id is None:
        created_by_id = db.query(Patient).filter(Patient.id == patient_id).first().therapist_id
    pres = save_prescription(
        db,
        patient_id,
        created_by_id,
        [
            {
                "exercise_type": exercise_type,
                "sets": sets,
                "reps_per_set": reps_per_set,
                "min_angle": min_angle,
                "max_angle": max_angle,
                "side": "BOTH",
                "rest_s": 30,
                "hold_s": 0,
                "days": list(range(7)),
            }
        ],
        status="ACTIVE",
    )
    return pres.items[0]


def get_plan(db: DbSession, plan_id):
    return db.query(ExercisePlan).filter(ExercisePlan.id == plan_id).first()


def _newest_first(rows, attr):
    """Sort decrypted rows by a datetime attribute, newest first (missing dates last)."""
    return sorted(rows, key=lambda r: (getattr(r, attr) is not None, getattr(r, attr) or datetime.min), reverse=True)


def get_active_plans(db: DbSession, patient_id):
    plans = db.query(ExercisePlan).filter(ExercisePlan.patient_id == patient_id).all()
    return _newest_first([p for p in plans if p.active], "created_at")


# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------
def latest_consent(db: DbSession, user_id):
    rows = db.query(ConsentRecord).filter(ConsentRecord.user_id == user_id).all()
    return max(rows, key=lambda r: r.id) if rows else None


def record_consent(db: DbSession, user_id, version, action, camera_allowed):
    rec = ConsentRecord(
        user_id=user_id, version=version, action=action, camera_allowed=camera_allowed, created_at=datetime.utcnow()
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def consent_history(db: DbSession, user_id):
    return sorted(db.query(ConsentRecord).filter(ConsentRecord.user_id == user_id).all(), key=lambda r: r.id, reverse=True)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
def tracked_status(reps_done, prescribed):
    if prescribed and reps_done >= prescribed:
        return "COMPLETED"
    return "PARTIAL" if reps_done > 0 else "INTERRUPTED"


def find_by_request_id(db: DbSession, patient_id, client_request_id):
    if not client_request_id:
        return None
    s = db.query(Session).filter(Session.client_request_id == client_request_id).first()
    return s if s is not None and s.patient_id == patient_id else None


def save_guided_session(
    db: DbSession, plan: ExercisePlan, sets_done, stopped=False, duration_s=None, client_request_id=None,
    review_flag=None,
):
    """Patient-confirmed session: nothing is measured, so measurement columns stay empty."""
    sets_done = max(0, min(int(sets_done), plan.sets))
    if sets_done >= plan.sets:
        status = "COMPLETED"
    elif stopped:
        status = "INTERRUPTED"
    else:
        status = "PARTIAL" if sets_done > 0 else "INTERRUPTED"
    ended_at = local_now()
    reps_done = sets_done * plan.reps_per_set
    session = Session(
        patient_id=plan.patient_id,
        plan_id=plan.id,
        client_request_id=client_request_id,
        mode="GUIDED",
        status=status,
        review_flag=review_flag,
        started_at=ended_at - timedelta(seconds=duration_s or 0),
        ended_at=ended_at,
        min_angle=plan.min_angle,
        max_angle=plan.max_angle,
        prescribed_reps=plan.prescribed_reps,
        reps_done=reps_done,
        completion_pct=round(100.0 * reps_done / plan.prescribed_reps, 1) if plan.prescribed_reps else None,
        duration_s=duration_s,
        source="guided",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def save_skip(db: DbSession, plan: ExercisePlan, reason=None, not_well=False, client_request_id=None):
    now = local_now()
    session = Session(
        patient_id=plan.patient_id,
        plan_id=plan.id,
        client_request_id=client_request_id,
        mode="NONE",
        status="SKIPPED",
        review_flag="NOT_WELL" if not_well else None,
        patient_note=reason,
        started_at=now,
        ended_at=now,
        min_angle=plan.min_angle,
        max_angle=plan.max_angle,
        prescribed_reps=plan.prescribed_reps,
        reps_done=0,
        source="skipped",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def save_session(db: DbSession, plan: ExercisePlan, summary, reps, source=None, pain_score=None, ended_at=None):
    """Store one finished CAMERA-TRACKED session + its reps. `summary` comes from RepCounter.summary()."""
    ended_at = ended_at or local_now()
    started_at = ended_at - timedelta(seconds=summary.get("duration_s") or 0)

    session = Session(
        patient_id=plan.patient_id,
        plan_id=plan.id,
        mode="TRACKED",
        status=tracked_status(summary["reps_done"], summary["prescribed_reps"]),
        started_at=started_at,
        ended_at=ended_at,
        min_angle=plan.min_angle,
        max_angle=plan.max_angle,
        prescribed_reps=summary["prescribed_reps"],
        reps_done=summary["reps_done"],
        good_reps=summary["good_reps"],
        under_reps=summary["under_reps"],
        over_reps=summary["over_reps"],
        accuracy_pct=summary["accuracy_pct"],
        completion_pct=summary["completion_pct"],
        adherence_pct=summary["adherence_pct"],
        max_angle_reached=summary["max_angle"],
        avg_peak_angle=summary["avg_peak_angle"],
        duration_s=summary["duration_s"],
        plan_followed=summary["plan_followed"],
        pain_score=pain_score,
        source=source,
    )
    for r in reps:
        session.reps.append(
            RepLog(
                rep_number=r["rep_number"],
                peak_angle=r["peak_angle"],
                result=r["result"],
                duration_s=r.get("duration_s"),
                time_s=r.get("time_s"),
            )
        )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_sessions(db: DbSession, patient_id, limit=50):
    sessions = db.query(Session).filter(Session.patient_id == patient_id).all()
    return _newest_first(sessions, "ended_at")[:limit]