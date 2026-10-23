"""
ReHabRep - "What do I do today?": today's schedule, streak and 7-day adherence for a patient.

Rules (also shown to patients and therapists in the app):
  - An exercise is SCHEDULED on a day when it belongs to the plan version that was live that day
    and that weekday is ticked in its schedule.
  - An exercise counts as DONE on a day when it has a COMPLETED session that day
    (camera-tracked or patient-confirmed). A session done under an earlier plan version still
    counts for the same exercise (and side), so a therapist editing the plan never undoes the day.
  - STREAK = consecutive days on which every scheduled exercise was done. Days with nothing
    scheduled are ignored. Today only adds to the streak once it is complete; an unfinished
    today does not break it.
  - 7-DAY ADHERENCE = scheduled exercises done / scheduled exercises, over the last 7 days
    (today included only if all of today's exercises are done). "Unavailable" if nothing was scheduled.
"""

from datetime import timedelta

from sqlalchemy.orm import Session as DbSession

from clock import local_today, utc_to_local
from crud import current_prescription, get_sessions, list_prescriptions
from models import ExercisePlan
from serializers import days_label, parse_days, plan_out

STREAK_RULE = (
    "A day counts when every exercise scheduled for that day is completed (with the camera or confirmed by you). "
    "Days with nothing scheduled are skipped."
)
ADHERENCE_RULE = "Scheduled exercises completed in the last 7 days, divided by exercises scheduled."
MAX_LOOKBACK_DAYS = 366


def _live_window(pres):
    """(first_day, end_day_exclusive) in local dates, or None if the version was never live."""
    if pres.status in ("DRAFT", "DISCARDED") or pres.activated_at is None:
        return None
    start = utc_to_local(pres.activated_at).date()
    end = utc_to_local(pres.ended_at).date() if pres.ended_at else None
    return start, end


def scheduled_items(prescriptions, day, today):
    """Plan items scheduled on `day`. A currently paused plan schedules nothing from today on."""
    out = []
    for pres in prescriptions:
        window = _live_window(pres)
        if window is None:
            continue
        start, end = window
        if day < start or (end is not None and day >= end):
            continue
        if pres.status == "PAUSED" and day >= today:
            continue
        for it in pres.items:
            if day.weekday() in parse_days(it.days):
                out.append(it)
    return out


def day_status(sessions_today):
    statuses = {s.status for s in sessions_today}
    if "COMPLETED" in statuses:
        return "DONE"
    if statuses & {"PARTIAL", "INTERRUPTED"}:
        return "PARTIAL"
    if "SKIPPED" in statuses:
        return "SKIPPED"
    return "PENDING"


def build_today(db: DbSession, patient_id: int) -> dict:
    today = local_today()
    prescriptions = list_prescriptions(db, patient_id)
    sessions = get_sessions(db, patient_id, limit=5000)

    # the same exercise keeps its key across plan versions (each version has new item ids)
    item_key = {
        p.id: (p.exercise_type, p.side or "BOTH")
        for p in db.query(ExercisePlan).filter(ExercisePlan.patient_id == patient_id).all()
    }
    by_day = {}  # (date, exercise key) -> [sessions]
    for s in sessions:
        if s.ended_at and s.plan_id in item_key:
            by_day.setdefault((s.ended_at.date(), item_key[s.plan_id]), []).append(s)

    def done_on(day, item_id):
        return any(s.status == "COMPLETED" for s in by_day.get((day, item_key.get(item_id)), []))

    # ---- today ----
    live = current_prescription(db, patient_id)
    today_items, other_items = [], []
    if live is not None and live.status == "ACTIVE":
        for it in live.items:
            info = plan_out(it)
            todays = by_day.get((today, item_key.get(it.id)), [])
            info["today_status"] = day_status(todays)
            info["today_session_ids"] = [s.id for s in todays]
            (today_items if info["scheduled_today"] else other_items).append(info)

    # ---- streak ----
    first_day = min((w[0] for w in (_live_window(p) for p in prescriptions) if w), default=None)
    streak, day = 0, today
    today_sched = scheduled_items(prescriptions, today, today)
    today_complete = bool(today_sched) and all(done_on(today, it.id) for it in today_sched)
    if today_complete:
        streak += 1
    day = today - timedelta(days=1)
    lookback = 0
    while first_day is not None and day >= first_day and lookback < MAX_LOOKBACK_DAYS:
        sched = scheduled_items(prescriptions, day, today)
        if sched:
            if all(done_on(day, it.id) for it in sched):
                streak += 1
            else:
                break
        day -= timedelta(days=1)
        lookback += 1

    # ---- 7-day adherence ----
    scheduled_count = done_count = missed_days = 0
    for back in range(0, 7):
        d = today - timedelta(days=back)
        if d == today and not today_complete:
            continue
        sched = scheduled_items(prescriptions, d, today)
        done_here = sum(1 for it in sched if done_on(d, it.id))
        scheduled_count += len(sched)
        done_count += done_here
        if sched and done_here < len(sched):
            missed_days += 1
    adherence = (
        {"pct": round(100.0 * done_count / scheduled_count), "done": done_count, "scheduled": scheduled_count,
         "days_with_missed": missed_days}
        if scheduled_count
        else None
    )

    return {
        "date": today.isoformat(),
        "weekday": today.strftime("%A"),
        "plan_status": live.status if live else None,
        "plan_status_reason": live.status_reason if live else None,
        "plan_note": live.note if live else None,
        "plan_version": live.version if live else None,
        "items": today_items,
        "other_items": other_items,
        "all_done_today": bool(today_items) and all(i["today_status"] == "DONE" for i in today_items),
        "streak": {"days": streak, "rule": STREAK_RULE},
        "adherence_7d": adherence,  # None -> show "Unavailable"
        "adherence_rule": ADHERENCE_RULE,
    }


__all__ = ["build_today", "days_label", "STREAK_RULE"]