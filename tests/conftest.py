"""
Test setup: uses a throw-away SQLite database and a throw-away encryption key,
so tests never touch your real PostgreSQL data or secrets\\rehabrep.key.
"""

import os
import sys
import tempfile

TMP = tempfile.mkdtemp(prefix="rehabrep_test_")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "test.db").replace("\\", "/")
os.environ["REHABREP_DATA_DIR"] = TMP
os.environ["REHABREP_SECRET"] = "test-token-secret"
from cryptography.fernet import Fernet  # noqa: E402

os.environ["REHABREP_ENC_KEY"] = Fernet.generate_key().decode()

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))