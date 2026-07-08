"""
T4820: Tests for expired-source games wrongly computing 'active' (bug 27p/29p).

Three test areas:
1. _compute_storage_status unit tests (already exists in games.py, tested here)
2. v023 migration: repairs games showing 'active' whose R2 source is gone
3. Sweep Part 2a: after Phase-2 R2 delete, expires lingering game_storage rows
4. Heal path Part 2b: _ensure_game_storage_refs skips missing R2 sources
"""

import sqlite3
import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pytest

# Patch-path prefix for the v023 migration module.
_V023 = "app.migrations.profile_db.v023_repair_sourceless_active_games"


def _absent_client():
    """Mock R2 client whose head_object raises a confirmed-404 ClientError."""
    from botocore.exceptions import ClientError
    mock = MagicMock()
    mock.head_object.side_effect = ClientError(
        {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
    )
    return mock


def _present_client():
    """Mock R2 client whose head_object returns success (source present)."""
    mock = MagicMock()
    mock.head_object.return_value = {"ContentLength": 12345}
    return mock


# ---------------------------------------------------------------------------
# Helpers (repeated across test classes to keep them self-contained)
# ---------------------------------------------------------------------------

def _past() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()


def _future() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


# ---------------------------------------------------------------------------
# _compute_storage_status unit tests
# ---------------------------------------------------------------------------

class TestComputeStorageStatus:
    """Tests for games.py:_compute_storage_status — the single source of truth."""

    def _fn(self, expires_at_val, auto_export_status):
        from app.routers.games import _compute_storage_status
        return _compute_storage_status(expires_at_val, auto_export_status)

    def test_future_expiry_no_auto_export_is_active(self):
        assert self._fn(_future(), None) == "active"

    def test_past_expiry_is_expired(self):
        assert self._fn(_past(), None) == "expired"

    def test_no_ref_no_auto_export_is_active(self):
        """The bug case: no ref + no auto_export_status → wrongly active."""
        assert self._fn(None, None) == "active"

    def test_no_ref_with_auto_export_is_expired(self):
        assert self._fn(None, "complete") == "expired"

    def test_no_ref_with_skipped_is_expired(self):
        assert self._fn(None, "skipped") == "expired"

    def test_unparseable_expiry_is_active(self):
        """An unparseable expiry falls back to 'active' (treat as present)."""
        assert self._fn("not-a-date", None) == "active"

    def test_past_expiry_with_auto_export_is_expired(self):
        """Both signals agree: expired."""
        assert self._fn(_past(), "complete") == "expired"


# ---------------------------------------------------------------------------
# v023 migration tests
# ---------------------------------------------------------------------------

def _make_profile_db(tmp_path, db_name="profile.sqlite"):
    """Create a minimal profile SQLite with the tables v023 needs."""
    db_path = tmp_path / db_name
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT 'Game',
            blake3_hash TEXT,
            auto_export_status TEXT,
            status TEXT DEFAULT 'ready'
        );
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL
        );
        CREATE TABLE game_storage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blake3_hash TEXT NOT NULL UNIQUE,
            game_size_bytes INTEGER NOT NULL DEFAULT 0,
            storage_expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
    conn.close()
    return db_path


def _add_game(db_path, blake3_hash, auto_export_status=None):
    conn = sqlite3.connect(str(db_path))
    cur = conn.execute(
        "INSERT INTO games (blake3_hash, auto_export_status) VALUES (?, ?)",
        (blake3_hash, auto_export_status),
    )
    game_id = cur.lastrowid
    conn.commit()
    conn.close()
    return game_id


def _add_game_video(db_path, game_id, blake3_hash, sequence=1):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, ?)",
        (game_id, blake3_hash, sequence),
    )
    conn.commit()
    conn.close()


def _add_storage(db_path, blake3_hash, expires_at):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO game_storage (blake3_hash, storage_expires_at) VALUES (?, ?)",
        (blake3_hash, expires_at),
    )
    conn.commit()
    conn.close()


def _get_storage_expiry(db_path, blake3_hash):
    conn = sqlite3.connect(str(db_path))
    row = conn.execute(
        "SELECT storage_expires_at FROM game_storage WHERE blake3_hash = ?",
        (blake3_hash,),
    ).fetchone()
    conn.close()
    return row[0] if row else None


