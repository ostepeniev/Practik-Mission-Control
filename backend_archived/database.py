import os
from sqlalchemy import create_engine, text as sqlalchemy_text
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./practik.db")
is_sqlite = DATABASE_URL.startswith("sqlite")

engine_kwargs = {"echo": False, "pool_pre_ping": not is_sqlite}
if is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def schema_for(name):
    """Return schema name for PostgreSQL, None for SQLite."""
    return None if is_sqlite else name


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables."""
    from backend.models import core, app, ai, audit  # noqa: F401
    if not is_sqlite:
        with engine.connect() as conn:
            for s in ['core', 'mart', 'ai', 'app', 'audit']:
                conn.execute(sqlalchemy_text(f'CREATE SCHEMA IF NOT EXISTS {s}'))
            conn.commit()
    Base.metadata.create_all(bind=engine)
