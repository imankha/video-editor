"""
T930: Tests for resilient R2 sync — marker file persistence and retry.

Verifies:
  - mark_sync_pending creates .sync_pending file
  - has_sync_pending returns True when marker exists
  - clear_sync_pending removes marker, has_sync_pending returns False
  - clear_sync_pending is idempotent (no error when file missing)
  - retry_pending_sync calls the correct sync functions

Run with: pytest tests/test_sync_retry.py -v
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import (
    clear_sync_pending,
    has_sync_pending,
    mark_sync_pending,
)


@pytest.fixture
def tmp_user(tmp_path, monkeypatch):
    """Patch USER_DATA_BASE to a temp directory and return a test user_id."""
    import app.database as db_module
    monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
    user_id = "test-user-sync-retry"
    return user_id, tmp_path


SCOPE = "abcd1234"


class TestSyncPendingMarker:
    """Unit tests for .sync_pending.{scope} marker file operations."""

    def test_mark_creates_file(self, tmp_user):
        user_id, base = tmp_user
        assert not has_sync_pending(user_id)

        mark_sync_pending(user_id, SCOPE)

        assert has_sync_pending(user_id)
        marker_path = base / user_id / f".sync_pending.{SCOPE}"
        assert marker_path.exists()
        # T5081: content is "{timestamp}:{uuid}" (unique by construction, not
        # by clock resolution alone — see the INV-P comment in database.py).
        content = marker_path.read_text()
        ts_part, _, uuid_part = content.partition(":")
        assert float(ts_part) > 0
        assert len(uuid_part) == 32

    def test_clear_removes_file(self, tmp_user):
        user_id, base = tmp_user
        mark_sync_pending(user_id, SCOPE)
        assert has_sync_pending(user_id)

        clear_sync_pending(user_id, SCOPE)

        assert not has_sync_pending(user_id)
        marker_path = base / user_id / f".sync_pending.{SCOPE}"
        assert not marker_path.exists()

    def test_clear_idempotent(self, tmp_user):
        """Clearing when no marker exists should not raise."""
        user_id, _ = tmp_user
        # No marker set — should not raise
        clear_sync_pending(user_id, SCOPE)
        assert not has_sync_pending(user_id)

    def test_has_sync_pending_false_by_default(self, tmp_user):
        user_id, _ = tmp_user
        assert not has_sync_pending(user_id)

    def test_mark_creates_user_directory(self, tmp_user):
        """mark_sync_pending should create the user directory if it doesn't exist."""
        user_id, base = tmp_user
        user_dir = base / user_id
        assert not user_dir.exists()

        mark_sync_pending(user_id, SCOPE)

        assert user_dir.exists()
        assert has_sync_pending(user_id)

    def test_mark_overwrites_previous(self, tmp_user):
        """A second mark should produce a distinct token (T5081: unique by
        construction via a uuid suffix, not by clock resolution alone — two
        marks in the same tick must still compare as different)."""
        user_id, base = tmp_user
        marker_path = base / user_id / f".sync_pending.{SCOPE}"
        first_token = mark_sync_pending(user_id, SCOPE)
        assert marker_path.read_text() == first_token

        second_token = mark_sync_pending(user_id, SCOPE)
        assert marker_path.read_text() == second_token
        assert second_token != first_token


class TestRetryPendingSync:
    """Tests for retry_pending_sync in the middleware.

    T5081 (review round 3): retry_pending_sync now delegates to
    sync_db_to_r2_explicit/sync_user_db_to_r2_explicit (database.py) instead of
    duplicating their logic — those functions bind R2_ENABLED and
    sync_database_to_r2_with_version/sync_user_db_to_r2_with_version at
    database.py's OWN module scope (import time for the former, a fresh
    per-call import for the latter), so patching storage.py's copies of those
    names does not reach here for the module-level-bound one. Using the real
    FakeR2 harness (same as test_t5081_pending_scoping.py) sidesteps that
    entirely and exercises the real CAS/version-bump logic.
    """

    def test_retry_success(self, tmp_user):
        import sqlite3

        from app.database import (
            USER_DB_SCOPE,
            SyncResult,
            get_local_db_version,
            get_local_user_db_version,
            mark_sync_pending,
            set_local_db_version,
            set_local_user_db_version,
        )
        from app.middleware.db_sync import retry_pending_sync
        from app.storage import _user_db_r2_key, profile_r2_key
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        user_id, base = tmp_user
        profile_dir = base / user_id / "profiles" / "abcd1234"
        profile_dir.mkdir(parents=True)
        for db_path in (profile_dir / "profile.sqlite", base / user_id / "user.sqlite"):
            conn = sqlite3.connect(str(db_path))
            conn.execute("CREATE TABLE marker (who TEXT)")
            conn.commit()
            conn.close()

        fake = FakeR2()
        with _r2_patched(fake):
            fake._objects[profile_r2_key(user_id, "abcd1234", "profile.sqlite")] = {
                "data": b"P", "metadata": {"db-version": "1"},
            }
            fake._objects[_user_db_r2_key(user_id)] = {
                "data": b"U", "metadata": {"db-version": "1"},
            }
            set_local_db_version(user_id, "abcd1234", 1)
            set_local_user_db_version(user_id, 1)
            mark_sync_pending(user_id, "abcd1234")
            mark_sync_pending(user_id, USER_DB_SCOPE)

            result = retry_pending_sync(user_id, profile_id="abcd1234")

        assert result is SyncResult.OK
        assert result  # truthy-only-on-OK
        assert get_local_db_version(user_id, "abcd1234") == 2
        assert get_local_user_db_version(user_id) == 2

    def test_retry_failure(self, tmp_user):
        import sqlite3

        from app.database import SyncResult, mark_sync_pending, set_local_db_version
        from app.middleware.db_sync import retry_pending_sync
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        user_id, base = tmp_user
        profile_dir = base / user_id / "profiles" / "abcd1234"
        profile_dir.mkdir(parents=True)
        db_path = profile_dir / "profile.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE marker (who TEXT)")
        conn.commit()
        conn.close()

        fake = FakeR2()
        fake.fail_profile_upload = True
        with _r2_patched(fake):
            set_local_db_version(user_id, "abcd1234", 1)
            mark_sync_pending(user_id, "abcd1234")

            result = retry_pending_sync(user_id, profile_id="abcd1234")

        assert result is SyncResult.FAILED
        assert not result