def _run_v023(db_path):
    """Run v023 migration against a plain sqlite3 connection (tuple row factory)."""
    from app.migrations.profile_db.v023_repair_sourceless_active_games import (
        V023RepairSourcelessActiveGames,
    )
    conn = sqlite3.connect(str(db_path))
    try:
        V023RepairSourcelessActiveGames().up(conn)
    finally:
        conn.close()


class TestV023MigrationRepairSourcelessActiveGames:
    """v023: sets game_storage.storage_expires_at to a past sentinel when the
    game shows 'active' but its R2 source is confirmed absent.

    Source-check correctness: the migration distinguishes a confirmed-absent
    response (HTTP 404 / NoSuchKey ClientError) from ambiguous errors (throttle,
    network blip, permission).  Only confirmed-absent triggers a repair.

    Row-factory note: the migration runner passes a PLAIN sqlite3 connection
    (tuple row factory, not sqlite3.Row). Tests here reproduce that exactly:
    `sqlite3.connect(...)` uses tuples by default. The migration MUST read
    positionally (r[0], r[1]) — string-indexing raises TypeError on prod
    (T4110 class of bug).
    """

    def test_future_expiry_missing_r2_source_is_repaired(self, tmp_path):
        """Core bug: FUTURE game_storage expiry + confirmed-absent R2 source → expired."""
        db = _make_profile_db(tmp_path)
        _add_game(db, "abc123")
        _add_storage(db, "abc123", _future())

        with patch(f"{_V023}.get_r2_client", return_value=_absent_client()):
            _run_v023(db)

        expiry = _get_storage_expiry(db, "abc123")
        assert expiry is not None
        exp_dt = datetime.fromisoformat(expiry)
        assert exp_dt < datetime.now(timezone.utc), f"Expected past expiry, got {expiry}"

    def test_never_tracked_game_missing_source_inserts_past_row(self, tmp_path):
        """The 1b842983 game 5 case: no game_storage row + confirmed-absent R2 source.
        Migration must INSERT a row with past expiry so _compute_storage_status
        sees expires_at_val and returns 'expired'.
        """
        db = _make_profile_db(tmp_path)
        _add_game(db, "newgame_hash")
        # No game_storage row exists for "newgame_hash"

        with patch(f"{_V023}.get_r2_client", return_value=_absent_client()):
            _run_v023(db)

        expiry = _get_storage_expiry(db, "newgame_hash")
        assert expiry is not None
        exp_dt = datetime.fromisoformat(expiry)
        assert exp_dt < datetime.now(timezone.utc), f"Expected past expiry after insert, got {expiry}"

    def test_already_expired_game_is_skipped(self, tmp_path):
        """Games already showing 'expired' (past storage_expires_at) are not touched."""
        db = _make_profile_db(tmp_path)
        _add_game(db, "old_hash")
        original_past = _past()
        _add_storage(db, "old_hash", original_past)

        mock_client = MagicMock()
        with patch(f"{_V023}.get_r2_client", return_value=mock_client):
            _run_v023(db)

        mock_client.head_object.assert_not_called()  # Already expired: no R2 check needed
        assert _get_storage_expiry(db, "old_hash") == original_past

    def test_auto_exported_game_no_ref_is_skipped(self, tmp_path):
        """A game with auto_export_status='complete' and no storage ref shows
        'expired' via _compute_storage_status — migration should skip it."""
        db = _make_profile_db(tmp_path)
        _add_game(db, None, auto_export_status="complete")

        mock_client = MagicMock()
        with patch(f"{_V023}.get_r2_client", return_value=mock_client):
            _run_v023(db)

        mock_client.head_object.assert_not_called()

    def test_active_game_with_present_r2_source_is_untouched(self, tmp_path):
        """If R2 source exists, game_storage is not modified."""
        db = _make_profile_db(tmp_path)
        _add_game(db, "live_hash")
        _add_storage(db, "live_hash", _future())

        with patch(f"{_V023}.get_r2_client", return_value=_present_client()):
            _run_v023(db)

        expiry = _get_storage_expiry(db, "live_hash")
        exp_dt = datetime.fromisoformat(expiry)
        assert exp_dt > datetime.now(timezone.utc), "Live game expiry should remain future"

    def test_idempotent_on_second_run(self, tmp_path):
        """Running v023 twice must be a no-op on the second run (already past)."""
        db = _make_profile_db(tmp_path)
        _add_game(db, "idem_hash")
        _add_storage(db, "idem_hash", _future())

        with patch(f"{_V023}.get_r2_client", return_value=_absent_client()):
            _run_v023(db)
            _run_v023(db)

        expiry = _get_storage_expiry(db, "idem_hash")
        assert datetime.fromisoformat(expiry) < datetime.now(timezone.utc)

    def test_guard_returns_early_on_missing_tables(self, tmp_path):
        """If games or game_storage tables are absent (fresh profile), early return.
        Table guard fires before R2 is consulted so no R2 mock needed.
        """
        db_path = tmp_path / "empty.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY)")
        conn.commit()
        conn.close()
        # No game_storage table — must not raise

        _run_v023(db_path)  # Should not raise

    def test_tuple_row_factory_not_string_indexed(self, tmp_path):
        """Positional row access: the migration must use r[0], r[1] not r['col'].
        With a plain sqlite3 connection (tuple factory), string indexing raises
        TypeError — this test ensures we never regress (T4110 class of bug).
        """
        db = _make_profile_db(tmp_path)
        _add_game(db, "tuple_hash")
        _add_storage(db, "tuple_hash", _future())

        with patch(f"{_V023}.get_r2_client", return_value=_absent_client()):
            # Would raise "tuple indices must be integers or slices, not str"
            # if migration uses row['col'] instead of row[0].
            _run_v023(db)

    def test_multi_video_game_missing_source_is_repaired(self, tmp_path):
        """Multi-video game: one confirmed-absent source → expire all source rows."""
        from botocore.exceptions import ClientError
        db = _make_profile_db(tmp_path)
        game_id = _add_game(db, None)  # Multi-video: games.blake3_hash is null
        _add_game_video(db, game_id, "vid_hash_a", sequence=1)
        _add_game_video(db, game_id, "vid_hash_b", sequence=2)
        _add_storage(db, "vid_hash_a", _future())
        _add_storage(db, "vid_hash_b", _future())

        # vid_hash_a is confirmed absent (404); vid_hash_b is present.
        def head_side_effect(Bucket=None, Key=None):
            if "vid_hash_a" in (Key or ""):
                raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
            return {"ContentLength": 100}

        mock_client = MagicMock()
        mock_client.head_object.side_effect = head_side_effect
        with patch(f"{_V023}.get_r2_client", return_value=mock_client):
            _run_v023(db)

        expiry_a = _get_storage_expiry(db, "vid_hash_a")
        assert expiry_a is not None
        assert datetime.fromisoformat(expiry_a) < datetime.now(timezone.utc)

    # ----- New cases required by .fix-t4820.md -----

    def test_transient_error_does_not_expire_game(self, tmp_path, caplog):
        """A non-404 / transient R2 error must NOT expire the game.

        r2_head_object_global used to collapse ALL errors (including throttle /
        network blip) to None, causing false-positive expirations.  Now only a
        confirmed 404 / NoSuchKey expiry is acted on; anything else skips the game
        and logs a warning so ops can investigate.
        """
        from botocore.exceptions import ClientError
        db = _make_profile_db(tmp_path)
        _add_game(db, "flaky_hash")
        _add_storage(db, "flaky_hash", _future())
        original_expiry = _get_storage_expiry(db, "flaky_hash")

        mock_client = MagicMock()
        mock_client.head_object.side_effect = ClientError(
            {"Error": {"Code": "503", "Message": "Slow Down"}}, "HeadObject"
        )
        with caplog.at_level(logging.WARNING, logger="app.migrations.profile_db.v023_repair_sourceless_active_games"):
            with patch(f"{_V023}.get_r2_client", return_value=mock_client):
                _run_v023(db)

        expiry = _get_storage_expiry(db, "flaky_hash")
        assert expiry == original_expiry, "Transient error must NOT change expiry"
        assert any("indeterminate" in r.message.lower() for r in caplog.records), (
            "Expected an 'indeterminate' warning to be logged"
        )

    def test_r2_not_configured_is_noop(self, tmp_path):
        """If get_r2_client() returns None, the migration must be a no-op.

        Never mass-expire games when R2 is unavailable — we can't distinguish
        'source is gone' from 'R2 is unreachable'.
        """
        db = _make_profile_db(tmp_path)
        _add_game(db, "some_hash")
        _add_storage(db, "some_hash", _future())
        original_expiry = _get_storage_expiry(db, "some_hash")

        with patch(f"{_V023}.get_r2_client", return_value=None):
            _run_v023(db)

        assert _get_storage_expiry(db, "some_hash") == original_expiry, (
            "Migration must be a no-op when R2 is not configured"
        )

    def test_confirmed_404_expires_game(self, tmp_path):
        """A genuine HTTP-404 ClientError (confirmed absent) must still expire.

        Regression guard: ensures the botocore ClientError path correctly
        identifies the confirmed-absent case and writes the past sentinel.
        """
        from botocore.exceptions import ClientError
        db = _make_profile_db(tmp_path)
        _add_game(db, "dead_hash")
        _add_storage(db, "dead_hash", _future())

        mock_client = MagicMock()
        mock_client.head_object.side_effect = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
        )
        with patch(f"{_V023}.get_r2_client", return_value=mock_client):
            _run_v023(db)

        expiry = _get_storage_expiry(db, "dead_hash")
        assert expiry is not None
        assert datetime.fromisoformat(expiry) < datetime.now(timezone.utc), (
            "Confirmed-404 must write a past sentinel"
        )


