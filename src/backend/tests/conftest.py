"""
Pytest configuration and shared fixtures for backend tests.
"""

import os
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import psycopg2
import pytest
from psycopg2.extras import RealDictCursor


def stamp_schema_head(conn, track: str) -> None:
    """Stamp `PRAGMA user_version` to the REAL head version for `track`
    ("profile_db" or "user_db") on an already-open sqlite3 connection.

    T5083 (2026-08-31 CI escalation, FIX 2): test fixtures across several
    files built a synthetic marker-only DB (no base schema tables) and left
    `PRAGMA user_version` at SQLite's default of 0 -- a state that cannot
    occur in real production (a fresh DB is always stamped to head
    immediately via `ensure_database`/`ensure_user_database`'s `is_fresh_db`
    branch, and any GENUINELY below-head DB was created via the real base
    schema long ago, so it always has every base table). With migration now
    firing on every `ensure_database`/`ensure_user_database` first access
    (not just the admin sweep), a `user_version=0` synthetic fixture makes
    the runner try to apply the FULL migration history against a DB missing
    tables those migrations assume exist -- an impossible-in-prod crash, not
    a real bug (CLAUDE.md: no defensive fixes for internal bugs that cannot
    occur; fix the fixture, not the seam). Use the REAL runner's
    `latest_version`, not a magic/sentinel number, so a future migration
    bump can't silently leave a fixture claiming to be at an OLD head.
    """
    if track == "profile_db":
        from app.migrations.profile_db import RUNNER as _RUNNER
    elif track == "user_db":
        from app.migrations.user_db import RUNNER as _RUNNER
    else:
        raise ValueError(f"stamp_schema_head: unknown track {track!r} (expected 'profile_db' or 'user_db')")
    conn.execute(f"PRAGMA user_version = {_RUNNER.latest_version}")


@pytest.fixture(autouse=True, scope="session")
def _set_default_profile_context():
    """Set a default profile context for all tests.

    T85a: All code paths that use r2_key() or get_user_data_path() now require
    a profile ID. This fixture ensures tests don't fail with "Profile ID not set"
    unless they explicitly reset_profile_id() to test that error case.

    Also pre-populates user_session_init's cache so middleware auto-resolve
    returns "testdefault" instead of doing R2 lookups for test users.
    """
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    set_current_profile_id("testdefault")
    # Pre-populate the init cache for common test user IDs so middleware
    # auto-resolve doesn't create random profiles via R2.
    # "a" kept for backward compat with tests that use X-User-ID: a
    for user_id in ("a", "testdefault"):
        _init_cache[user_id] = {"profile_id": "testdefault", "is_new_user": False}
    yield
    from app.profile_context import reset_profile_id
    reset_profile_id()
    _init_cache.clear()


@pytest.fixture(autouse=True)
def _register_test_profiles():
    """T7520: the middleware now 404s an X-Profile-ID the session user does not
    own (ownership guard against the impersonation cross-tenant write). Most
    backend tests drive requests with an 8-hex X-Profile-ID that they seed into
    session_init._init_cache but never register in a real user.sqlite `profiles`
    row, so under the raw guard every such request would 404.

    Rather than patch each test, teach the guard's registry loader to also treat
    each user's _init_cache selected profile as owned. Evaluated LAZILY (at guard
    time, inside the request), so it picks up profiles seeded by a test's own
    fixtures regardless of fixture ordering. A genuinely FOREIGN profile (one not
    seeded into _init_cache and not created via the real API) is still absent
    here and still 404s — the exact property the new T7520 security tests assert.
    The per-process registry cache is cleared around every test so one test's
    ownership set never leaks into the next.
    """
    import app.database as _db_module
    from app import session_init

    real_loader = session_init.load_registered_profile_ids

    def _loader(user_id):
        ids = set(real_loader(user_id))  # real user.sqlite registry (profiles created via API)
        cached = session_init._init_cache.get(user_id)
        if cached and cached.get("profile_id"):
            ids.add(cached["profile_id"])
        # Many legacy tests set up a profile.sqlite ON DISK directly (no API
        # create, no _init_cache seed). Treat a profile dir that already exists
        # under THIS user's own directory as owned. This is per-user scoped, so
        # a FOREIGN profile (one that lives under a DIFFERENT user's dir, as the
        # T7520 security tests construct) is not seen here and still 404s.
        # Read USER_DATA_BASE at call time: durable-sync tests patch
        # app.database.USER_DATA_BASE to a tmp dir for the duration of the test.
        profiles_dir = _db_module.USER_DATA_BASE / user_id / "profiles"
        if profiles_dir.is_dir():
            ids.update(p.name for p in profiles_dir.iterdir() if p.is_dir())
        frozen = frozenset(ids)
        session_init._profile_registry_cache[user_id] = frozen
        return frozen

    session_init._profile_registry_cache.clear()
    session_init.load_registered_profile_ids = _loader
    try:
        yield
    finally:
        session_init.load_registered_profile_ids = real_loader
        session_init._profile_registry_cache.clear()


