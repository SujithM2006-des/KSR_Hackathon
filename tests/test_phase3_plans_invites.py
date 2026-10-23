"""
Phase 3 tests: patient invitations and versioned prescriptions.

Run from D:\\PROJECT\\KSR (venv active):
    python -m pytest tests -q
"""

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
    return {"Authorization": "Bearer " + r.json()["token"]}


def item(**kw):
    base = {
        "exercise_type": "mini_squat",
        "condition": "Knee replacement (left)",
        "sets": 2,
        "reps_per_set": 8,
        "hold_s": 2,
        "rest_s": 30,
        "side": "LEFT",
        "min_angle": 60,
        "max_angle": 100,
        "days": [0, 2, 4],
        "time_of_day": "08:30",
        "note": "Slowly",
    }
    base.update(kw)
    return base


def test_invite_flow(client):
    th = login(client, "therapist@rehabrep.demo", "therapist123")
    r = client.post("/patients", json={"name": "Invited Person", "email": "inv1@x.com", "surgery_type": "ACL"}, headers=th)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["account_status"] == "INVITED" and body["invitation"]["url"]
    token = body["invitation"]["url"].rsplit("/", 1)[1]

    # cannot log in before accepting
    assert client.post("/auth/login", json={"email": "inv1@x.com", "password": "anything12"}).status_code == 401

    info = client.get(f"/invitations/{token}").json()
    assert info["name"] == "Invited Person" and "***" in info["email"]

    assert client.post(f"/auth/invitations/{token}/accept", json={"password": "short"}).status_code == 400
    r = client.post(f"/auth/invitations/{token}/accept", json={"password": "mypassword1"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "PATIENT"
    # single use
    assert client.post(f"/auth/invitations/{token}/accept", json={"password": "mypassword2"}).status_code == 410
    login(client, "inv1@x.com", "mypassword1")


def test_draft_patient_and_resend(client):
    th = login(client, "therapist@rehabrep.demo", "therapist123")
    r = client.post("/patients", json={"name": "Draft Person", "email": "draft1@x.com", "send_invite": False}, headers=th)
    assert r.json()["account_status"] == "DRAFT" and r.json()["invitation"] is None
    pid = r.json()["id"]
    first = client.post(f"/patients/{pid}/invitation", headers=th).json()["url"].rsplit("/", 1)[1]
    second = client.post(f"/patients/{pid}/invitation", headers=th).json()["url"].rsplit("/", 1)[1]
    assert client.get(f"/invitations/{first}").status_code == 404  # old link revoked
    assert client.get(f"/invitations/{second}").status_code == 200
    assert client.post("/patients", json={"name": "Dup", "email": "draft1@x.com"}, headers=th).status_code == 409


def test_other_therapist_cannot_see_patient(client):
    ah = login(client, "admin@rehabrep.demo", "admin12345")
    # approve the pending demo therapist so they can call patient routes
    pending = [t for t in client.get("/admin/therapists?status=PENDING", headers=ah).json() if t["email"].startswith("pending.")]
    if pending:
        client.post(f"/admin/therapists/{pending[0]['id']}/decision", json={"decision": "APPROVE", "reason": "test ok"}, headers=ah)
    other = login(client, "pending.therapist@rehabrep.demo", "pending123")
    assert client.get("/patients/1", headers=other).status_code == 404
    assert client.get("/patients/1/exercise-plans", headers=other).status_code == 404
    assert client.post("/patients/1/exercise-plans", json={"items": [item()]}, headers=other).status_code == 404


def test_plan_validation(client):
    th = login(client, "therapist@rehabrep.demo", "therapist123")
    bad = [
        {"items": []},
        {"items": [item(min_angle=120, max_angle=100)]},
        {"items": [item(days=[])]},
        {"items": [item(exercise_type="moonwalk")]},
        {"items": [item(), item()]},  # duplicate exercise + side
        {"items": [item(time_of_day="25:00")]},
        {"items": [item(side="UP")]},
        {"status": "PUBLISHED", "items": [item()]},
    ]
    for b in bad:
        assert client.post("/patients/1/exercise-plans", json=b, headers=th).status_code == 400, b
    assert client.post("/patients/1/exercise-plans", json={"items": [item(sets=0)]}, headers=th).status_code == 422


def test_versioning_keeps_history(client):
    th = login(client, "therapist@rehabrep.demo", "therapist123")
    plans = client.get("/patients/1/exercise-plans", headers=th).json()
    v1 = next(p for p in plans if p["status"] == "ACTIVE")
    old_item = v1["items"][0]

    # draft is hidden from the patient
    d = client.post("/patients/1/exercise-plans", json={"status": "DRAFT", "items": [item(exercise_type="hip_flexion")]}, headers=th)
    assert d.status_code == 201 and d.json()["status"] == "DRAFT"
    ph = login(client, "patient@rehabrep.demo", "patient123")
    assert [p["exercise_type"] for p in client.get("/my/plans", headers=ph).json()] == [old_item["exercise_type"]]

    # publish the draft as a new version: old version superseded, draft discarded
    r = client.post(
        "/patients/1/exercise-plans",
        json={"status": "ACTIVE", "draft_id": d.json()["id"], "note": "Week 2", "items": [item(), item(exercise_type="hip_flexion", side="RIGHT")]},
        headers=th,
    )
    assert r.status_code == 201, r.text
    v2 = r.json()
    assert v2["status"] == "ACTIVE" and v2["version"] > v1["version"] and len(v2["items"]) == 2
    statuses = {p["id"]: p["status"] for p in client.get("/patients/1/exercise-plans", headers=th).json()}
    assert statuses[v1["id"]] == "SUPERSEDED" and statuses[d.json()["id"]] == "DISCARDED"

    my = client.get("/my/plans", headers=ph).json()
    assert {p["exercise_type"] for p in my} == {"mini_squat", "hip_flexion"}
    first = next(p for p in my if p["exercise_type"] == "mini_squat")
    assert first["side"] == "LEFT" and first["days"] == [0, 2, 4] and first["time_of_day"] == "08:30" and first["hold_s"] == 2

    # old item cannot be started any more
    assert client.post("/my/sessions/start", json={"plan_id": old_item["id"]}, headers=ph).status_code == 404


def test_pause_resume_end(client):
    th = login(client, "therapist@rehabrep.demo", "therapist123")
    ph = login(client, "patient@rehabrep.demo", "patient123")
    live = next(p for p in client.get("/patients/1/exercise-plans", headers=th).json() if p["status"] == "ACTIVE")
    assert client.patch(f"/exercise-plans/{live['id']}", json={"action": "PAUSE"}, headers=th).status_code == 400  # reason needed
    r = client.patch(f"/exercise-plans/{live['id']}", json={"action": "PAUSE", "reason": "Swelling, review first"}, headers=th)
    assert r.json()["status"] == "PAUSED"
    assert client.get("/my/plans", headers=ph).json() == []
    assert client.get("/patients/1", headers=th).json()["plan_status"] == "PAUSED"
    assert client.patch(f"/exercise-plans/{live['id']}", json={"action": "RESUME"}, headers=th).json()["status"] == "ACTIVE"
    assert len(client.get("/my/plans", headers=ph).json()) == 2
    assert client.patch(f"/exercise-plans/{live['id']}", json={"action": "DISCARD"}, headers=th).status_code == 400
    r = client.patch(f"/exercise-plans/{live['id']}", json={"action": "END", "reason": "Goals reached"}, headers=th)
    assert r.json()["status"] == "ENDED"
    assert client.get("/my/plans", headers=ph).json() == []


def test_patient_cannot_change_plans_and_edit(client):
    ph = login(client, "patient@rehabrep.demo", "patient123")
    assert client.post("/patients/1/exercise-plans", json={"items": [item()]}, headers=ph).status_code == 403
    th = login(client, "therapist@rehabrep.demo", "therapist123")
    r = client.patch("/patients/1", json={"surgery_type": "Knee replacement (left), week 3"}, headers=th)
    assert r.status_code == 200 and r.json()["surgery_type"].endswith("week 3")
    ah = login(client, "admin@rehabrep.demo", "admin12345")
    actions = [e["action"] for e in client.get("/admin/audit-log", headers=ah).json()]
    for a in ("PATIENT_INVITED", "INVITE_ACCEPTED", "PLAN_SAVED", "PLAN_DRAFT_SAVED", "PLAN_PAUSED", "PLAN_ENDED", "PATIENT_UPDATED"):
        assert a in actions, a