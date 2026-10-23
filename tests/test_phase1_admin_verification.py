"""
Phase 1 tests: roles, therapist registration, admin verification, suspension, audit log.

Run from D:\\PROJECT\\KSR (venv active):
    pip install pytest httpx
    python -m pytest tests -q
"""

import pytest
from fastapi.testclient import TestClient

import seed
from api import app
from seed import demo_pdf


@pytest.fixture(scope="module")
def client():
    seed.main()
    with TestClient(app) as c:
        yield c


def login(client, email, password):
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}, r.json()["user"]


def register(client, email, doc=None, doc_type="application/pdf", password="strongpass1"):
    doc = demo_pdf("test") if doc is None else doc
    return client.post(
        "/auth/register-therapist",
        data={
            "name": "Test Therapist",
            "email": email,
            "password": password,
            "profession": "PHYSIOTHERAPIST",
            "registration_number": "TEST-123",
            "issuing_body": "State Physiotherapy Council",
            "workplace": "Test Clinic",
        },
        files={"document": ("cert.pdf", doc, doc_type)},
    )


def test_roles_login(client):
    _, admin = login(client, "admin@rehabrep.demo", "admin12345")
    assert admin["role"] == "ADMIN"
    _, t = login(client, "therapist@rehabrep.demo", "therapist123")
    assert t["role"] == "THERAPIST" and t["therapist"]["status"] == "APPROVED"
    _, p = login(client, "patient@rehabrep.demo", "patient123")
    assert p["role"] == "PATIENT"


def test_registration_validation(client):
    assert register(client, "bad1@x.com", password="short").status_code == 400
    assert register(client, "bad2@x.com", doc=b"not a pdf").status_code == 400  # signature check
    assert register(client, "bad3@x.com", doc=b"GIF89a", doc_type="image/gif").status_code == 400
    assert register(client, "therapist@rehabrep.demo").status_code == 409


def test_pending_therapist_is_blocked_until_approved(client):
    assert register(client, "new.t@x.com").status_code == 201
    h, me = login(client, "new.t@x.com", "strongpass1")
    assert me["therapist"]["status"] == "PENDING"
    assert client.get("/patients", headers=h).status_code == 403  # no patient access yet

    ah, _ = login(client, "admin@rehabrep.demo", "admin12345")
    queue = client.get("/admin/therapists?status=PENDING", headers=ah).json()
    new = next(t for t in queue if t["email"] == "new.t@x.com")
    doc = client.get(f"/admin/therapists/{new['id']}/document", headers=ah)
    assert doc.status_code == 200 and doc.content.startswith(b"%PDF")

    # Reason is required
    assert client.post(f"/admin/therapists/{new['id']}/decision", json={"decision": "REJECT", "reason": ""}, headers=ah).status_code == 422
    r = client.post(
        f"/admin/therapists/{new['id']}/decision",
        json={"decision": "REJECT", "reason": "Registration number not found"},
        headers=ah,
    )
    assert r.json()["verification"]["status"] == "REJECTED"
    v = client.get("/therapist/verification", headers=h).json()
    assert v["status"] == "REJECTED" and v["decision_reason"] == "Registration number not found"

    # Resubmit -> pending again, then approve -> patient access unlocked
    r = client.post("/therapist/verification", data={"registration_number": "TEST-999"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "PENDING"
    client.post(f"/admin/therapists/{new['id']}/decision", json={"decision": "APPROVE", "reason": "Checked on register"}, headers=ah)
    assert client.get("/patients", headers=h).status_code == 200


def test_access_denied_for_wrong_roles(client):
    th, _ = login(client, "therapist@rehabrep.demo", "therapist123")
    ph, _ = login(client, "patient@rehabrep.demo", "patient123")
    for h in (th, ph):
        assert client.get("/admin/overview", headers=h).status_code == 403
        assert client.get("/admin/therapists/2/document", headers=h).status_code == 403
    assert client.get("/admin/overview").status_code == 401


def test_document_requires_admin_and_is_encrypted_on_disk(client):
    import os

    from crud import CREDENTIAL_DIR

    files = os.listdir(CREDENTIAL_DIR)
    assert files
    for name in files:
        with open(os.path.join(CREDENTIAL_DIR, name), "rb") as f:
            assert not f.read().startswith(b"%PDF")  # stored encrypted


def test_suspend_and_reactivate(client):
    ah, admin = login(client, "admin@rehabrep.demo", "admin12345")
    _, p = login(client, "patient@rehabrep.demo", "patient123")
    assert client.post(f"/admin/users/{p['id']}/suspend", json={"reason": ""}, headers=ah).status_code == 422
    assert client.post(f"/admin/users/{p['id']}/suspend", json={"reason": "Test suspension"}, headers=ah).status_code == 200
    r = client.post("/auth/login", json={"email": "patient@rehabrep.demo", "password": "patient123"})
    assert r.status_code == 403 and "suspended" in r.json()["detail"].lower()
    assert client.post(f"/admin/users/{admin['id']}/suspend", json={"reason": "self"}, headers=ah).status_code == 400
    assert client.post(f"/admin/users/{p['id']}/reactivate", json={"reason": "Back to normal"}, headers=ah).status_code == 200
    login(client, "patient@rehabrep.demo", "patient123")


def test_overview_patients_and_audit(client):
    ah, _ = login(client, "admin@rehabrep.demo", "admin12345")
    ov = client.get("/admin/overview", headers=ah).json()
    assert ov["therapists_by_status"]["APPROVED"] >= 2 and ov["patients_total"] >= 1
    groups = client.get("/admin/patients", headers=ah).json()
    assert any(g["patients"] for g in groups)
    actions = [e["action"] for e in client.get("/admin/audit-log", headers=ah).json()]
    for a in ("THERAPIST_REJECTED", "THERAPIST_APPROVED", "USER_SUSPENDED", "USER_REACTIVATED", "CREDENTIAL_VIEWED"):
        assert a in actions


def test_second_admin(client):
    ah, _ = login(client, "admin@rehabrep.demo", "admin12345")
    r = client.post("/admin/admins", json={"name": "Second Admin", "email": "admin2@x.com", "password": "secondadmin1"}, headers=ah)
    assert r.status_code == 201
    login(client, "admin2@x.com", "secondadmin1")