"""
ReHabRep - Database tables.

users              admins, therapists and patients (role = ADMIN | THERAPIST | PATIENT)
therapist_profiles professional details + verification status (PENDING | APPROVED | REJECTED)
audit_logs         who did what, when and why (verification, suspension, prescriptions ...)
invitations        single-use links a therapist sends so a patient can set their own password
patients           patient profile, linked to a user and to their therapist
prescriptions      one VERSION of a patient's plan (DRAFT | ACTIVE | PAUSED | ENDED | SUPERSEDED | DISCARDED)
exercise_plans     one prescribed exercise inside a prescription version (sets, reps, hold, rest,
                   side, angle range, days, time). Sessions point at this row, so editing a plan
                   (= a new version with new rows) never changes old session reports.
sessions        one row per exercise session (the adherence report)
rep_logs        one row per rep inside a session

Encryption (see crypto.py):
  EVERY data column is stored ENCRYPTED (names, emails, roles, surgery type,
  notes, plans, angles, rep counts, results, pain scores, dates).
  Stored plain only:
    - id / *_id columns  -> row numbers that link the tables together
    - email_hash         -> HMAC fingerprint used to find a user at login
    - password_hash      -> salted PBKDF2 hash (one-way, cannot be decrypted)
  Because values are encrypted, the database cannot sort or filter them;
  crud.py does that in Python.
"""

from datetime import datetime

from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from crypto import EncryptedBool, EncryptedDateTime, EncryptedFloat, EncryptedInt, EncryptedText
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(EncryptedText, nullable=False)  # encrypted
    email = Column(EncryptedText, nullable=False)  # encrypted
    email_hash = Column(String(64), unique=True, nullable=False, index=True)  # blind index for login
    password_hash = Column(String(255), nullable=False)  # "!" = no password yet (invited patient)
    role = Column(EncryptedText, nullable=False)  # encrypted: ADMIN | THERAPIST | PATIENT
    # encrypted: ACTIVE | SUSPENDED | INVITED (invite sent, no password yet) | DRAFT (patient record, no invite yet)
    status = Column(EncryptedText, nullable=False, default="ACTIVE")
    status_reason = Column(EncryptedText, nullable=True)  # encrypted: why suspended / reactivated
    created_at = Column(EncryptedDateTime, default=datetime.utcnow)  # encrypted

    therapist_profile = relationship(
        "TherapistProfile", back_populates="user", uselist=False, foreign_keys="TherapistProfile.user_id"
    )

    patient_profile = relationship(
        "Patient", back_populates="user", uselist=False, foreign_keys="Patient.user_id"
    )
    patients = relationship(
        "Patient", back_populates="therapist", foreign_keys="Patient.therapist_id"
    )


class TherapistProfile(Base):
    """Professional details submitted by a therapist, and the admin's verification decision."""

    __tablename__ = "therapist_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # all encrypted
    profession = Column(EncryptedText, nullable=False)  # PHYSIOTHERAPIST | DOCTOR
    workplace = Column(EncryptedText, nullable=True)
    phone = Column(EncryptedText, nullable=True)
    registration_number = Column(EncryptedText, nullable=False)
    issuing_body = Column(EncryptedText, nullable=False)
    status = Column(EncryptedText, nullable=False, default="PENDING")  # PENDING | APPROVED | REJECTED
    decision_reason = Column(EncryptedText, nullable=True)
    register_check_note = Column(EncryptedText, nullable=True)  # admin's note on the public-register lookup
    reviewed_at = Column(EncryptedDateTime, nullable=True)
    submitted_at = Column(EncryptedDateTime, default=datetime.utcnow)
    document_file = Column(EncryptedText, nullable=True)  # name of the ENCRYPTED file on disk
    document_name = Column(EncryptedText, nullable=True)  # original file name
    document_type = Column(EncryptedText, nullable=True)  # application/pdf | image/jpeg | image/png

    user = relationship("User", back_populates="therapist_profile", foreign_keys=[user_id])
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_id])


class AuditLog(Base):
    """Append-only record of important actions (never edited or deleted by the app)."""

    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # all encrypted
    action = Column(EncryptedText, nullable=False)  # e.g. THERAPIST_APPROVED, USER_SUSPENDED
    target_type = Column(EncryptedText, nullable=True)  # USER | PATIENT | PLAN | SESSION
    target_id = Column(EncryptedInt, nullable=True)
    reason = Column(EncryptedText, nullable=True)
    created_at = Column(EncryptedDateTime, default=datetime.utcnow)

    actor = relationship("User", foreign_keys=[actor_id])


class Invitation(Base):
    """Single-use, expiring link that lets an invited patient choose their own password."""

    __tablename__ = "invitations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # the invited patient's account
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)  # SHA-256 of the link token
    # all encrypted
    expires_at = Column(EncryptedDateTime, nullable=False)
    used_at = Column(EncryptedDateTime, nullable=True)
    revoked = Column(EncryptedBool, nullable=False, default=False)
    created_at = Column(EncryptedDateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id])
    created_by = relationship("User", foreign_keys=[created_by_id])


class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    therapist_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    surgery_type = Column(EncryptedText, nullable=True)  # encrypted, e.g. "Knee replacement (left)"
    notes = Column(EncryptedText, nullable=True)  # encrypted
    created_at = Column(EncryptedDateTime, default=datetime.utcnow)  # encrypted

    user = relationship("User", back_populates="patient_profile", foreign_keys=[user_id])
    therapist = relationship("User", back_populates="patients", foreign_keys=[therapist_id])
    plans = relationship("ExercisePlan", back_populates="patient", cascade="all, delete-orphan")
    prescriptions = relationship("Prescription", back_populates="patient", cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="patient", cascade="all, delete-orphan")


