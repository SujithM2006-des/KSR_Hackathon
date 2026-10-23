"""
ReHabRep - The patient's local time (used for "today", schedules, streaks and session times).

Default time zone: India (UTC+05:30, no daylight saving). Change with
    $env:REHABREP_TZ_OFFSET_MIN = "330"
Session start/end times are stored in this local time, so "today" never jumps at 05:30 IST.
"""

import os
from datetime import date, datetime, timedelta

TZ_OFFSET_MIN = int(os.getenv("REHABREP_TZ_OFFSET_MIN", "330"))


def local_now() -> datetime:
    return datetime.utcnow() + timedelta(minutes=TZ_OFFSET_MIN)


def local_today() -> date:
    return local_now().date()


def utc_to_local(dt):
    """For timestamps stored in UTC (prescription activated/ended times)."""
    return dt + timedelta(minutes=TZ_OFFSET_MIN) if dt else None


def iso_utc(dt):
    """UTC timestamp -> '2026-10-23T08:00:00Z' so the browser shows it in the viewer's own time zone."""
    return dt.isoformat() + "Z" if dt else None


def iso_local(dt):
    """Patient-local timestamp (session times) -> ISO string with the +05:30 offset."""
    if not dt:
        return None
    sign = "+" if TZ_OFFSET_MIN >= 0 else "-"
    h, m = divmod(abs(TZ_OFFSET_MIN), 60)
    return f"{dt.isoformat()}{sign}{h:02d}:{m:02d}"