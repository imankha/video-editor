"""
T1330: auth.sqlite schema must enforce NOT NULL email.

After T1330, the `users` table cannot contain guest rows (NULL email).
`init_auth_db()` must:
  1. Delete any pre-existing rows with NULL email (and their sessions).
  2. Rebuild the table so `email` is NOT NULL.
  3. Reject subsequent INSERTs with NULL email via IntegrityError.

Also: `create_guest_user` must no longer exist — it's the entry point that
created null-email rows in the first place.
"""
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import auth_db


@pytest.fixture
def temp_auth_db(tmp_path, monkeypatch):
    """Point auth_db at a fresh file per test."""
    db_path = tmp_path / "auth.sqlite"
    monkeypatch.setattr(auth_db, "AUTH_DB_PATH", db_path)
    # Ensure R2 disabled so init doesn't try to backup
    monkeypatch.setattr(auth_db, "_r2_enabled", lambda: False)
    yield db_path


def _seed_with_guests(db_path: Path):
    """Create a users table as it existed pre-T1330 and insert 2 guests + 1 real user."""
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE users (
            user_id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            google_id TEXT UNIQUE,
            verified_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            last_seen_at TEXT,
            credit_summary INTEGER DEFAULT 0,
            picture_url TEXT
        );
        CREATE TABLE sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(user_id),
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.execute("INSERT INTO users (user_id, email) VALUES ('g1', NULL)")
    conn.execute("INSERT INTO users (user_id, email) VALUES ('g2', NULL)")
    conn.execute("INSERT INTO users (user_id, email) VALUES ('u1', 'real@example.com')")
    conn.execute("INSERT INTO sessions (session_id, user_id, expires_at) VALUES ('s1','g1','2099-01-01')")
    conn.commit()
    conn.close()


def test_init_deletes_existing_guest_rows(temp_auth_db):
    _seed_with_guests(temp_auth_db)
    auth_db.init_auth_db()
    conn = sqlite3.connect(str(temp_auth_db))
    guests = conn.execute("SELECT COUNT(*) FROM users WHERE email IS NULL").fetchone()[0]
    real = conn.execute("SELECT COUNT(*) FROM users WHERE email = 'real@example.com'").fetchone()[0]
    guest_sessions = conn.execute("SELECT COUNT(*) FROM sessions WHERE user_id = 'g1'").fetchone()[0]
    conn.close()
    assert guests == 0, "guest rows must be deleted on init"
    assert real == 1, "real users must be preserved"
    assert guest_sessions == 0, "sessions for deleted guests must also be removed"


def test_init_enforces_not_null_email(temp_auth_db):
    auth_db.init_auth_db()
    conn = sqlite3.connect(str(temp_auth_db))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO users (user_id, email) VALUES ('x', NULL)")
        conn.commit()
    conn.close()


def test_init_preserves_unknown_columns(temp_auth_db):
    """Legacy R2-restored DBs may carry extra columns (e.g. `credits`) that
    aren't in the canonical CREATE TABLE. The rebuild must preserve them."""
    conn = sqlite3.connect(str(temp_auth_db))
    conn.executescript("""
        CREATE TABLE users (
            user_id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            google_id TEXT UNIQUE,
            verified_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            last_seen_at TEXT,
            credits INTEGER DEFAULT 0
        );
        CREATE TABLE sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(user_id),
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.execute("INSERT INTO users (user_id, email, credits) VALUES ('u1','a@b.c',42)")
    conn.commit()
    conn.close()

    auth_db.init_auth_db()

    conn = sqlite3.connect(str(temp_auth_db))
    cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    credits = conn.execute("SELECT credits FROM users WHERE user_id='u1'").fetchone()[0]
    conn.close()
    assert "credits" in cols, "unknown legacy columns must be preserved"
    assert credits == 42, "data in unknown columns must survive rebuild"


def test_create_guest_user_removed():
    assert not hasattr(auth_db, "create_guest_user"), (
        "create_guest_user must be removed in T1330"
    )
