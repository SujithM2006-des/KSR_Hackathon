"""
ReHabRep - Admin API (all routes require role ADMIN).

  GET   /admin/overview                         counts for the admin dashboard
  GET   /admin/therapists?status=PENDING        therapists (verification queue / list)
  GET   /admin/therapists/{user_id}             one therapist + professional details
  GET   /admin/therapists/{user_id}/document    the credential document (decrypted, admins only)
  POST  /admin/therapists/{user_id}/decision    APPROVE or REJECT, with a required reason
  GET   /admin/patients                         patients grouped under their therapist
  POST  /admin/users/{user_id}/suspend          suspend an account (reason required)
  POST  /admin/users/{user_id}/reactivate       reactivate an account (reason required)
  GET   /admin/admins                           list admins
  POST  /admin/admins                           create another admin (so one admin can't lock the system)
  GET   /admin/audit-log                        newest actions first

Every decision, suspension and reactivation is written to the audit log with its reason.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from crud import create_user, get_user_by_email, list_audit, log_action, read_credential_document
from database import get_db
from models import Patient, Session, TherapistProfile, User
from security import require_admin, therapist_status_out
from serializers import HIGH_PAIN, patient_summary

router = APIRouter(prefix="/admin", tags=["admin"])

STATUS_ORDER = {"PENDING": 0, "REJECTED": 1, "APPROVED": 2}


class DecisionIn(BaseModel):
    decision: str  # APPROVE | REJECT
    reason: str = Field(min_length=3, max_length=500)
    register_check_note: Optional[str] = Field(None, max_length=500)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class AdminIn(BaseModel):
    name: str = Field(min_length=2)
    email: str
    password: str = Field(min_length=8)


def _therapist(db: DbSession, user_id: int) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or user.role != "THERAPIST" or user.therapist_profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Therapist not found")
    return user


def therapist_row(db: DbSession, user: User) -> dict:
    profile = user.therapist_profile
    patient_count = db.query(Patient).filter(Patient.therapist_id == user.id).count()
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "account_status": user.status,
        "account_status_reason": user.status_reason,
        "patient_count": patient_count,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "verification": therapist_status_out(profile),
        "register_check_note": profile.register_check_note if profile else None,
        "reviewed_by": profile.reviewed_by.name if profile and profile.reviewed_by else None,
    }


@router.get("/overview")
def overview(admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    users = db.query(User).all()
    therapists = [u for u in users if u.role == "THERAPIST"]
    by_status = {"PENDING": 0, "APPROVED": 0, "REJECTED": 0}
    for t in therapists:
        st = t.therapist_profile.status if t.therapist_profile else "PENDING"
        by_status[st] = by_status.get(st, 0) + 1

    sessions = db.query(Session).all()
    week_ago = datetime.now() - timedelta(days=7)
    recent = [s for s in sessions if s.ended_at and s.ended_at >= week_ago]

    return {
        "therapists_total": len(therapists),
        "therapists_by_status": by_status,
        "patients_total": sum(1 for u in users if u.role == "PATIENT"),
        "admins_total": sum(1 for u in users if u.role == "ADMIN"),
        "suspended_accounts": sum(1 for u in users if u.status == "SUSPENDED"),
        "sessions_total": len(sessions),
        "sessions_last_7_days": len(recent),
        "high_pain_last_7_days": sum(1 for s in recent if s.pain_score is not None and s.pain_score >= HIGH_PAIN),
        "plan_followed_last_7_days": {
            k: sum(1 for s in recent if s.plan_followed == k) for k in ("YES", "PARTLY", "NO")
        },
    }


@router.get("/therapists")
def list_therapists(
    status_filter: Optional[str] = Query(None, alias="status"),
    admin: User = Depends(require_admin),
    db: DbSession = Depends(get_db),
):
    therapists = [u for u in db.query(User).all() if u.role == "THERAPIST" and u.therapist_profile]
    if status_filter:
        therapists = [u for u in therapists if u.therapist_profile.status == status_filter.upper()]
    # Pending first (oldest submission first), then rejected, then approved
    therapists.sort(
        key=lambda u: (
            STATUS_ORDER.get(u.therapist_profile.status, 9),
            u.therapist_profile.submitted_at or datetime.min,
        )
    )
    return [therapist_row(db, u) for u in therapists]


@router.get("/therapists/{user_id}")
def therapist_detail(user_id: int, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    return therapist_row(db, _therapist(db, user_id))


@router.get("/therapists/{user_id}/document")
def therapist_document(user_id: int, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    user = _therapist(db, user_id)
    profile = user.therapist_profile
    try:
        data = read_credential_document(profile)
    except Exception:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Document could not be decrypted")
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No document uploaded")
    log_action(db, admin.id, "CREDENTIAL_VIEWED", "USER", user.id, None)
    safe_name = (profile.document_name or "document").replace('"', "")
    return Response(
        content=data,
        media_type=profile.document_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{safe_name}"', "Cache-Control": "no-store"},
    )


@router.post("/therapists/{user_id}/decision")
def decide(user_id: int, body: DecisionIn, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    decision = body.decision.upper()
    if decision not in ("APPROVE", "REJECT"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Decision must be APPROVE or REJECT")
    user = _therapist(db, user_id)
    profile: TherapistProfile = user.therapist_profile
    profile.status = "APPROVED" if decision == "APPROVE" else "REJECTED"
    profile.decision_reason = body.reason.strip()
    profile.register_check_note = (body.register_check_note or "").strip() or None
    profile.reviewed_by_id = admin.id
    profile.reviewed_at = datetime.utcnow()
    db.commit()
    log_action(
        db, admin.id, "THERAPIST_APPROVED" if decision == "APPROVE" else "THERAPIST_REJECTED", "USER", user.id,
        body.reason.strip(),
    )
    db.refresh(user)
    return therapist_row(db, user)


@router.get("/patients")
def patients_by_therapist(admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    groups = []
    therapists = [u for u in db.query(User).order_by(User.id).all() if u.role == "THERAPIST"]
    for t in therapists:
        patients = db.query(Patient).filter(Patient.therapist_id == t.id).order_by(Patient.id).all()
        rows = []
        for p in patients:
            rows.append(patient_summary(db, p))
        groups.append(
            {
                "therapist": {
                    "id": t.id,
                    "name": t.name,
                    "email": t.email,
                    "verification_status": t.therapist_profile.status if t.therapist_profile else None,
                    "account_status": t.status,
                },
                "patients": rows,
            }
        )
    return groups


def _set_status(db: DbSession, admin: User, user_id: int, new_status: str, reason: str):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot change your own account status")
    if new_status == "SUSPENDED" and user.role == "ADMIN":
        active_admins = [u for u in db.query(User).all() if u.role == "ADMIN" and u.status == "ACTIVE"]
        if len(active_admins) <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot suspend the last active admin")
    if user.status == new_status:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Account is already {new_status.lower()}")
    user.status = new_status
    user.status_reason = reason.strip()
    db.commit()
    log_action(
        db, admin.id, "USER_SUSPENDED" if new_status == "SUSPENDED" else "USER_REACTIVATED", "USER", user.id,
        reason.strip(),
    )
    return {"id": user.id, "name": user.name, "role": user.role, "status": user.status, "reason": user.status_reason}


@router.post("/users/{user_id}/suspend")
def suspend(user_id: int, body: ReasonIn, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    return _set_status(db, admin, user_id, "SUSPENDED", body.reason)


@router.post("/users/{user_id}/reactivate")
def reactivate(user_id: int, body: ReasonIn, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    return _set_status(db, admin, user_id, "ACTIVE", body.reason)


@router.get("/admins")
def list_admins(admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    return [
        {"id": u.id, "name": u.name, "email": u.email, "status": u.status}
        for u in db.query(User).order_by(User.id).all()
        if u.role == "ADMIN"
    ]


@router.post("/admins", status_code=201)
def add_admin(body: AdminIn, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    if get_user_by_email(db, body.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    new_admin = create_user(db, body.name, body.email, body.password, "ADMIN")
    log_action(db, admin.id, "ADMIN_CREATED", "USER", new_admin.id, None)
    return {"id": new_admin.id, "name": new_admin.name, "email": new_admin.email, "status": new_admin.status}


@router.get("/audit-log")
def audit_log(limit: int = 200, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    limit = max(1, min(limit, 1000))
    names = {u.id: (u.name, u.role) for u in db.query(User).all()}
    out = []
    for e in list_audit(db, limit):
        actor = names.get(e.actor_id, ("System", None))
        target = names.get(e.target_id) if e.target_type == "USER" else None
        out.append(
            {
                "id": e.id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "actor_id": e.actor_id,
                "actor_name": actor[0],
                "actor_role": actor[1],
                "action": e.action,
                "target_type": e.target_type,
                "target_id": e.target_id,
                "target_name": target[0] if target else None,
                "reason": e.reason,
            }
        )
    return out