class Prescription(Base):
    """One version of a patient's exercise plan. Saving changes creates a NEW version."""

    __tablename__ = "prescriptions"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    previous_id = Column(Integer, ForeignKey("prescriptions.id"), nullable=True)  # the version this replaced
    # all encrypted
    version = Column(EncryptedInt, nullable=False, default=1)
    status = Column(EncryptedText, nullable=False, default="DRAFT")  # DRAFT|ACTIVE|PAUSED|ENDED|SUPERSEDED|DISCARDED
    note = Column(EncryptedText, nullable=True)  # general note to the patient
    status_reason = Column(EncryptedText, nullable=True)  # why paused / ended
    created_at = Column(EncryptedDateTime, default=datetime.utcnow)
    activated_at = Column(EncryptedDateTime, nullable=True)
    ended_at = Column(EncryptedDateTime, nullable=True)

    patient = relationship("Patient", back_populates="prescriptions")
    created_by = relationship("User", foreign_keys=[created_by_id])
    # ordered by id = the order the therapist added them (position is encrypted, so the DB can't sort it)
    items = relationship("ExercisePlan", back_populates="prescription", order_by="ExercisePlan.id")


class ExercisePlan(Base):
    """One prescribed exercise (a "plan item"). Sessions reference this exact row."""

    __tablename__ = "exercise_plans"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    prescription_id = Column(Integer, ForeignKey("prescriptions.id"), nullable=True)
    # all encrypted
    exercise_type = Column(EncryptedText, nullable=False, default="mini_squat")  # key in EXERCISES
    condition = Column(EncryptedText, nullable=True)  # the assessed condition this item was chosen for
    sets = Column(EncryptedInt, nullable=False, default=3)
    reps_per_set = Column(EncryptedInt, nullable=False, default=10)
    hold_s = Column(EncryptedInt, nullable=True)  # seconds to hold at the end of the movement
    rest_s = Column(EncryptedInt, nullable=True)  # seconds of rest between sets
    side = Column(EncryptedText, nullable=True)  # LEFT | RIGHT | BOTH
    min_angle = Column(EncryptedFloat, nullable=False)
    max_angle = Column(EncryptedFloat, nullable=False)
    days = Column(EncryptedText, nullable=True)  # "0,1,2,3,4" = Mon..Fri (0 = Monday)
    time_of_day = Column(EncryptedText, nullable=True)  # "08:30" in the patient's time zone
    note = Column(EncryptedText, nullable=True)  # therapist's note shown with this exercise
    active = Column(EncryptedBool, nullable=False, default=True)  # True only while its prescription is ACTIVE
    created_at = Column(EncryptedDateTime, default=datetime.utcnow)

    patient = relationship("Patient", back_populates="plans")
    prescription = relationship("Prescription", back_populates="items")
    sessions = relationship("Session", back_populates="plan")

    @property
    def prescribed_reps(self):
        return self.sets * self.reps_per_set


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    plan_id = Column(Integer, ForeignKey("exercise_plans.id"), nullable=False)
    # all encrypted
    started_at = Column(EncryptedDateTime, default=datetime.utcnow)
    ended_at = Column(EncryptedDateTime, default=datetime.utcnow)

    # Copy of the plan at the time of the session (plans can change later)
    min_angle = Column(EncryptedFloat, nullable=False)
    max_angle = Column(EncryptedFloat, nullable=False)
    prescribed_reps = Column(EncryptedInt, nullable=False)

    reps_done = Column(EncryptedInt, nullable=False, default=0)
    good_reps = Column(EncryptedInt, nullable=False, default=0)
    under_reps = Column(EncryptedInt, nullable=False, default=0)
    over_reps = Column(EncryptedInt, nullable=False, default=0)
    accuracy_pct = Column(EncryptedFloat, nullable=False, default=0.0)
    completion_pct = Column(EncryptedFloat, nullable=False, default=0.0)
    adherence_pct = Column(EncryptedFloat, nullable=False, default=0.0)
    max_angle_reached = Column(EncryptedFloat, nullable=True)
    avg_peak_angle = Column(EncryptedFloat, nullable=True)
    duration_s = Column(EncryptedFloat, nullable=True)
    plan_followed = Column(EncryptedText, nullable=False, default="NO")  # YES | PARTLY | NO
    pain_score = Column(EncryptedInt, nullable=True)  # 0-10, patient check-in
    source = Column(EncryptedText, nullable=True)

    patient = relationship("Patient", back_populates="sessions")
    plan = relationship("ExercisePlan", back_populates="sessions")
    # Ordered by id (= order the reps were saved); rep_number is encrypted so the DB can't sort it
    reps = relationship("RepLog", back_populates="session", cascade="all, delete-orphan", order_by="RepLog.id")


class RepLog(Base):
    __tablename__ = "rep_logs"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    # all encrypted
    rep_number = Column(EncryptedInt, nullable=False)
    peak_angle = Column(EncryptedFloat, nullable=False)
    result = Column(EncryptedText, nullable=False)  # GOOD | UNDER | OVER
    duration_s = Column(EncryptedFloat, nullable=True)
    time_s = Column(EncryptedFloat, nullable=True)

    session = relationship("Session", back_populates="reps")