@pytest.fixture(autouse=True, scope="session")
def _mock_pg_startup():
    """Prevent app startup from crashing when DATABASE_URL is not set.

    Tests that need real Postgres use the pg_conn fixture, which patches
    get_pg() directly and overrides this no-op.

    Also provides a stub get_pg that returns None from queries instead of
    crashing, so middleware auth checks (validate_session) gracefully
    return None rather than raising RuntimeError.
    """
    from unittest.mock import AsyncMock

    @contextmanager
    def _stub_get_pg():
        """No-op Postgres connection for tests without DATABASE_URL."""
        conn = MagicMock()
        cur = MagicMock()
        cur.fetchone.return_value = None
        cur.fetchall.return_value = []
        conn.cursor.return_value = cur
        yield conn

    with patch("app.services.pg.init_pg_pool"), \
         patch("app.services.pg.init_pg_schema"), \
         patch("app.services.pg.get_pg", _stub_get_pg), \
         patch("app.services.auth_db.get_pg", _stub_get_pg), \
         patch("app.services.sharing_db.get_pg", _stub_get_pg), \
         patch("app.services.credit_ledger.get_pg", _stub_get_pg), \
         patch("app.services.credit_backfill.get_pg", _stub_get_pg), \
         patch("app.services.cleanup.start_cleanup_loop", new_callable=AsyncMock), \
         patch("app.services.cleanup.stop_cleanup_loop", new_callable=AsyncMock):
        yield


_TEST_USER_IDS = (
    "admin-user", "regular-user", "sharer-user", "recipient-user",
    "user-1", "user-2", "test-user-1", "test-user", "user-a", "user-b", "user-c",
    "other-admin", "target-user", "other-regular",
    "claimer-user", "claimer-b",  # T5730 claim-flow tests
    "t5220-dl-sharer", "t5220-dl-recipient",  # T5220 share-download gating tests
)


