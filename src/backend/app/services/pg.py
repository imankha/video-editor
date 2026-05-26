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
    terms_accepted_at TIMESTAMPTZ,
    terms_version TEXT,
    invite_code VARCHAR(8)
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

CREATE TABLE IF NOT EXISTS game_ref_counts (
    blake3_hash TEXT PRIMARY KEY,
    ref_count INTEGER NOT NULL DEFAULT 0,
    latest_expiry TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS r2_grace_deletions (
    blake3_hash TEXT PRIMARY KEY,
    grace_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shares (
    id SERIAL PRIMARY KEY,
    share_token TEXT UNIQUE NOT NULL,
    share_type TEXT NOT NULL CHECK (share_type IN ('video', 'game', 'annotation_playback')),
    sharer_user_id TEXT NOT NULL REFERENCES users(user_id),
    sharer_profile_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(share_token);
CREATE INDEX IF NOT EXISTS idx_shares_sharer ON shares(sharer_user_id);
CREATE INDEX IF NOT EXISTS idx_shares_recipient ON shares(recipient_email);

CREATE TABLE IF NOT EXISTS share_videos (
    share_id INTEGER PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL,
    video_filename TEXT NOT NULL,
    video_name TEXT,
    video_duration REAL,
    is_public BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_share_videos_video ON share_videos(video_id);

CREATE TABLE IF NOT EXISTS share_games (
    share_id INTEGER PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL,
    tag_name TEXT,
    recipient_profile_id TEXT,
    materialized_at TIMESTAMPTZ,
    game_name TEXT,
    game_blake3 TEXT,
    first_clip_start REAL,
    clip_names JSONB
);
CREATE INDEX IF NOT EXISTS idx_share_games_game ON share_games(game_id);
CREATE INDEX IF NOT EXISTS idx_share_games_recipient_profile ON share_games(recipient_profile_id);

CREATE TABLE IF NOT EXISTS pending_teammate_shares (
    id SERIAL PRIMARY KEY,
    share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    sharer_user_id TEXT NOT NULL,
    sharer_profile_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    tag_name TEXT,
    clip_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_profile_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_shares_email ON pending_teammate_shares(recipient_email);
CREATE INDEX IF NOT EXISTS idx_pending_shares_share ON pending_teammate_shares(share_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_shares_unique
ON pending_teammate_shares(share_id, game_id, tag_name)
WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_shares_email_unresolved
ON pending_teammate_shares(recipient_email) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shares_sharer_active
ON shares(sharer_user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_id TEXT NOT NULL REFERENCES users(user_id),
    referred_id TEXT NOT NULL REFERENCES users(user_id) UNIQUE,
    channel VARCHAR(20) NOT NULL,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_channel ON referrals(channel);

CREATE TABLE IF NOT EXISTS user_milestones (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),

    -- Cohort dimensions (set at signup, immutable)
    install_day DATE NOT NULL DEFAULT CURRENT_DATE,
    origin_type TEXT NOT NULL DEFAULT 'organic'
        CHECK (origin_type IN ('organic', 'viral', 'ad_campaign')),
    origin_channel TEXT,
    signup_method TEXT CHECK (signup_method IN ('google', 'otp')),

    -- Journey milestones (NULL = not reached yet)
    signup_completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_game_created_at TIMESTAMPTZ,
    first_clip_created_at TIMESTAMPTZ,
    first_export_completed_at TIMESTAMPTZ,
    first_share_completed_at TIMESTAMPTZ,
    first_credit_purchase_at TIMESTAMPTZ,
    pwa_installed_at TIMESTAMPTZ,

    -- Lifetime counts
    game_created_count INTEGER NOT NULL DEFAULT 0,
    clip_created_count INTEGER NOT NULL DEFAULT 0,
    export_completed_count INTEGER NOT NULL DEFAULT 0,
    export_failed_count INTEGER NOT NULL DEFAULT 0,
    share_completed_count INTEGER NOT NULL DEFAULT 0,
    credit_purchase_count INTEGER NOT NULL DEFAULT 0,
    credits_consumed_count INTEGER NOT NULL DEFAULT 0,

    -- Activity
    session_count INTEGER NOT NULL DEFAULT 0,
    pwa_session_count INTEGER NOT NULL DEFAULT 0,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_export_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_milestones_install_day ON user_milestones(install_day);
CREATE INDEX IF NOT EXISTS idx_milestones_origin ON user_milestones(origin_type);
CREATE INDEX IF NOT EXISTS idx_milestones_cohort ON user_milestones(install_day, origin_type);

CREATE TABLE IF NOT EXISTS user_flow_events (
    user_id TEXT NOT NULL REFERENCES users(user_id),
    event TEXT NOT NULL,
    first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, event)
);
CREATE INDEX IF NOT EXISTS idx_flow_events_event ON user_flow_events(event);

CREATE TABLE IF NOT EXISTS daily_counters (
    counter_date DATE NOT NULL DEFAULT CURRENT_DATE,
    origin_type TEXT NOT NULL DEFAULT 'all',
    signups INTEGER NOT NULL DEFAULT 0,
    games_created INTEGER NOT NULL DEFAULT 0,
    clips_created INTEGER NOT NULL DEFAULT 0,
    exports_completed INTEGER NOT NULL DEFAULT 0,
    exports_failed INTEGER NOT NULL DEFAULT 0,
    shares_completed INTEGER NOT NULL DEFAULT 0,
    credit_purchases INTEGER NOT NULL DEFAULT 0,
    credits_consumed INTEGER NOT NULL DEFAULT 0,
    annotations_completed INTEGER NOT NULL DEFAULT 0,
    framing_exports INTEGER NOT NULL DEFAULT 0,
    overlay_exports INTEGER NOT NULL DEFAULT 0,
    video_downloads INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (counter_date, origin_type)
);

CREATE TABLE IF NOT EXISTS bug_reports (
    id SERIAL PRIMARY KEY,
    reporter_email TEXT,
    description TEXT,
    page_url TEXT,
    user_agent TEXT,
    build TEXT,
    editor_context JSONB,
    actions JSONB,
    console_logs JSONB,
    screenshot_r2_key TEXT,
    logs_r2_key TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    duplicate_of INTEGER REFERENCES bug_reports(id),
    admin_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_duplicate ON bug_reports(duplicate_of);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
        if conn.closed:
            _pool.putconn(conn, close=True)
            conn = _pool.getconn()
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except (psycopg2.InterfaceError, psycopg2.OperationalError):
            pass
        raise
    finally:
        _pool.putconn(conn, close=conn.closed)


def init_pg_schema():
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(_SCHEMA_DDL)
        cur.execute(_SEED_SQL)

        # T2847: Migrate clip_data JSONB → BYTEA (pre-launch, no real data to preserve)
        cur.execute("""
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'pending_teammate_shares' AND column_name = 'clip_data'
        """)
        row = cur.fetchone()
        if row and row["data_type"] == "jsonb":
            cur.execute("DELETE FROM pending_teammate_shares WHERE resolved_at IS NULL")
            cur.execute("DELETE FROM pending_teammate_shares")
            cur.execute("ALTER TABLE pending_teammate_shares ALTER COLUMN clip_data TYPE BYTEA USING ''::bytea")
            logger.info("[PG] Migrated pending_teammate_shares.clip_data from JSONB to BYTEA")

    logger.info("[PG] Schema initialized (all tables + indexes)")
