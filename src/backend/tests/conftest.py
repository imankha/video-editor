"""
Pytest configuration and shared fixtures for backend tests.
"""

import os
from contextlib import contextmanager
from pathlib import Path

import psycopg2
import pytest
import numpy as np
from psycopg2.extras import RealDictCursor
from unittest.mock import Mock, MagicMock, patch


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
         patch("app.services.cleanup.start_cleanup_loop", new_callable=AsyncMock), \
         patch("app.services.cleanup.stop_cleanup_loop", new_callable=AsyncMock):
        yield


_TEST_USER_IDS = (
    "admin-user", "regular-user", "sharer-user", "recipient-user",
    "user-1", "user-2", "test-user-1", "test-user", "user-a", "user-b",
    "other-admin", "target-user", "other-regular",
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
            f"REFUSING to run tests: DATABASE_URL points to a non-dev database. "
            f"DSN contains staging/prod keyword."
        )

    setup = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    setup.autocommit = True
    cur = setup.cursor()
    cur.execute(_SCHEMA_DDL)
    placeholders = ",".join(["%s"] * len(_TEST_USER_IDS))
    cur.execute(f"DELETE FROM pending_teammate_shares WHERE sharer_user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM shares WHERE sharer_user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM game_storage_refs WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM sessions WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute(f"DELETE FROM users WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    cur.execute("TRUNCATE otp_codes, r2_grace_deletions, impersonation_audit, pending_teammate_shares, game_ref_counts")
    cur.execute(_SEED_SQL)
    setup.close()

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

    yield dsn

    teardown = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    teardown.autocommit = True
    tc = teardown.cursor()
    tc.execute(f"DELETE FROM pending_teammate_shares WHERE sharer_user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM shares WHERE sharer_user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM game_storage_refs WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM sessions WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    tc.execute(f"DELETE FROM users WHERE user_id IN ({placeholders})", _TEST_USER_IDS)
    teardown.close()


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
