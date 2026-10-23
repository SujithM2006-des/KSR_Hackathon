"""
ReHabRep - Create the tables and add DEMO data (safe to run many times).

Run:
    python src\\seed.py

Creates (only if missing):
  Admin              : from REHABREP_ADMIN_EMAIL / REHABREP_ADMIN_PASSWORD
                       (demo default admin@rehabrep.demo / admin12345 if not set)
  Therapist APPROVED : therapist@rehabrep.demo / therapist123
  Therapist PENDING  : pending.therapist@rehabrep.demo / pending123   (to demo the verification queue)
  Patient            : patient@rehabrep.demo / patient123
  Plan               : Knee bend, 1 set x 8 reps, range 90-145 deg (matches the squat test video)

All of this is SYNTHETIC DEMO DATA - not real people, not real credentials.
"""

import os
from datetime import datetime

from crud import (
    create_patient,
    create_plan,
    create_therapist,
    create_user,
    get_active_plans,
    get_user_by_email,
    log_action,
    migrate_legacy_documents,
    registration_kind,
    save_credential_document,
)
from database import DATABASE_URL, SessionLocal, init_db
from models import Patient

ADMIN = {
    "name": "ReHabRep Admin (demo)",
    "email": os.getenv("REHABREP_ADMIN_EMAIL", "admin@rehabrep.demo"),
    "password": os.getenv("REHABREP_ADMIN_PASSWORD", "admin12345"),
}
THERAPIST = {
    "name": "Dr. Priya (Physio)",
    "email": "therapist@rehabrep.demo",
    "password": "therapist123",
    "profession": "PHYSIOTHERAPIST",
    "registration_number": "DEMO-PT-0001",
    "issuing_body": "State Physiotherapy Council",
    "workplace": "Demo Rehab Clinic, Salem",
    "phone": "+91 90000 00001",
}
PENDING_THERAPIST = {
    "name": "Dr. Arun (Physio, pending)",
    "email": "pending.therapist@rehabrep.demo",
    "password": "pending123",
    "profession": "PHYSIOTHERAPIST",
    "registration_number": "DEMO-PT-0002",
    "issuing_body": "Indian Association of Physiotherapists (IAP)",
    "workplace": "Demo Physio Centre, Coimbatore",
    "phone": "+91 90000 00002",
}
PATIENT = {
    "name": "Ravi Kumar",
    "email": "patient@rehabrep.demo",
    "password": "patient123",
    "surgery_type": "Knee replacement (left)",
}


def demo_pdf(title: str) -> bytes:
    """A tiny valid PDF that clearly says it is NOT a real certificate."""
    text = f"DEMO DOCUMENT - NOT A REAL CERTIFICATE - {title}"
    stream = f"BT /F1 14 Tf 40 760 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def ensure_therapist(db, data, status, admin=None):
    user = get_user_by_email(db, data["email"])
    if user is not None:
        print(f"Therapist exists : {user.email} ({user.therapist_profile.status if user.therapist_profile else '-'})")
        return user
    user = create_therapist(
        db,
        data["name"],
        data["email"],
        data["password"],
        data["profession"],
        data["registration_number"],
        data["issuing_body"],
        workplace=data["workplace"],
        phone=data["phone"],
        status=status,
    )
    save_credential_document(
        db, user.therapist_profile, registration_kind(data["profession"]), "demo_registration_certificate.pdf",
        "application/pdf", demo_pdf(data["name"]), user.id,
    )
    if status == "APPROVED" and admin is not None:
        profile = user.therapist_profile
        profile.decision_reason = "Demo account - approved by seed script"
        profile.register_check_note = "Demo data, no real register lookup"
        profile.reviewed_by_id = admin.id
        profile.reviewed_at = datetime.utcnow()
        db.commit()
        log_action(db, admin.id, "THERAPIST_APPROVED", "USER", user.id, "Demo account - approved by seed script")
    print(f"Created therapist: {user.email} ({status})")
    return user


def main():
    init_db()
    db = SessionLocal()
    try:
        migrate_legacy_documents(db)
        admin = get_user_by_email(db, ADMIN["email"])
        if admin is None:
            admin = create_user(db, ADMIN["name"], ADMIN["email"], ADMIN["password"], "ADMIN")
            log_action(db, None, "ADMIN_CREATED", "USER", admin.id, "Created by seed script")
            print(f"Created admin    : {admin.email}")
        else:
            print(f"Admin exists     : {admin.email}")

        therapist = ensure_therapist(db, THERAPIST, "APPROVED", admin)
        ensure_therapist(db, PENDING_THERAPIST, "PENDING")

        patient_user = get_user_by_email(db, PATIENT["email"])
        if patient_user is None:
            patient = create_patient(
                db,
                PATIENT["name"],
                PATIENT["email"],
                PATIENT["password"],
                therapist.id,
                surgery_type=PATIENT["surgery_type"],
            )
            print(f"Created patient  : {PATIENT['email']}")
        else:
            patient = db.query(Patient).filter(Patient.user_id == patient_user.id).first()
            print(f"Patient exists   : {PATIENT['email']}")

        plans = get_active_plans(db, patient.id)
        if plans:
            plan = plans[0]
            print("Active plan exists")
        else:
            plan = create_plan(db, patient.id, "mini_squat", sets=1, reps_per_set=8, min_angle=90, max_angle=145)
            print("Created plan")

        print("\n----------------------------------------------")
        print(f"Database   : {DATABASE_URL}")
        print(f"Admin      : {ADMIN['email']}" + ("  (demo default password)" if "REHABREP_ADMIN_PASSWORD" not in os.environ else ""))
        print(f"Patient ID : {patient.id}  ({PATIENT['name']})")
        print(
            f"Plan ID    : {plan.id}  ({plan.exercise_type}, {plan.sets}x{plan.reps_per_set}, "
            f"{plan.min_angle:.0f}-{plan.max_angle:.0f} deg)"
        )
        print("----------------------------------------------")
        print("All accounts above are SYNTHETIC DEMO DATA.")
    finally:
        db.close()


if __name__ == "__main__":
    main()