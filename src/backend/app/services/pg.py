"""
Central Postgres connection pool for global data (auth, sharing, game storage).

Per-user SQLite databases are unaffected -- they stay as local files synced to R2.
This module replaces the SQLite-based auth_db and sharing_db connection management.
"""

import logging
import os
import threading
import time
from contextlib import contextmanager

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

logger = logging.getLogger(__name__)

_pool: ThreadedConnectionPool | None = None

# T6200: the pool's capacity. psycopg2's ThreadedConnectionPool does NOT block when
# full — ``getconn()`` RAISES ``PoolError`` the instant ``len(_used) == maxconn``.
# Before T6200 the single event loop serialized every checkout so the pool never
# neared this ceiling; once request-path blocking I/O is offloaded to the 32-thread
# executor (see main.py lifespan), up to 32 worker threads can call getconn at once.
# Past 10 that raises PoolError, which db_sync catches and turns into a 503 —
# trading the latency we set out to fix for user-visible errors under exactly the
# concurrency this task enables. ``_checkout_gate`` (a BoundedSemaphore sized to
# this same number) closes that gap: threads WAIT for a free connection instead of
# racing getconn past the ceiling. Sized from the one constant so pool capacity and
# the gate can never drift apart.
_MAX_POOL_CONN = 10

# Bounds concurrent pool checkouts to _MAX_POOL_CONN so getconn is never called
# while maxconn connections are already out (which would raise PoolError). Created
# in init_pg_pool alongside the pool; enforced structurally in the single checkout
# path (get_pg), so no PG caller can bypass it. None until the pool is initialized.
_checkout_gate: threading.BoundedSemaphore | None = None

# T4960 idle-age gate: only pre-ping a checked-out connection that has sat idle in
# the pool longer than this. Connections reused within the window were just proven
# alive by the prior request, so the ~1 round-trip ``SELECT 1`` is skipped on the
# hot path (measured ~2.4ms/checkout otherwise). Fly closes idle client sockets on
# a minutes timescale (keepalives_idle=30s), so 5s is far below any real death
# window while still eliminating the steady-state overhead.
_IDLE_PING_THRESHOLD_S = 5.0

# id(conn) -> monotonic time the connection was last returned to the pool. Used
# only to compute idle age for the gate above; entries are removed on discard.
_last_returned: dict[int, float] = {}

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
    invite_code VARCHAR(8),
    -- T8110: internal/test-account flag. Marks our own accounts (dev, admin,
    -- seed) so the admin panel + population aggregates can exclude them from
    -- "how are real users doing" reads. Data, not config: set from the admin UI
    -- (POST /users/{id}/test-account), seeded for the known emails by v026.
    is_test_account BOOLEAN NOT NULL DEFAULT false
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
    share_type TEXT NOT NULL CHECK (share_type IN ('video', 'game', 'annotation_playback', 'collection', 'game_link')),
    sharer_user_id TEXT NOT NULL REFERENCES users(user_id),
    sharer_profile_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    collection_definition JSONB,
    collection_is_public BOOLEAN NOT NULL DEFAULT false,
    sharer_default_sport TEXT
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
    game_date TEXT,
    first_clip_start REAL,
    clip_names JSONB
);
CREATE INDEX IF NOT EXISTS idx_share_games_game ON share_games(game_id);
CREATE INDEX IF NOT EXISTS idx_share_games_recipient_profile ON share_games(recipient_profile_id);