# ---------------------------------------------------------------------------
# Sweep Part 2a: expire_game_storage after R2 delete
# ---------------------------------------------------------------------------

USER_ID = "sweep-test-user"
PROFILE_ID = "testdefault"
M = "app.services.sweep_scheduler"


@pytest.fixture
def sweep_profile_db(tmp_path):
    """Create an isolated profile.sqlite for sweep tests."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    db_dir = tmp_path / USER_ID / "profiles" / PROFILE_ID
    db_dir.mkdir(parents=True)
    db_path = db_dir / "profile.sqlite"

    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT 'G',
            blake3_hash TEXT,
            auto_export_status TEXT,
            auto_export_attempts INTEGER DEFAULT 0,
            status TEXT DEFAULT 'ready'
        );
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL
        );
        CREATE TABLE game_storage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blake3_hash TEXT NOT NULL UNIQUE,
            game_size_bytes INTEGER NOT NULL DEFAULT 0,
            storage_expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
    conn.close()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", {USER_ID}), \
         patch("app.database.R2_ENABLED", False):
        yield db_path


def _insert_storage(db_path, blake3_hash, expires_at):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT OR REPLACE INTO game_storage (blake3_hash, storage_expires_at) VALUES (?, ?)",
        (blake3_hash, expires_at),
    )
    conn.commit()
    conn.close()


def _read_storage_expiry(db_path, blake3_hash):
    conn = sqlite3.connect(str(db_path))
    row = conn.execute(
        "SELECT storage_expires_at FROM game_storage WHERE blake3_hash = ?",
        (blake3_hash,),
    ).fetchone()
    conn.close()
    return row[0] if row else None


class TestSweepPhase2ExpiresGameStorage:
    """After Phase 2 deletes an R2 object, any lingering game_storage rows
    (e.g. future-expiry refs that Phase 1 didn't touch) must be expired.
    """

    @patch(f"{M}.get_expired_grace_deletions", return_value=["hash_deleted"])
    @patch(f"{M}.r2_delete_object_global", return_value=True)
    @patch(f"{M}.delete_grace_deletion")
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin",
           return_value=[{"user_id": USER_ID}])
    def test_phase2_delete_expires_remaining_game_storage(
        self, mock_users, mock_profiles, mock_expired_refs,
        mock_del_grace, mock_r2_delete, mock_grace_expired,
        sweep_profile_db,
    ):
        """When Phase 2 deletes the R2 object, any remaining game_storage row
        for that hash in the profile must have storage_expires_at set to the past.
        """
        from app.services.sweep_scheduler import do_sweep

        # Set a FUTURE expiry (the bug scenario: Phase 1 didn't touch this ref
        # because it wasn't expired yet, but Phase 2 is now deleting the object).
        _insert_storage(sweep_profile_db, "hash_deleted", _future())

        do_sweep()

        expiry = _read_storage_expiry(sweep_profile_db, "hash_deleted")
        assert expiry is not None
        assert datetime.fromisoformat(expiry) < datetime.now(timezone.utc), (
            f"Expected past expiry after R2 delete, got {expiry}"
        )

    @patch(f"{M}.get_expired_grace_deletions", return_value=["hash_active"])
    @patch(f"{M}.r2_delete_object_global", return_value=True)
    @patch(f"{M}.delete_grace_deletion")
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin",
           return_value=[{"user_id": USER_ID}])
    def test_phase2_noop_when_no_storage_row(
        self, mock_users, mock_profiles, mock_expired_refs,
        mock_del_grace, mock_r2_delete, mock_grace_expired,
        sweep_profile_db,
    ):
        """When Phase 2 deletes and no game_storage row exists, no error and
        the database is left clean.
        """
        from app.services.sweep_scheduler import do_sweep

        # No game_storage row for "hash_active"
        do_sweep()  # Should not raise

        assert _read_storage_expiry(sweep_profile_db, "hash_active") is None

    @patch(f"{M}.get_expired_grace_deletions", return_value=[])
    @patch(f"{M}.r2_delete_object_global")
    @patch(f"{M}.delete_grace_deletion")
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin",
           return_value=[{"user_id": USER_ID}])
    def test_phase2_does_not_expire_when_refs_remain(
        self, mock_users, mock_profiles, mock_expired_refs,
        mock_del_grace, mock_r2_delete, mock_grace_expired,
        sweep_profile_db,
    ):
        """When no grace deletion occurs (other refs remain), game_storage is
        NOT expired. The ref expiry path only triggers on actual R2 deletion.
        """
        from app.services.sweep_scheduler import do_sweep

        _insert_storage(sweep_profile_db, "hash_alive", _future())

        do_sweep()

        expiry = _read_storage_expiry(sweep_profile_db, "hash_alive")
        assert expiry is not None
        assert datetime.fromisoformat(expiry) > datetime.now(timezone.utc), (
            "Active ref should not be expired when no R2 deletion occurred"
        )
        mock_r2_delete.assert_not_called()

    @patch(f"{M}.get_expired_grace_deletions", return_value=["hash_synced"])
    @patch(f"{M}.r2_delete_object_global", return_value=True)
    @patch(f"{M}.delete_grace_deletion")
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin",
           return_value=[{"user_id": USER_ID}])
    @patch(f"{M}.sync_db_to_r2_explicit")
    def test_phase2_syncs_to_r2_after_expire(
        self, mock_sync, mock_users, mock_profiles, mock_expired_refs,
        mock_del_grace, mock_r2_delete, mock_grace_expired,
        sweep_profile_db,
    ):
        """When Phase 2 expires a game_storage row, the profile DB must be
        synced to R2 so the change persists across Fly machines.
        """
        from app.services.sweep_scheduler import do_sweep

        _insert_storage(sweep_profile_db, "hash_synced", _future())

        do_sweep()

        # The sync must fire for the profile that was actually mutated.
        mock_sync.assert_called_once_with(USER_ID, PROFILE_ID)

    @patch(f"{M}.get_expired_grace_deletions", return_value=["hash_nosync"])
    @patch(f"{M}.r2_delete_object_global", return_value=True)
    @patch(f"{M}.delete_grace_deletion")
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin",
           return_value=[{"user_id": USER_ID}])
    @patch(f"{M}.sync_db_to_r2_explicit")
    def test_phase2_no_sync_when_no_row_to_expire(
        self, mock_sync, mock_users, mock_profiles, mock_expired_refs,
        mock_del_grace, mock_r2_delete, mock_grace_expired,
        sweep_profile_db,
    ):
        """When there is no game_storage row to expire, sync must NOT fire
        (avoid spurious R2 uploads).
        """
        from app.services.sweep_scheduler import do_sweep

        # No game_storage row for "hash_nosync" — expire_game_storage returns 0.
        do_sweep()

        mock_sync.assert_not_called()


# ---------------------------------------------------------------------------
# Heal path Part 2b: _ensure_game_storage_refs skips missing R2 sources
# ---------------------------------------------------------------------------

class TestHealPathSkipsMissingSource:
    """_ensure_game_storage_refs must not write a future-expiry ref for a game
    whose R2 source is already gone (would resurrect an expired game as 'active').
    """

    def _setup_profile_db(self, tmp_path):
        """Create isolated profile.sqlite for heal tests."""
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id

        user_id = "heal-test-user"
        profile_id = "testdefault"
        set_current_user_id(user_id)
        set_current_profile_id(profile_id)

        db_dir = tmp_path / user_id / "profiles" / profile_id
        db_dir.mkdir(parents=True)
        db_path = db_dir / "profile.sqlite"

        conn = sqlite3.connect(str(db_path))
        conn.executescript("""
            CREATE TABLE games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT 'G',
                blake3_hash TEXT,
                status TEXT DEFAULT 'ready'
            );
            CREATE TABLE game_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER NOT NULL,
                blake3_hash TEXT NOT NULL,
                video_size INTEGER DEFAULT 0,
                sequence INTEGER NOT NULL
            );
            CREATE TABLE game_storage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blake3_hash TEXT NOT NULL UNIQUE,
                game_size_bytes INTEGER NOT NULL DEFAULT 0,
                storage_expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        """)
        conn.commit()
        conn.close()
        return db_path, user_id, profile_id

    def test_heal_skips_ref_when_r2_source_absent(self, tmp_path):
        """_ensure_game_storage_refs must NOT call insert_game_storage_ref
        when R2 head_object returns None (source deleted). Writing a future-expiry
        ref for a deleted source would make the game appear 'active' again.
        """
        from app.routers.games import _ensure_game_storage_refs

        db_path, user_id, profile_id = self._setup_profile_db(tmp_path)

        # Add a game with a video hash but no game_storage row (the heal case)
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "INSERT INTO games (blake3_hash) VALUES ('heal_hash')",
        )
        game_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, video_size, sequence) "
            "VALUES (?, 'heal_hash', 0, 1)",
            (game_id,),
        )
        conn.commit()

        conn.row_factory = sqlite3.Row  # normal app row factory
        cursor = conn.cursor()

        mock_r2_client = MagicMock()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", {user_id}), \
             patch("app.database.R2_ENABLED", False), \
             patch("app.routers.games.get_r2_client", return_value=mock_r2_client), \
             patch("app.routers.games.r2_head_object_global", return_value=None), \
             patch("app.routers.games.insert_game_storage_ref") as mock_insert:
            result = _ensure_game_storage_refs(
                cursor, game_id, user_id, profile_id, _future()
            )

        # insert_game_storage_ref must NOT be called for a missing source
        mock_insert.assert_not_called()
        assert result == 0

        conn.close()

    def test_heal_writes_ref_when_r2_source_present(self, tmp_path):
        """_ensure_game_storage_refs DOES call insert_game_storage_ref when
        the R2 head_object confirms the source exists (normal heal case).
        """
        from app.routers.games import _ensure_game_storage_refs

        db_path, user_id, profile_id = self._setup_profile_db(tmp_path)

        conn = sqlite3.connect(str(db_path))
        conn.execute("INSERT INTO games (blake3_hash) VALUES ('live_hash')")
        game_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, video_size, sequence) "
            "VALUES (?, 'live_hash', 5000000, 1)",
            (game_id,),
        )
        conn.commit()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        expires = _future()
        mock_r2_client = MagicMock()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", {user_id}), \
             patch("app.database.R2_ENABLED", False), \
             patch("app.routers.games.get_r2_client", return_value=mock_r2_client), \
             patch("app.routers.games.r2_head_object_global",
                   return_value={"ContentLength": 5000000}), \
             patch("app.routers.games.insert_game_storage_ref") as mock_insert:
            result = _ensure_game_storage_refs(
                cursor, game_id, user_id, profile_id, expires
            )

        mock_insert.assert_called_once_with(user_id, profile_id, "live_hash", 5000000, expires)
        assert result == 1

        conn.close()

    def test_heal_skips_when_r2_not_configured(self, tmp_path):
        """When R2 is not configured (get_r2_client returns None), the heal
        path should proceed without an R2 check — no client means dev/test env
        where we can't verify source presence.
        """
        from app.routers.games import _ensure_game_storage_refs

        db_path, user_id, profile_id = self._setup_profile_db(tmp_path)

        conn = sqlite3.connect(str(db_path))
        conn.execute("INSERT INTO games (blake3_hash) VALUES ('noconf_hash')")
        game_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, video_size, sequence) "
            "VALUES (?, 'noconf_hash', 0, 1)",
            (game_id,),
        )
        conn.commit()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", {user_id}), \
             patch("app.database.R2_ENABLED", False), \
             patch("app.routers.games.get_r2_client", return_value=None), \
             patch("app.routers.games.insert_game_storage_ref") as mock_insert:
            result = _ensure_game_storage_refs(
                cursor, game_id, user_id, profile_id, _future()
            )

        # No R2 client → proceed with insert (assume source is present)
        mock_insert.assert_called_once()
        assert result == 1

        conn.close()