@pytest.fixture
def pg_conn(monkeypatch):
    """Provide a clean Postgres database for auth/sharing tests.

    Ensures schema exists, removes test-created users (CASCADE cleans
    related rows), and patches get_pg() everywhere to bypass the pool.
    Real user accounts are never touched.
    """
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")

    from app.services.pg import _SCHEMA_DDL, _SEED_SQL

    dsn = os.environ["DATABASE_URL"]
    if "staging" in dsn or "prod" in dsn or "production" in dsn:
        raise RuntimeError(
            "REFUSING to run tests: DATABASE_URL points to a non-dev database. "
            "DSN contains staging/prod keyword."
        )

    setup = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    setup.autocommit = True
    cur = setup.cursor()
    # Drop analytics tables that may have stale schemas from prior migrations
    cur.execute("DROP TABLE IF EXISTS user_actions, user_flow_events, user_segments, user_milestones CASCADE")
    # _SCHEMA_DDL (idempotent CREATE IF NOT EXISTS) must run before the DELETE
    # so schema_migrations exists on a fresh DB. Runs after the DROP so that
    # user_actions is present when RUNNER sees it (v009 fresh-deploy branch).
    cur.execute(_SCHEMA_DDL)
    cur.execute("DELETE FROM schema_migrations WHERE version >= 5")

    from app.migrations.postgres import RUNNER
    # T6750: re-assert v001-v004 as already applied BEFORE replaying 5+. v003's
    # narrow shares_share_type_check CHECK ('video'/'game'/'annotation_playback')
    # — since widened by v016/v020 to add 'collection'/'game_link' — raises a
    # CheckViolation if replayed against a DB already holding a wider-type share
    # row (real dev data, or a test that left one). _SCHEMA_DDL creates every
    # table at HEAD schema (game_ref_counts present, shares CHECK already wide),
    # so v001-v004 are structural no-ops on a truly fresh DB anyway. This also
    # makes the fixture self-healing if a ledger-wiping test drops below v005.
    for _m in RUNNER.migrations:
        if _m.version < 5:
            cur.execute(
                "INSERT INTO schema_migrations (version, description) VALUES (%s, %s) "
                "ON CONFLICT DO NOTHING",
                (_m.version, _m.description),
            )

    placeholders = ",".join(["%s"] * len(_TEST_USER_IDS))
    # T6750: clear leftover test-user shares BEFORE the migration replay, not
    # after. A widened-type ('collection'/'game_link') share left behind by an
    # errored prior test would otherwise still be present when RUNNER replays,
    # re-triggering the v003 CheckViolation on the NEXT test's setup.
    cur.execute(f"DELETE FROM shares WHERE sharer_user_id IN ({placeholders})", _TEST_USER_IDS)

    RUNNER.run(setup, "postgres")

    cur.execute(f"DELETE FROM user_actions WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM user_segments WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    # T5770: per-user daily usage buckets (keyed by user_id) — clean like segments.
    cur.execute(f"DELETE FROM user_usage_daily WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM referrals WHERE referrer_id IN ({placeholders}) OR referred_id IN ({placeholders})", _TEST_USER_IDS + _TEST_USER_IDS)
    cur.execute(f"DELETE FROM pending_teammate_shares WHERE sharer_user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM game_storage_refs WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM sessions WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    # T5840: credits live in Postgres now -- clean the per-test-user ledger too.
    cur.execute(f"DELETE FROM credit_transactions WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM credit_reservations WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM credits WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM users WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute("TRUNCATE otp_codes, r2_grace_deletions, impersonation_audit, pending_teammate_shares, game_ref_counts, daily_counters")
    cur.execute(_SEED_SQL)
    # T5840: open the credits_ready gate by default so the general test suite
    # (which predates the gate) doesn't 503 on every grant/debit. Tests that
    # specifically exercise the gate-closed path set ready_at back to NULL and
    # reset credit_ledger's process cache themselves (see test_credit_ledger.py).
    cur.execute(
        """INSERT INTO credit_migration_state (id, ready_at, backfilled_users, last_report, last_report_at)
           VALUES (1, now(), 0, NULL, NULL)
           ON CONFLICT (id) DO UPDATE SET ready_at = now(), last_report = NULL, last_report_at = NULL"""
    )
    setup.close()

    from app.services import credit_ledger
    credit_ledger.reset_ready_cache_for_tests()

    @contextmanager
    def mock_get_pg():
        conn = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    monkeypatch.setattr("app.services.pg.get_pg", mock_get_pg)
    monkeypatch.setattr("app.services.auth_db.get_pg", mock_get_pg)
    monkeypatch.setattr("app.services.sharing_db.get_pg", mock_get_pg)
    monkeypatch.setattr("app.analytics.get_pg", mock_get_pg)
    monkeypatch.setattr("app.routers.admin.get_pg", mock_get_pg)
    monkeypatch.setattr("app.services.credit_ledger.get_pg", mock_get_pg)
    monkeypatch.setattr("app.services.credit_backfill.get_pg", mock_get_pg)

    yield dsn

    credit_ledger.reset_ready_cache_for_tests()

    teardown = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    teardown.autocommit = True
    tc = teardown.cursor()
    tc.execute(f"DELETE FROM user_actions WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM user_segments WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM user_usage_daily WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM referrals WHERE referrer_id IN ({placeholders}) OR referred_id IN ({placeholders})", _TEST_USER_IDS + _TEST_USER_IDS)
    tc.execute(f"DELETE FROM pending_teammate_shares WHERE sharer_user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM shares WHERE sharer_user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM game_storage_refs WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM sessions WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM credit_transactions WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM credit_reservations WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM credits WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM users WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    teardown.close()


@pytest.fixture
def preserve_schema_migrations(pg_conn):
    """Snapshot schema_migrations before a test and restore it verbatim after.

    T6750: a few tests deliberately wipe the ledger to exercise migration
    replay (test_t2930's runner test, test_t6345's version-gap tests). Before
    this fixture existed they left the ledger wiped on failure, permanently
    poisoning every later pg_conn test in the run — and the shared dev DB —
    because pg_conn's `DELETE ... WHERE version >= 5` then leaves a below-v003
    ledger that RUNNER.run replays, hitting v003's narrow CHECK against real
    wider-type share data. Restoring the exact snapshot in teardown (pass OR
    fail) makes those tests leave the ledger exactly as they found it.

    Depends on pg_conn so it runs against the same clean, schema-guaranteed DB.
    """
    dsn = pg_conn
    snap = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    snap.autocommit = True
    sc = snap.cursor()
    sc.execute("SELECT version, description FROM schema_migrations ORDER BY version")
    snapshot = [(r["version"], r["description"]) for r in sc.fetchall()]
    snap.close()

    yield

    restore = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    restore.autocommit = True
    rc = restore.cursor()
    rc.execute("DELETE FROM schema_migrations")
    if snapshot:
        rc.executemany(
            "INSERT INTO schema_migrations (version, description) VALUES (%s, %s)",
            snapshot,
        )
    restore.close()


@pytest.fixture
def mock_torch_cuda():
    """Mock torch.cuda to avoid requiring GPU"""
    with patch('torch.cuda.is_available', return_value=False), \
         patch('torch.cuda.device_count', return_value=0):
        yield


@pytest.fixture
def sample_frame():
    """Create a sample video frame for testing"""
    return np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)


@pytest.fixture
def sample_keyframes():
    """Create sample keyframes for testing"""
    return [
        {'time': 0.0, 'x': 0, 'y': 0, 'width': 640, 'height': 360},
        {'time': 5.0, 'x': 50, 'y': 50, 'width': 800, 'height': 450},
        {'time': 10.0, 'x': 100, 'y': 100, 'width': 1280, 'height': 720}
    ]


@pytest.fixture
def sample_highlight_keyframes():
    """Create sample highlight keyframes for testing"""
    return [
        {
            'time': 0.0,
            'highlights': [
                {'x': 100, 'y': 100, 'width': 200, 'height': 150, 'label': 'Player 1'}
            ]
        },
        {
            'time': 5.0,
            'highlights': [
                {'x': 200, 'y': 150, 'width': 250, 'height': 180, 'label': 'Player 1'}
            ]
        }
    ]


@pytest.fixture
def query_counter(monkeypatch):
    """Count every SQLite statement executed during the test.

    Perf gate: catches N+1 query patterns at test time. Seed N rows, hit the
    endpoint, assert the statement count stays flat as N grows (see
    tests/test_query_counter.py for the pattern). Wraps sqlite3.connect
    process-wide via set_trace_callback, so it sees every connection no
    matter how the code under test obtained it.
    """
    import sqlite3 as _sqlite3

    class _Counts:
        def __init__(self):
            self.statements = []

        @property
        def selects(self):
            return [s for s in self.statements if s.lstrip().upper().startswith("SELECT")]

        def __len__(self):
            return len(self.statements)

    counts = _Counts()
    real_connect = _sqlite3.connect

    def counting_connect(*args, **kwargs):
        conn = real_connect(*args, **kwargs)
        try:
            conn.set_trace_callback(lambda stmt: counts.statements.append(stmt))
        except Exception:
            pass
        return conn

    monkeypatch.setattr(_sqlite3, "connect", counting_connect)
    yield counts