-- T5730: per-claimer record of a public game-link claim (idempotency + T5740 funnel).
CREATE TABLE IF NOT EXISTS share_claims (
    id SERIAL PRIMARY KEY,
    share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    claimer_user_id TEXT NOT NULL,
    claimer_profile_id TEXT,
    include_annotations BOOLEAN NOT NULL DEFAULT false,
    local_game_id INTEGER,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_claims_unique ON share_claims(share_id, claimer_user_id);
CREATE INDEX IF NOT EXISTS idx_share_claims_share ON share_claims(share_id);

CREATE TABLE IF NOT EXISTS pending_teammate_shares (
    id SERIAL PRIMARY KEY,
    share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    sharer_user_id TEXT NOT NULL,
    sharer_profile_id TEXT NOT NULL,
    -- ADVISORY ONLY (T7550): the address this share was emailed to. It is NOT a
    -- security gate -- the share link/id can be forwarded and claimed by ANY
    -- logged-in account that holds it (open-by-token, matching game_link, T5730).
    -- Used for discovery filtering and referral attribution, never to authorize
    -- a claim. Renamed from recipient_email so readers are not misled.
    invited_email TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    tag_name TEXT,
    clip_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_profile_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_shares_email ON pending_teammate_shares(invited_email);
CREATE INDEX IF NOT EXISTS idx_pending_shares_share ON pending_teammate_shares(share_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_shares_unique
ON pending_teammate_shares(share_id, game_id, tag_name)
WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_shares_email_unresolved
ON pending_teammate_shares(invited_email) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shares_sharer_active
ON shares(sharer_user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_id TEXT NOT NULL REFERENCES users(user_id),
    referred_id TEXT NOT NULL REFERENCES users(user_id) UNIQUE,
    channel VARCHAR(20) NOT NULL,
    source_id TEXT,
    inherited_sport TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_channel ON referrals(channel);

CREATE TABLE IF NOT EXISTS user_segments (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    acquired_at DATE NOT NULL DEFAULT CURRENT_DATE,
    origin TEXT NOT NULL DEFAULT 'organic',
    referrer_id TEXT REFERENCES users(user_id),
    signup_method TEXT CHECK (signup_method IN ('google', 'otp')),
    total_spent_cents INTEGER NOT NULL DEFAULT 0,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_usage_seconds INTEGER NOT NULL DEFAULT 0,
    current_session_start TIMESTAMPTZ,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    click_source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_segments_acquired ON user_segments(acquired_at);
CREATE INDEX IF NOT EXISTS idx_segments_origin ON user_segments(origin);
CREATE INDEX IF NOT EXISTS idx_segments_referrer ON user_segments(referrer_id);
CREATE INDEX IF NOT EXISTS idx_segments_last_active ON user_segments(last_active_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_segments_acquired_origin ON user_segments(acquired_at, origin);

-- T5770: per-user per-day engaged-usage buckets. Complements the all-time
-- running total on user_segments.total_usage_seconds; summed over a trailing
-- window (e.g. last 7 days) for the admin dashboard. Written ONLY via
-- analytics.add_usage_seconds (single write path), same txn as the total.
CREATE TABLE IF NOT EXISTS user_usage_daily (
    user_id TEXT NOT NULL,
    day DATE NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS user_actions (
    user_id TEXT NOT NULL REFERENCES users(user_id),
    action TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'unknown',
    first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, action, platform)
);
CREATE INDEX IF NOT EXISTS idx_actions_action ON user_actions(action);
CREATE INDEX IF NOT EXISTS idx_actions_action_user ON user_actions(action, user_id);
CREATE INDEX IF NOT EXISTS idx_actions_platform ON user_actions(platform);
-- T8110 note: the admin list_users global-sort CTE aggregates ALL of
-- user_actions per-user (SUM(count) FILTER by action). A (user_id, action)
-- INCLUDE (count) covering index was evaluated and DELIBERATELY NOT added: the
-- planner picks a plain seq scan for an UNFILTERED whole-table GROUP BY (an
-- index-only scan of the entire index is not cheaper than the heap scan), so the
-- index would only add write amplification. Measured: ~7ms for 40k rows / 5k
-- users. If a future change filters this aggregate (WHERE), revisit then.

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
    sessions_started INTEGER NOT NULL DEFAULT 0,
    invites_sent INTEGER NOT NULL DEFAULT 0,
    shares_viewed INTEGER NOT NULL DEFAULT 0,
    exports_started INTEGER NOT NULL DEFAULT 0,
    -- T7510: attempt/outcome/failure daily rollups. games_created above now
    -- means upload ATTEMPTS; these are the durable outcomes + coarse failures.
    game_uploads_succeeded INTEGER NOT NULL DEFAULT 0,
    game_uploads_failed INTEGER NOT NULL DEFAULT 0,
    clips_attempted INTEGER NOT NULL DEFAULT 0,
    clips_failed INTEGER NOT NULL DEFAULT 0,
    -- T8370: clip_uploaded daily rollup (direct-upload origin, distinct from
    -- clips_created's annotation origin above).
    clips_uploaded INTEGER NOT NULL DEFAULT 0,
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

-- T5840: credits move out of the per-user SQLite last-write-wins blob.
-- No FK to users(user_id) -- X-User-ID/e2e users legitimately have no Postgres
-- users row and still get the signup bonus (session_init.py).
CREATE TABLE IF NOT EXISTS credits (
    user_id     TEXT PRIMARY KEY,
    balance     INTEGER     NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT        NOT NULL,
    amount          INTEGER     NOT NULL CHECK (amount <> 0),
    source          TEXT        NOT NULL,
    idempotency_key TEXT        NOT NULL,
    reference_id    TEXT,
    video_seconds   REAL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_idem
    ON credit_transactions(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created
    ON credit_transactions(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_source
    ON credit_transactions(source);

-- T890 reservations, moved verbatim (Phase 1). Unlike the SQLite version this
-- table is shared by every user, so it needs an explicit user_id column --
-- the per-user file no longer provides that scoping for free.
-- profile_id (M6, review round 2): recover_orphaned_reservations needs to know
-- WHICH profile's export_jobs to check for a still-live job before releasing --
-- without it, recovery is table-global and can release another machine's
-- active in-flight reservation (a free export / silent revenue leak).
CREATE TABLE IF NOT EXISTS credit_reservations (
    job_id        TEXT PRIMARY KEY,
    user_id       TEXT        NOT NULL,
    profile_id    TEXT,
    amount        INTEGER     NOT NULL,
    video_seconds REAL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user ON credit_reservations(user_id);

-- The cutover gate (T5840 4a). One row (id=1). ready_at IS NULL until an admin
-- confirms the backfill report shows zero drift; credit_ledger mutations 503
-- until then. Reads are never gated.
-- last_report/last_report_at (M7, review round 2): open-gate consumes the
-- STORED report from the most recent GET backfill-report call instead of
-- recomputing a full unbounded per-user scan (R2 downloads + Stripe list)
-- synchronously inside the gate-open request.
CREATE TABLE IF NOT EXISTS credit_migration_state (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    ready_at         TIMESTAMPTZ,
    backfilled_users INTEGER NOT NULL DEFAULT 0,
    last_report      JSONB,
    last_report_at   TIMESTAMPTZ
);
"""

_SEED_SQL = """
INSERT INTO admin_users (email) VALUES ('imankh@gmail.com') ON CONFLICT DO NOTHING;
"""


def init_pg_pool():
    global _pool, _checkout_gate
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL environment variable is required")
    try:
        _pool = ThreadedConnectionPool(
            minconn=2, maxconn=_MAX_POOL_CONN, dsn=dsn, cursor_factory=RealDictCursor,
            keepalives=1, keepalives_idle=30, keepalives_interval=5, keepalives_count=3,
        )
    except psycopg2.OperationalError:
        raise RuntimeError("Postgres is not running — start it with: docker start reelballers-postgres") from None
    # T6200: gate concurrent checkouts to the pool's capacity — see _MAX_POOL_CONN.
    _checkout_gate = threading.BoundedSemaphore(_MAX_POOL_CONN)
    logger.info("[PG] Connection pool initialized (min=2, max=%d, keepalive=30s, checkout gate=%d)",
                _MAX_POOL_CONN, _MAX_POOL_CONN)


def close_pg_pool():
    global _pool, _checkout_gate
    if _pool:
        _pool.closeall()
        _pool = None
        _checkout_gate = None
        logger.info("[PG] Connection pool closed")


@contextmanager
def get_pg():
    """Yield a connection from the pool. Auto-commits on clean exit, rolls back on error.

    T4960: pre-pings the checked-out connection with a cheap ``SELECT 1`` before
    yielding. Fly Postgres closes idle client sockets while the pool still holds
    them (``conn.closed`` stays 0), so keepalives alone did not stop the FIRST
    request after an idle window from eating a dead socket -> 500. On a failed
    ping the stale connection is discarded (``putconn(..., close=True)``) and the
    next one is fetched.

    Idle-age gate: the ping is skipped for a connection reused within
    ``_IDLE_PING_THRESHOLD_S`` (the prior request already proved it alive), so the
    steady-state hot path pays zero extra round-trips. Only connections that have
    sat idle past the window — i.e. the exact after-idle case this fixes — are
    pinged.

    Bound: after a long idle window EVERY pooled connection is stale (up to
    ``maxconn`` of them sit dead in the free list), so a fixed 2-attempt bound
    still 500s the first request — verified in the T4960 live-drive. Discarding a
    stale conn shrinks the pool, so within ``maxconn + 1`` checkouts psycopg2 must
    hand back a freshly-minted (live) connection; that is the bound. Steady state
    is one attempt. If the server itself is down, ``getconn()`` raises on connect
    and the error propagates (not recoverable here, by design).
    """
    if _pool is None:
        raise RuntimeError("Postgres pool not initialized -- call init_pg_pool() first")

    # T6200: block until a connection slot is free instead of racing getconn past
    # maxconn (which raises PoolError -> a 503 under an authed burst). Acquired
    # OUTERMOST so the permit is held for the whole checkout — including the
    # stale-discard retry loop below, which putconn()s before each re-getconn and
    # so never holds more than one connection per permit. With permits == maxconn,
    # at most maxconn threads are ever inside the getconn region, so getconn can
    # never see the pool already full. Bare acquire/release (not a `with`) because
    # this is a generator-based contextmanager; the outer `finally` guarantees the
    # release even if setup below raises. A None gate (pool set directly in a test)
    # degrades to the pre-T6200 unbounded behavior.
    gate = _checkout_gate
    if gate is not None:
        gate.acquire()
    try:
        conn = None
        last_err = None
        max_attempts = getattr(_pool, "maxconn", 1) + 1
        for attempt in range(1, max_attempts + 1):
            candidate = _pool.getconn()
            if candidate.closed:
                logger.warning(
                    "[PG] discarded stale connection (already closed, attempt %d/%d)",
                    attempt, max_attempts,
                )
                _last_returned.pop(id(candidate), None)
                _pool.putconn(candidate, close=True)
                continue
            returned_at = _last_returned.get(id(candidate))
            if returned_at is not None and (time.monotonic() - returned_at) < _IDLE_PING_THRESHOLD_S:
                conn = candidate  # recently proven alive -> skip the ping (hot path)
                break
            try:
                with candidate.cursor() as cur:
                    cur.execute("SELECT 1")
                candidate.rollback()  # don't leak the ping's read transaction to the caller
                conn = candidate
                break
            except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
                last_err = e
                logger.warning(
                    "[PG] discarded stale connection during pre-ping (attempt %d/%d): %s",
                    attempt, max_attempts, e,
                )
                _last_returned.pop(id(candidate), None)
                _pool.putconn(candidate, close=True)
        if conn is None:
            raise last_err if last_err is not None else psycopg2.OperationalError(
                "[PG] no live connection available after pre-ping retries"
            )

        try:
            yield conn
            conn.commit()
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
            logger.warning(f"[PG] Connection error, discarding: {e}")
            try:
                conn.rollback()
            except (psycopg2.InterfaceError, psycopg2.OperationalError):
                pass
            raise
        except Exception:
            try:
                conn.rollback()
            except (psycopg2.InterfaceError, psycopg2.OperationalError):
                pass
            raise
        finally:
            _pool.putconn(conn, close=conn.closed)
            # Reconcile the idle-age ledger AFTER putconn: psycopg2 closes any conn
            # returned while the free list is already at minconn (overflow) or flagged
            # close=True, so its post-putconn ``closed`` state is the source of truth.
            # Stamping only re-pooled (still-open) conns keeps the ledger bounded to
            # the live pool and prevents leaked entries from causing id()-reuse skips.
            if conn.closed:
                _last_returned.pop(id(conn), None)
            else:
                _last_returned[id(conn)] = time.monotonic()
    finally:
        # T6200: release the checkout permit LAST — after putconn has returned the
        # connection to the pool — so a waiting thread only wakes once a slot is
        # genuinely free.
        if gate is not None:
            gate.release()


def init_pg_schema():
    with get_pg() as conn:
        cur = conn.cursor()
        try:
            cur.execute(_SCHEMA_DDL)
        except (psycopg2.errors.UndefinedColumn, psycopg2.errors.UndefinedTable):
            conn.rollback()
            logger.warning("[PG] DDL failed (pending migrations) — running Postgres migrations before retry")
            from app.migrations.postgres import RUNNER as PG_RUNNER
            applied = PG_RUNNER.run(conn, "postgres")
            for m in applied:
                logger.info(f"[PG] Applied migration v{m.version}: {m.description}")
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
