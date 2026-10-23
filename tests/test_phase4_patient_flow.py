"""
Phase 4 tests: consent, today's schedule, guided (no camera) sessions, skips, streak and safety.

Run from D:\\PROJECT\\KSR (venv active):
    python -m pytest tests -q
"""

import uuid

import pytest
from fastapi.testclient import TestClient

import seed
from api import app


@pytest.fixture(scope="module")
def client():
    seed.main()
    with TestClient(app) as c:
        yield c


def login(client, email, password):
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}, r.json()["user"]


def rid():
    return uuid.uuid4().hex


def new_patient_with_plan(client, email, days=None):
    """Invite a patient, accept the invitation, give them a 2-exercise plan scheduled every day."""
    th, _ = login(client, "therapist@rehabrep.demo", "therapist123")
    r = client.post("/patients", json={"name": "Phase Four", "email": email}, headers=th)
    pid = r.json()["id"]
    token = r.json()["invitation"]["url"].rsplit("/", 1)[1]
    client.post(f"/auth/invitations/{token}/accept", json={"password": "phase4pass"})
    items = [
        {"exercise_type": "mini_squat", "sets": 2, "reps_per_set": 5, "min_angle": 60, "max_angle": 100,
         "days": days or [0, 1, 2, 3, 4, 5, 6]},
        {"exercise_type": "elbow_flexion", "sets": 1, "reps_per_set": 10, "min_angle": 90, "max_angle": 140,
         "days": days or [0, 1, 2, 3, 4, 5, 6]},
    ]
    assert client.post(f"/patients/{pid}/exercise-plans", json={"items": items}, headers=th).status_code == 201
    ph, user = login(client, email, "phase4pass")
    return th, ph, user, pid


def test_public_consent_and_safety(client):
    c = client.get("/consent").json()
    assert c["version"] and len(c["sections"]) >= 4
    s = client.get("/safety").json()
    assert s["emergency_number"] == "112" and s["red_flags"]


def test_consent_required_for_camera(client):
    th, ph, user, pid = new_patient_with_plan(client, "p4a@x.com")
    assert user["consent"]["needs_consent"] is True and user["consent"]["given"] is False
    item = client.get("/me/today", headers=ph).json()["items"][0]

    # no consent yet -> camera session refused
    assert client.post("/my/sessions/start", json={"plan_id": item["id"]}, headers=ph).status_code == 403

    version = client.get("/consent").json()["version"]
    assert client.post("/me/consent", json={"version": "old", "camera_allowed": True}, headers=ph).status_code == 409
    u = client.post("/me/consent", json={"version": version, "camera_allowed": False}, headers=ph).json()
    assert u["consent"]["given"] and not u["consent"]["camera_allowed"] and not u["consent"]["needs_consent"]
    assert client.post("/my/sessions/start", json={"plan_id": item["id"]}, headers=ph).status_code == 403

    u = client.post("/me/consent/camera", json={"allow": True}, headers=ph).json()
    assert u["consent"]["camera_allowed"] is True
    u = client.post("/me/consent/camera", json={"allow": False}, headers=ph).json()
    assert u["consent"]["camera_allowed"] is False
    hist = client.get("/me/consent", headers=ph).json()["history"]
    assert [h["action"] for h in hist][:3] == ["CAMERA_WITHDRAWN", "CAMERA_ALLOWED", "AGREED_NO_CAMERA"]
    assert client.get("/me", headers=ph).json()["consent"]["camera_allowed"] is False


def test_guided_session_streak_and_idempotency(client):
    th, ph, user, pid = new_patient_with_plan(client, "p4b@x.com")
    today = client.get("/me/today", headers=ph).json()
    assert today["plan_status"] == "ACTIVE" and len(today["items"]) == 2
    assert today["streak"]["days"] == 0 and today["adherence_7d"] is None  # nothing completed yet
    squat, elbow = today["items"]

    req = rid()
    r1 = client.post("/my/sessions/guided", json={"plan_id": squat["id"], "sets_done": 2, "client_request_id": req}, headers=ph)
    r2 = client.post("/my/sessions/guided", json={"plan_id": squat["id"], "sets_done": 2, "client_request_id": req}, headers=ph)
    assert r1.status_code == 201 and r1.json()["id"] == r2.json()["id"]  # double click -> one session
    s = r1.json()
    assert s["mode"] == "GUIDED" and s["status"] == "COMPLETED" and s["measured"] is False
    assert s["good_reps"] is None and s["adherence_pct"] is None and s["max_angle_reached"] is None  # nothing invented
    assert s["reps_done"] == 10

    # pain + note after the session
    r = client.patch(f"/sessions/{s['id']}/pain", json={"pain_score": 3, "note": "Felt fine"}, headers=ph)
    assert r.json()["pain_score"] == 3 and r.json()["patient_note"] == "Felt fine"

    today = client.get("/me/today", headers=ph).json()
    status = {i["exercise_type"]: i["today_status"] for i in today["items"]}
    assert status == {"mini_squat": "DONE", "elbow_flexion": "PENDING"}
    assert today["streak"]["days"] == 0  # today not complete yet, but not broken either

    client.post("/my/sessions/guided", json={"plan_id": elbow["id"], "sets_done": 1, "client_request_id": rid()}, headers=ph)
    today = client.get("/me/today", headers=ph).json()
    assert today["all_done_today"] is True and today["streak"]["days"] == 1
    assert today["adherence_7d"]["pct"] == 100 and today["adherence_7d"]["scheduled"] == 2

    # therapist sees the guided session but no measured score and no chart point
    sessions = client.get(f"/patients/{pid}/sessions", headers=th).json()
    assert all(x["mode"] == "GUIDED" for x in sessions)
    assert client.get(f"/patients/{pid}/trend", headers=th).json() == []
    assert client.get(f"/patients/{pid}", headers=th).json()["badge"]["label"] == "No sessions yet"


