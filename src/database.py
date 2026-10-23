"""
ReHabRep - Database connection (SQLAlchemy).

Default: a local SQLite file (data\\rehabrep.db) - zero setup, perfect for
the hackathon demo.

To use PostgreSQL instead, set the DATABASE_URL environment variable, e.g.
    $env:DATABASE_URL = "postgresql+psycopg2://postgres:password@localhost:5432/rehabrep"
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.getenv("REHABREP_DATA_DIR", os.path.join(PROJECT_ROOT, "data"))  # tests use a temp folder
os.makedirs(DATA_DIR, exist_ok=True)

DEFAULT_SQLITE_URL = "sqlite:///" + os.path.join(DATA_DIR, "rehabrep.db").replace("\\", "/")
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_SQLITE_URL)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def init_db():
    """Create all tables (safe to call many times)."""
    import models  # noqa: F401  (registers the tables on Base)

    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency: yields a DB session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()