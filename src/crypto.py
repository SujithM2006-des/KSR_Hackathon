"""
ReHabRep - Encryption helpers (field-level encryption of personal / medical data).

How it works
  - EVERY data column (names, emails, surgery type, notes, roles, plans, angles,
    rep counts, results, pain scores, dates ...) is ENCRYPTED before it is written
    to the database and DECRYPTED only inside the backend.
    In pgAdmin they appear as unreadable text like "gAAAAAB...".
  - Only row ids / links between tables (id, user_id, patient_id ...) and the two
    one-way fingerprints (email_hash, password_hash) are stored plain: the
    database needs them to connect rows, and they reveal nothing on their own.
  - Column types: EncryptedText, EncryptedInt, EncryptedFloat, EncryptedBool,
    EncryptedDateTime. Python code reads/writes normal values; the conversion
    to and from ciphertext happens automatically.
  - Because the database only holds ciphertext it cannot sort/filter/average
    these values - that is done in Python instead (see crud.py).
  - Algorithm: Fernet (cryptography library) = AES-128-CBC encryption +
    HMAC-SHA256 tamper check. A changed ciphertext is detected, not decrypted.
  - Encrypted values are random each time, so the database cannot search them.
    For login we store a separate "blind index" of the email: an HMAC-SHA256
    fingerprint. It lets us find a user by email without storing the email itself.

Where the key comes from (first match wins)
  1. Environment variable REHABREP_ENC_KEY
  2. Key file  D:\\PROJECT\\KSR\\secrets\\rehabrep.key  (created automatically on first run)

IMPORTANT
  - Back up the key. If it is lost, encrypted data CANNOT be recovered.
  - Never put the key in the database, in Git, or in the frontend.
"""

import base64
import hashlib
import hmac
import os
from datetime import datetime

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.types import Text, TypeDecorator

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_DIR = os.path.join(PROJECT_ROOT, "secrets")
KEY_FILE = os.path.join(KEY_DIR, "rehabrep.key")
UNREADABLE = "[encrypted - wrong key]"


def _load_key() -> bytes:
    env_key = os.getenv("REHABREP_ENC_KEY")
    if env_key:
        return env_key.strip().encode()

    if os.path.isfile(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            return f.read().strip()

    # First run: create a new random key and save it
    os.makedirs(KEY_DIR, exist_ok=True)
    key = Fernet.generate_key()
    with open(KEY_FILE, "wb") as f:
        f.write(key)
    print(f"[CRYPTO] New encryption key created: {KEY_FILE}  (back this file up!)")
    return key


_KEY = _load_key()
_FERNET = Fernet(_KEY)
# Separate key for the email fingerprint, derived from the main key
_INDEX_KEY = hashlib.sha256(b"rehabrep-blind-index:" + base64.urlsafe_b64decode(_KEY)).digest()


def encrypt(text):
    """str -> encrypted str (None stays None)."""
    if text is None:
        return None
    return _FERNET.encrypt(str(text).encode("utf-8")).decode("ascii")


def decrypt(token):
    """encrypted str -> original str (None stays None)."""
    if token is None:
        return None
    try:
        return _FERNET.decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return UNREADABLE


def encrypt_bytes(data: bytes) -> bytes:
    """Encrypt raw file contents (e.g. an uploaded credential document)."""
    return _FERNET.encrypt(data)


def decrypt_bytes(token: bytes) -> bytes:
    """Decrypt raw file contents. Raises InvalidToken if the key is wrong or the file was changed."""
    return _FERNET.decrypt(token)


def blind_index(value):
    """Deterministic HMAC-SHA256 fingerprint used to look up encrypted values (e.g. email)."""
    normalized = str(value).strip().lower().encode("utf-8")
    return hmac.new(_INDEX_KEY, normalized, hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# SQLAlchemy column types - encrypt on save, decrypt (and convert back) on load
# ---------------------------------------------------------------------------
class EncryptedText(TypeDecorator):
    """Text column stored encrypted. Use like Column(EncryptedText)."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt(value)

    def process_result_value(self, value, dialect):
        return decrypt(value)


class _EncryptedValue(TypeDecorator):
    """Base for non-text values: value -> text -> encrypted; encrypted -> text -> value."""

    impl = Text
    cache_ok = True

    def to_text(self, value):
        return str(value)

    def from_text(self, text):
        raise NotImplementedError

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return encrypt(self.to_text(value))

    def process_result_value(self, value, dialect):
        text = decrypt(value)
        if text is None or text == UNREADABLE:
            return None
        try:
            return self.from_text(text)
        except ValueError:
            return None


class EncryptedInt(_EncryptedValue):
    """Integer column stored encrypted."""

    def to_text(self, value):
        return str(int(value))

    def from_text(self, text):
        return int(text)


class EncryptedFloat(_EncryptedValue):
    """Decimal number column stored encrypted."""

    def to_text(self, value):
        return repr(float(value))

    def from_text(self, text):
        return float(text)


class EncryptedBool(_EncryptedValue):
    """True/False column stored encrypted."""

    def to_text(self, value):
        return "1" if value else "0"

    def from_text(self, text):
        return text == "1"


class EncryptedDateTime(_EncryptedValue):
    """Date/time column stored encrypted."""

    def to_text(self, value):
        return value.isoformat()

    def from_text(self, text):
        return datetime.fromisoformat(text)