def test_pain_stop_and_not_well_skip_flag_the_therapist(client):
    th, ph, user, pid = new_patient_with_plan(client, "p4c@x.com")
    squat, elbow = client.get("/me/today", headers=ph).json()["items"]
    s = client.post(
        "/my/sessions/guided",
        json={"plan_id": squat["id"], "sets_done": 1, "stopped": True, "pain_stop": True, "client_request_id": rid()},
        headers=ph,
    ).json()
    assert s["status"] == "INTERRUPTED" and s["review_flag"] == "PAIN_STOP"

    r = client.post("/my/sessions/skip", json={"reason": "Fever", "not_well": True, "client_request_id": rid()}, headers=ph)
    assert r.status_code == 201 and r.json()["skipped"] == 2  # both items still open today
    status = {i["exercise_type"]: i["today_status"] for i in client.get("/me/today", headers=ph).json()["items"]}
    assert status == {"mini_squat": "PARTIAL", "elbow_flexion": "SKIPPED"}

    flags = client.get(f"/patients/{pid}", headers=th).json()["review_flags"]
    assert {f["flag"] for f in flags} == {"PAIN_STOP", "NOT_WELL"}
    assert any(f["note"] == "Fever" for f in flags)


def test_paused_plan_shows_reason_and_blocks(client):
    th, ph, user, pid = new_patient_with_plan(client, "p4d@x.com")
    live = next(p for p in client.get(f"/patients/{pid}/exercise-plans", headers=th).json() if p["status"] == "ACTIVE")
    item_id = live["items"][0]["id"]
    client.patch(f"/exercise-plans/{live['id']}", json={"action": "PAUSE", "reason": "Wait for X-ray"}, headers=th)
    today = client.get("/me/today", headers=ph).json()
    assert today["plan_status"] == "PAUSED" and today["plan_status_reason"] == "Wait for X-ray" and today["items"] == []
    r = client.post("/my/sessions/guided", json={"plan_id": item_id, "sets_done": 1, "client_request_id": rid()}, headers=ph)
    assert r.status_code == 404


def test_other_patient_cannot_use_my_items(client):
    th, ph, user, pid = new_patient_with_plan(client, "p4e@x.com")
    item_id = client.get("/me/today", headers=ph).json()["items"][0]["id"]
    other, _ = login(client, "patient@rehabrep.demo", "patient123")
    r = client.post("/my/sessions/guided", json={"plan_id": item_id, "sets_done": 1, "client_request_id": rid()}, headers=other)
    assert r.status_code == 404
    # therapists cannot use patient routes
    assert client.get("/me/today", headers=th).status_code == 403


def test_camera_session_saved_by_runner_counts_as_done(client):
    """session_runner.py saves through crud.save_session - check status/mode and the today list."""
    from crud import get_plan, save_session
    from database import SessionLocal

    th, ph, user, pid = new_patient_with_plan(client, "p4f@x.com")
    item = client.get("/me/today", headers=ph).json()["items"][0]  # mini_squat 2 x 5
    summary = {
        "prescribed_reps": 10, "reps_done": 10, "good_reps": 9, "under_reps": 1, "over_reps": 0,
        "accuracy_pct": 90.0, "completion_pct": 100.0, "adherence_pct": 90.0, "max_angle": 98.0,
        "avg_peak_angle": 92.0, "duration_s": 40.0, "plan_followed": "YES",
    }
    reps = [{"rep_number": n, "peak_angle": 92.0, "result": "GOOD"} for n in range(1, 11)]
    db = SessionLocal()
    try:
        s = save_session(db, get_plan(db, item["id"]), summary, reps, source="test.mp4")
        sid = s.id
    finally:
        db.close()
    rep = client.get(f"/sessions/{sid}", headers=ph).json()
    assert rep["mode"] == "TRACKED" and rep["status"] == "COMPLETED" and rep["measured"] and len(rep["reps"]) == 10
    status = {i["exercise_type"]: i["today_status"] for i in client.get("/me/today", headers=ph).json()["items"]}
    assert status["mini_squat"] == "DONE"
    assert len(client.get(f"/patients/{pid}/trend", headers=th).json()) == 1