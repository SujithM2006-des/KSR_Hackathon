"""
ReHabRep - Turning database rows into JSON for the frontend (shared by all API modules).

All values here are already DECRYPTED (the Encrypted* column types do that on load).
"""

from datetime import timedelta
from typing import List

from sqlalchemy.orm import Session as DbSession

from clock import iso_local, iso_utc, local_now
from consent import CONSENT_VERSION
from crud import current_prescription, get_active_plans, get_sessions, latest_invitation, list_prescriptions
from exercises import EXERCISES, resolve_exercise
from models import Patient, Prescription, Session

HIGH_PAIN = 7
RECENT_SESSIONS = 5  # measured sessions used for the adherence badge
REVIEW_DAYS = 7  # "not well" / "stopped for pain" flags shown to the therapist for this many days
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def parse_days(text):
    if not text:
        return list(range(7))  # older plans without a schedule = every day
    return [int(d) for d in str(text).split(",") if d.strip().isdigit()]


def _iso(dt):
    """UTC timestamps (plans, invitations, consent). Session times use iso_local."""
    return iso_utc(dt)


def exercise_info(key) -> dict:
    real = resolve_exercise(key)
    ex = EXERCISES.get(real, {})
    return {
        "exercise_type": real or key,
        "exercise_name": ex.get("name", key),
        "joint": ex.get("joint"),
        "direction": ex.get("direction", "up"),
        "view": ex.get("view"),
        "instructions": ex.get("instructions"),
    }


def plan_out(plan) -> dict:
    days = parse_days(plan.days)
    return {
        "id": plan.id,
        **exercise_info(plan.exercise_type),
        "prescription_id": plan.prescription_id,
        "condition": plan.condition,
        "sets": plan.sets,
        "reps_per_set": plan.reps_per_set,
        "prescribed_reps": plan.prescribed_reps,
        "hold_s": plan.hold_s,
        "rest_s": plan.rest_s,
        "side": plan.side or "BOTH",
        "min_angle": plan.min_angle,
        "max_angle": plan.max_angle,
        "days": days,
        "days_label": days_label(days),
        "time_of_day": plan.time_of_day,
        "scheduled_today": local_now().weekday() in days,
        "note": plan.note,
        "active": plan.active,
        "created_at": _iso(plan.created_at),
    }


def days_label(days) -> str:
    days = sorted(set(days))
    if len(days) == 7:
        return "Every day"
    if days == [0, 1, 2, 3, 4]:
        return "Mon-Fri"
    return ", ".join(DAY_NAMES[d] for d in days if 0 <= d < 7)


def prescription_out(db: DbSession, pres: Prescription) -> dict:
    item_ids = [it.id for it in pres.items]
    sessions = db.query(Session).filter(Session.plan_id.in_(item_ids)).count() if item_ids else 0
    return {
        "id": pres.id,
        "patient_id": pres.patient_id,
        "version": pres.version,
        "status": pres.status,
        "note": pres.note,
        "status_reason": pres.status_reason,
        "previous_id": pres.previous_id,
        "created_by": pres.created_by.name if pres.created_by else None,
        "created_at": _iso(pres.created_at),
        "activated_at": _iso(pres.activated_at),
        "ended_at": _iso(pres.ended_at),
        "sessions_count": sessions,
        "items": [plan_out(it) for it in pres.items],
    }


