"""
Admin can clear one patient's session history (fresh demo). Plans, consent and other patients are untouched.

Run from D:\\PROJECT\\KSR (venv active):
    python -m pytest tests -q
"""

from test_phase4_patient_flow import client, login, new_patient_with_plan, rid  # noqa: F401 (client is a fixture)

from database import SessionLocal
from models import RepLog, Session


def give_consent(client, ph):
    version = client.get("/consent").json()["version"]
    client.post("/me/consent", json={"version": version, "camera_allowed": False}, headers=ph)


def test_admin_clears_one_patients_sessions(client):
    th, ph, _, pid = new_patient_with_plan(client, "clear-a@x.com")
    _, other_ph, _, other_pid = new_patient_with_plan(client, "clear-b@x.com")
    for headers in (ph, other_ph):
        give_consent(client, headers)
        item = client.get("/me/today", headers=headers).json()["items"][0]
        client.post("/my/sessions/guided", json={"plan_id": item["id"], "sets_done": 2, "client_request_id": rid()},
                    headers=headers)
        client.post("/my/sessions/skip", json={"plan_id": client.get("/me/today", headers=headers).json()["items"][1]["id"],
                                               "reason": "tired", "client_request_id": rid()}, headers=headers)
    assert len(client.get(f"/patients/{pid}/sessions", headers=th).json()) == 2

    # only admins
    body = {"reason": "Fresh demo for the jury"}
    assert client.post(f"/admin/patients/{pid}/clear-sessions", json=body, headers=th).status_code == 403
    ah, _ = login(client, "admin@rehabrep.demo", "admin12345")
    assert client.post(f"/admin/patients/{pid}/clear-sessions", json={"reason": ""}, headers=ah).status_code == 422
    assert client.post("/admin/patients/999999/clear-sessions", json=body, headers=ah).status_code == 404

    r = client.post(f"/admin/patients/{pid}/clear-sessions", json=body, headers=ah)
    assert r.status_code == 200 and r.json()["deleted"] == 2

    assert client.get(f"/patients/{pid}/sessions", headers=th).json() == []
    assert len(client.get(f"/patients/{other_pid}/sessions", headers=th).json()) == 2  # other patient untouched
    today = client.get("/me/today", headers=ph).json()
    assert len(today["items"]) == 2 and all(i["today_status"] == "PENDING" for i in today["items"])  # plan kept
    assert client.get("/me", headers=ph).json()["consent"]["given"] is True  # consent kept

    db = SessionLocal()
    try:
        assert db.query(Session).filter(Session.patient_id == pid).count() == 0
        orphans = db.query(RepLog).outerjoin(Session, RepLog.session_id == Session.id).filter(Session.id.is_(None))
        assert orphans.count() == 0
    finally:
        db.close()

    log = client.get("/admin/audit-log?limit=20", headers=ah).json()
    entry = next(e for e in log if e["action"] == "SESSIONS_CLEARED")
    assert "2 session(s)" in entry["reason"] and "jury" in entry["reason"]
