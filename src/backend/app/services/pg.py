"""
Central Postgres connection pool for global data (auth, sharing, game storage).

Per-user SQLite databases are unaffected -- they stay as local files synced to R2.
This module replaces the SQLite-based auth_db and sharing_db connection management.
"""

import logging
import os
from contextlib import contextmanager

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

logger = logging.getLogger(__name__)

_pool: ThreadedConnectionPool | None = None

_SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    google_id TEXT UNIQUE,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    picture_url TEXT,
    credit_summary JSONB,
    terms_accepted_at TIMESTAMPTZ,
    terms_version TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    impersonator_user_id TEXT,
    impersonation_expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS otp_codes (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email);

CREATE TABLE IF NOT EXISTS admin_users (
    email TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS impersonation_audit (
    id SERIAL PRIMARY KEY,
    admin_user_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('start', 'stop', 'expire')),
    ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_impersonation_audit_admin ON impersonation_audit(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_audit_target ON impersonation_audit(target_user_id);

CREATE TABLE IF NOT EXISTS game_storage_refs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    profile_id TEXT NOT NULL,
    blake3_hash TEXT NOT NULL,
    game_size_bytes BIGINT NOT NULL,
    storage_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, profile_id, blake3_hash)
);
CREATE INDEX IF NOT EXISTS idx_game_refs_hash ON game_storage_refs(blake3_hash);
CREATE INDEX IF NOT EXISTS idx_game_refs_user ON game_storage_refs(user_id);

CREATE TABLE IF NOT EXISTS r2_grace_deletions (
    blake3_hash TEXT PRIMARY KEY,
    grace_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared_videos (
    id SERIAL PRIMARY KEY,
    share_token TEXT UNIQUE NOT NULL,
    video_id INTEGER NOT NULL,
    sharer_user_id TEXT NOT NULL REFERENCES users(user_id),
    sharer_profile_id TEXT NOT NULL,
    video_filename TEXT NOT NULL,
    video_name TEXT,
    video_duration REAL,
    recipient_email TEXT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT false,
    shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    watched_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shared_videos_video_sharer ON shared_videos(video_id, sharer_user_id);
CREATE INDEX IF NOT EXISTS idx_shared_videos_sharer ON shared_videos(sharer_user_id);
CREATE INDEX IF NOT EXISTS idx_shared_videos_recipient ON shared_videos(recipient_email);
"""

_SEED_SQL = """
INSERT INTO admin_users (email) VALUES ('imankh@gmail.com') ON CONFLICT DO NOTHING;
"""


def init_pg_pool():
    global _pool
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL environment variable is required")
    _pool = ThreadedConnectionPool(minconn=2, maxconn=10, dsn=dsn, cursor_factory=RealDictCursor)
    logger.info("[PG] Connection pool initialized (min=2, max=10)")


def close_pg_pool():
    global _pool
    if _pool:
        _pool.closeall()
        _pool = None
        logger.info("[PG] Connection pool closed")


@contextmanager
def get_pg():
    """Yield a connection from the pool. Auto-commits on clean exit, rolls back on error."""
    if _pool is None:
        raise RuntimeError("Postgres pool not initialized -- call init_pg_pool() first")
    conn = _pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


def init_pg_schema():
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(_SCHEMA_DDL)
        cur.execute(_SEED_SQL)
    logger.info("[PG] Schema initialized (all tables + indexes)")
