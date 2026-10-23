"""
Doctors must provide a NEET certificate and a medical practice registration certificate; an admin can
upload certificates for a clinician; approval is refused until every required certificate is on file.

Run from D:\\PROJECT\\KSR (venv active):
    python -m pytest tests -q
"""

from test_phase4_patient_flow import client, login  # noqa: F401 (client is a fixture)

from crud import create_therapist
from database import SessionLocal

PDF = b"%PDF-1.4 demo certificate"
FORM = {
    "name": "Dr. Meena (Doctor)",
    "password": "doctor1234",
    "profession": "DOCTOR",
    "registration_number": "TN-MED-12345",
    "issuing_body": "State Medical Council",
}


def pdf(name):
    return (name, PDF, "application/pdf")


def test_doctor_needs_both_certificates_to_register(client):
    only_one = client.post("/auth/register-therapist", data={**FORM, "email": "doc1@x.com"},
                           files={"medical_certificate": pdf("reg.pdf")})
    assert only_one.status_code == 400 and "NEET" in only_one.json()["detail"]

    ok = client.post("/auth/register-therapist", data={**FORM, "email": "doc2@x.com"},
                     files={"neet_certificate": pdf("neet.pdf"), "medical_certificate": pdf("reg.pdf")})
    assert ok.status_code == 201, ok.text

    h, user = login(client, "doc2@x.com", "doctor1234")
    v = user["therapist"]
    assert v["status"] == "PENDING" and v["missing_documents"] == []
    assert {d["kind"] for d in v["documents"]} == {"NEET", "MEDICAL_REGISTRATION"}
    # pending: no patients until an admin approves
    assert client.get("/patients", headers=h).status_code == 403
    assert client.post("/patients", json={"name": "P", "email": "p-doc2@x.com"}, headers=h).status_code == 403


def test_physiotherapist_needs_council_certificate(client):
    r = client.post("/auth/register-therapist", data={**FORM, "email": "physio9@x.com", "profession": "PHYSIOTHERAPIST"})
    assert r.status_code == 400 and "Physiotherapy council" in r.json()["detail"]
    r = client.post("/auth/register-therapist", data={**FORM, "email": "physio9@x.com", "profession": "PHYSIOTHERAPIST"},
                    files={"physio_certificate": pdf("council.pdf")})
    assert r.status_code == 201


def test_admin_uploads_missing_certificates_then_approves(client):
    db = SessionLocal()
    try:  # a doctor account with no certificates yet (e.g. registered before this rule)
        doc = create_therapist(db, "Dr. Ravi (Doctor)", "doc3@x.com", "doctor1234", "DOCTOR", "KA-1", "NMC")
        uid = doc.id
    finally:
        db.close()

    ah, _ = login(client, "admin@rehabrep.demo", "admin12345")
    r = client.post(f"/admin/therapists/{uid}/decision", json={"decision": "APPROVE", "reason": "Looks fine"}, headers=ah)
    assert r.status_code == 400 and "missing" in r.json()["detail"].lower()

    # the doctor cannot upload for someone else, and admins can only add required kinds
    dh, _ = login(client, "doc3@x.com", "doctor1234")
    assert client.post(f"/admin/therapists/{uid}/documents", data={"kind": "NEET"}, files={"document": pdf("n.pdf")},
                       headers=dh).status_code == 403
    assert client.post(f"/admin/therapists/{uid}/documents", data={"kind": "PHYSIO_REGISTRATION"},
                       files={"document": pdf("x.pdf")}, headers=ah).status_code == 400
    bad = client.post(f"/admin/therapists/{uid}/documents", data={"kind": "NEET"},
                      files={"document": ("n.pdf", b"not a pdf", "application/pdf")}, headers=ah)
    assert bad.status_code == 400

    for kind in ("NEET", "MEDICAL_REGISTRATION"):
        r = client.post(f"/admin/therapists/{uid}/documents", data={"kind": kind}, files={"document": pdf(f"{kind}.pdf")},
                        headers=ah)
        assert r.status_code == 201, r.text
    v = r.json()["verification"]
    assert v["missing_documents"] == [] and all(d["uploaded_by_admin"] for d in v["documents"])

    one = v["documents"][0]["id"]
    got = client.get(f"/admin/therapists/{uid}/documents/{one}", headers=ah)
    assert got.status_code == 200 and got.content == PDF

    r = client.post(f"/admin/therapists/{uid}/decision", json={"decision": "APPROVE", "reason": "Certificates checked"}, headers=ah)
    assert r.status_code == 200 and r.json()["verification"]["status"] == "APPROVED"
    assert client.get("/patients", headers=dh).status_code == 200  # now the doctor can take patients

    actions = [e["action"] for e in client.get("/admin/audit-log?limit=30", headers=ah).json()]
    assert "CREDENTIAL_UPLOADED_BY_ADMIN" in actions