def session_out(s: Session, with_reps=False) -> dict:
    data = {
        "id": s.id,
        "patient_id": s.patient_id,
        "plan_id": s.plan_id,
        **exercise_info(s.plan.exercise_type if s.plan else "mini_squat"),
        "side": (s.plan.side if s.plan else None) or "BOTH",
        "mode": s.mode or "TRACKED",  # TRACKED | GUIDED | NONE
        "status": s.status or "COMPLETED",  # COMPLETED | PARTIAL | INTERRUPTED | SKIPPED
        "measured": (s.mode or "TRACKED") == "TRACKED",
        "review_flag": s.review_flag,
        "patient_note": s.patient_note,
        "started_at": iso_local(s.started_at),
        "ended_at": iso_local(s.ended_at),
        "min_angle": s.min_angle,
        "max_angle": s.max_angle,
        "prescribed_reps": s.prescribed_reps,
        "reps_done": s.reps_done,
        "good_reps": s.good_reps,
        "under_reps": s.under_reps,
        "over_reps": s.over_reps,
        "accuracy_pct": s.accuracy_pct,
        "completion_pct": s.completion_pct,
        "adherence_pct": s.adherence_pct,
        "max_angle_reached": s.max_angle_reached,  # BEST angle (lowest for "down" exercises)
        "avg_peak_angle": s.avg_peak_angle,
        "duration_s": s.duration_s,
        "plan_followed": s.plan_followed,
        "pain_score": s.pain_score,
        "high_pain": s.pain_score is not None and s.pain_score >= HIGH_PAIN,
    }
    if with_reps:
        data["reps"] = [
            {
                "rep_number": r.rep_number,
                "peak_angle": r.peak_angle,
                "result": r.result,
                "duration_s": r.duration_s,
                "time_s": r.time_s,
            }
            for r in s.reps
        ]
    return data


def adherence_badge(sessions: List[Session]) -> dict:
    """Badge from the average adherence of the most recent MEASURED sessions (guided/skipped have no score)."""
    recent = [s for s in sessions if s.adherence_pct is not None][:RECENT_SESSIONS]
    if not recent:
        return {"color": "grey", "label": "No sessions yet", "avg_adherence_pct": None}
    avg = round(sum(s.adherence_pct for s in recent) / len(recent), 1)
    if avg >= 80:
        color, label = "green", "On track"
    elif avg >= 50:
        color, label = "amber", "Needs attention"
    else:
        color, label = "red", "Not following plan"
    return {"color": color, "label": label, "avg_adherence_pct": avg}


def patient_summary(db: DbSession, p: Patient) -> dict:
    sessions = get_sessions(db, p.id)
    recent = sessions[:RECENT_SESSIONS]
    last = sessions[0] if sessions else None
    current = current_prescription(db, p.id)
    has_draft = any(x.status == "DRAFT" for x in list_prescriptions(db, p.id))
    inv = latest_invitation(db, p.user.id) if p.user.status in ("INVITED", "DRAFT") else None
    return {
        "id": p.id,
        "user_id": p.user.id,
        "name": p.user.name,
        "email": p.user.email,
        "account_status": p.user.status,
        "invitation_expires_at": _iso(inv.expires_at) if inv and not inv.revoked and not inv.used_at else None,
        "surgery_type": p.surgery_type,
        "notes": p.notes,
        "plan_status": current.status if current else None,
        "plan_version": current.version if current else None,
        "plan_status_reason": current.status_reason if current else None,
        "has_draft_plan": has_draft,
        "active_plans": [plan_out(pl) for pl in get_active_plans(db, p.id)],
        "sessions_count": len(sessions),
        "last_session_at": iso_local(last.ended_at) if last else None,
        "last_session": session_out(last) if last else None,
        "badge": adherence_badge(sessions),
        "pain_alert": any(s.pain_score is not None and s.pain_score >= HIGH_PAIN for s in recent),
        "review_flags": review_flags(sessions),
    }


def review_flags(sessions: List[Session]) -> list:
    """Recent 'not well today' skips and 'stopped because of pain' sessions for the therapist to review."""
    since = local_now() - timedelta(days=REVIEW_DAYS)
    out = []
    for s in sessions:
        if s.review_flag and s.ended_at and s.ended_at >= since:
            out.append(
                {
                    "session_id": s.id,
                    "flag": s.review_flag,
                    "date": iso_local(s.ended_at),
                    "exercise_name": exercise_info(s.plan.exercise_type if s.plan else "")["exercise_name"],
                    "note": s.patient_note,
                }
            )
    return out


def consent_out(rec) -> dict:
    if rec is None:
        return {"given": False, "camera_allowed": False, "version": None, "current_version": CONSENT_VERSION,
                "needs_consent": True, "updated_at": None}
    return {
        "given": True,
        "camera_allowed": bool(rec.camera_allowed),
        "version": rec.version,
        "current_version": CONSENT_VERSION,
        "needs_consent": rec.version != CONSENT_VERSION,  # text changed -> ask again
        "action": rec.action,
        "updated_at": _iso(rec.created_at),
    }