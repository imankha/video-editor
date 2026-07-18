"""
Tests for T2855: Shared Game Storage Extension.

Verifies that the extend-storage flow works correctly for shared game
recipients, not just uploaders. Tests cover:
- Materialization copies video_size correctly (cost calculation depends on it)
- Storage refs are independent per user (sharer vs recipient)
- Extend creates/updates recipient's refs without affecting sharer's
- Grace period cancellation works when recipient re-extends
- can_extend flag logic with cross-user refs
- Expiry base calculation (expired vs active ref)
- Full endpoint handler with mocked user context
- Expired -> extend -> active lifecycle
- Multi-video game extension
- list_games storage_status derivation
"""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.services.materialization import _copy_game, _create_storage_refs, _collect_video_hashes
from app.services.auth_db import (
    create_user,
    insert_game_storage_ref,
    get_game_storage_ref,
    get_storage_refs_for_user,
    get_all_ref_hashes,
    get_grace_deletion_hashes,
    insert_grace_deletion,
    delete_ref,
)
from app.services.storage_credits import calculate_extension_cost, storage_expires_at


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_naive_utc(dt):
    """Normalize a datetime to naive UTC for comparison."""
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    if dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt


def _parse_ref_dt(ref):
    """Extract storage_expires_at from a Postgres ref as naive UTC datetime."""
    val = ref["storage_expires_at"]
    return _to_naive_utc(val)

def _create_profile_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            video_filename TEXT,
            blake3_hash TEXT,
            clip_count INTEGER DEFAULT 0,
            brilliant_count INTEGER DEFAULT 0,
            good_count INTEGER DEFAULT 0,
            interesting_count INTEGER DEFAULT 0,
            mistake_count INTEGER DEFAULT 0,
            blunder_count INTEGER DEFAULT 0,
            aggregate_score INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            video_duration REAL,
            video_width INTEGER,
            video_height INTEGER,
            video_size INTEGER,
            opponent_name TEXT,
            game_date TEXT,
            game_type TEXT,
            tournament_name TEXT,
            viewed_duration REAL DEFAULT 0,
            video_fps REAL,
            status TEXT DEFAULT 'ready',
            auto_export_status TEXT,
            recap_video_url TEXT,
            shared_by TEXT DEFAULT NULL
        );
        CREATE TABLE IF NOT EXISTS game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL,
            video_width INTEGER,
            video_height INTEGER,
            video_size INTEGER,
            fps REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(game_id, sequence)
        );
        CREATE TABLE IF NOT EXISTS raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            rating INTEGER NOT NULL,
            tags BLOB,
            name TEXT,
            notes TEXT,
            start_time REAL,
            end_time REAL,
            game_id INTEGER,
            auto_project_id INTEGER,
            default_highlight_regions BLOB,
            video_sequence INTEGER,
            boundaries_version INTEGER DEFAULT 1,
            boundaries_updated_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            tagged_teammates BLOB DEFAULT NULL,
            my_athlete INTEGER DEFAULT 1,
            shared_by TEXT DEFAULT NULL,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS clip_teammates (
            clip_id INTEGER NOT NULL REFERENCES raw_clips(id) ON DELETE CASCADE,
            tag_name TEXT NOT NULL,
            UNIQUE(clip_id, tag_name)
        );
    """)
    conn.commit()
    return conn


def _insert_game(conn, name="Test Game", blake3_hash="abc123",
                  video_size=5_000_000_000, **kwargs):
    defaults = dict(
        video_duration=90.0, video_width=1920, video_height=1080,
        opponent_name="Opponent", game_date="2026-05-01",
        game_type="league", tournament_name=None, video_fps=30.0,
    )
    defaults.update(kwargs)
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO games (name, blake3_hash, video_duration, video_width,
           video_height, video_size, opponent_name, game_date, game_type,
           tournament_name, video_fps)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (name, blake3_hash, defaults["video_duration"], defaults["video_width"],
         defaults["video_height"], video_size, defaults["opponent_name"],
         defaults["game_date"], defaults["game_type"], defaults["tournament_name"],
         defaults["video_fps"]),
    )
    conn.commit()
    return cur.lastrowid


def _insert_game_video(conn, game_id, blake3_hash, sequence=0,
                        video_size=2_500_000_000, **kwargs):
    defaults = dict(duration=45.0, video_width=1920, video_height=1080, fps=30.0)
    defaults.update(kwargs)
    conn.execute(
        """INSERT INTO game_videos (game_id, blake3_hash, sequence, duration,
           video_width, video_height, video_size, fps)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (game_id, blake3_hash, sequence, defaults["duration"],
         defaults["video_width"], defaults["video_height"],
         video_size, defaults["fps"]),
    )
    conn.commit()


# ===========================================================================
# Materialization: video_size + blake3_hash preservation
# ===========================================================================

class TestCopyGamePreservesExtendFields:
    """Verify _copy_game copies the fields that extend-storage depends on."""

    def test_copies_video_size_to_games_row(self, tmp_path):
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")

        game_id = _insert_game(s_conn, video_size=5_368_709_120)  # ~5 GB
        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        row = r_conn.execute("SELECT video_size FROM games WHERE id = ?", (new_id,)).fetchone()
        assert row["video_size"] == 5_368_709_120

        s_conn.close()
        r_conn.close()

    def test_copies_blake3_hash_to_games_row(self, tmp_path):
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")

        game_id = _insert_game(s_conn, blake3_hash="sharer_hash_abc")
        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        row = r_conn.execute("SELECT blake3_hash FROM games WHERE id = ?", (new_id,)).fetchone()
        assert row["blake3_hash"] == "sharer_hash_abc"

        s_conn.close()
        r_conn.close()

    def test_copies_all_game_videos_with_sizes(self, tmp_path):
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")

        game_id = _insert_game(s_conn, blake3_hash=None, video_size=None)
        _insert_game_video(s_conn, game_id, "hash_part1", sequence=0, video_size=3_000_000_000)
        _insert_game_video(s_conn, game_id, "hash_part2", sequence=1, video_size=2_500_000_000)

        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        videos = r_conn.execute(
            "SELECT blake3_hash, video_size FROM game_videos WHERE game_id = ? ORDER BY sequence",
            (new_id,),
        ).fetchall()
        assert len(videos) == 2
        assert videos[0]["blake3_hash"] == "hash_part1"
        assert videos[0]["video_size"] == 3_000_000_000
        assert videos[1]["blake3_hash"] == "hash_part2"
        assert videos[1]["video_size"] == 2_500_000_000

        s_conn.close()
        r_conn.close()

    def test_extension_cost_uses_copied_video_size(self, tmp_path):
        """End-to-end: copied video_size produces correct extension cost."""
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")

        original_size = int(5.0 * 1024 ** 3)  # 5 GB
        game_id = _insert_game(s_conn, video_size=original_size)
        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        recipient_game = r_conn.execute(
            "SELECT video_size FROM games WHERE id = ?", (new_id,),
        ).fetchone()

        sharer_cost = calculate_extension_cost(original_size, 30)
        recipient_cost = calculate_extension_cost(recipient_game["video_size"], 30)
        assert recipient_cost == sharer_cost

        s_conn.close()
        r_conn.close()


# ===========================================================================
# Storage refs: independence + UPSERT behavior (requires Postgres)
# ===========================================================================

class TestStorageRefIndependence:
    """Verify sharer and recipient storage refs are fully independent."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("sharer-user", email="sharer@test.com")
        create_user("recipient-user", email="recipient@test.com")
        create_user("user-a", email="a@test.com")
        create_user("user-b", email="b@test.com")
        create_user("user-1", email="u1@test.com")
        create_user("user-2", email="u2@test.com")

    def test_create_storage_refs_copies_sharer_expiry(self, pg_conn, tmp_path):
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        game_id = _insert_game(s_conn, blake3_hash="shared_hash_1")

        sharer_expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
        insert_game_storage_ref("sharer-user", "sharer-profile", "shared_hash_1",
                                5_000_000_000, sharer_expiry)

        hashes = _collect_video_hashes(s_conn, game_id)
        _create_storage_refs(
            "sharer-user", "sharer-profile",
            "recipient-user", "recipient-profile",
            hashes,
        )

        recipient_ref = get_game_storage_ref("recipient-user", "recipient-profile", "shared_hash_1")
        assert recipient_ref is not None
        assert str(recipient_ref["storage_expires_at"]).startswith(sharer_expiry[:10])

        s_conn.close()

    def test_recipient_extend_does_not_affect_sharer(self, pg_conn, tmp_path):
        # Storage refs live in per-profile SQLite (game_storage keyed by hash);
        # independence comes from sharer and recipient having SEPARATE profile DBs,
        # not from a user_id column. Route get_db_connection to each user's own DB.
        sharer_db = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        recipient_db = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")
        sharer_db.executescript(
            "CREATE TABLE IF NOT EXISTS game_storage (blake3_hash TEXT PRIMARY KEY, "
            "game_size_bytes INTEGER, storage_expires_at TEXT, "
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);"
        )
        recipient_db.executescript(
            "CREATE TABLE IF NOT EXISTS game_storage (blake3_hash TEXT PRIMARY KEY, "
            "game_size_bytes INTEGER, storage_expires_at TEXT, "
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);"
        )

        @contextmanager
        def _conn_for(conn):
            yield conn

        sharer_expiry = (datetime.utcnow() + timedelta(days=5)).isoformat()
        with patch("app.database.get_db_connection", lambda: _conn_for(sharer_db)):
            insert_game_storage_ref("sharer-user", "sharer-profile", "indep_hash",
                                    5_000_000_000, sharer_expiry)

        recipient_expiry = (datetime.utcnow() + timedelta(days=5)).isoformat()
        new_expiry = (datetime.utcnow() + timedelta(days=60)).isoformat()
        with patch("app.database.get_db_connection", lambda: _conn_for(recipient_db)):
            insert_game_storage_ref("recipient-user", "recipient-profile", "indep_hash",
                                    5_000_000_000, recipient_expiry)
            insert_game_storage_ref("recipient-user", "recipient-profile", "indep_hash",
                                    5_000_000_000, new_expiry)

        with patch("app.database.get_db_connection", lambda: _conn_for(sharer_db)):
            sharer_ref = get_game_storage_ref("sharer-user", "sharer-profile", "indep_hash")
        with patch("app.database.get_db_connection", lambda: _conn_for(recipient_db)):
            recipient_ref = get_game_storage_ref("recipient-user", "recipient-profile", "indep_hash")

        sharer_dt = sharer_ref["storage_expires_at"] if isinstance(sharer_ref["storage_expires_at"], datetime) else datetime.fromisoformat(sharer_ref["storage_expires_at"])
        recipient_dt = recipient_ref["storage_expires_at"] if isinstance(recipient_ref["storage_expires_at"], datetime) else datetime.fromisoformat(recipient_ref["storage_expires_at"])

        assert recipient_dt > sharer_dt + timedelta(days=30)

        sharer_db.close()
        recipient_db.close()

    def test_get_storage_refs_for_user_is_user_scoped(self, pg_conn):
        insert_game_storage_ref("user-a", "prof-a", "scoped_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())
        insert_game_storage_ref("user-b", "prof-b", "scoped_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())

        refs_a = get_storage_refs_for_user("user-a")
        refs_b = get_storage_refs_for_user("user-b")

        a_hashes = {r["blake3_hash"] for r in refs_a}
        b_hashes = {r["blake3_hash"] for r in refs_b}
        assert "scoped_hash" in a_hashes
        assert "scoped_hash" in b_hashes
        assert all(r.get("user_id", "user-a") != "user-b" for r in refs_a)

    def test_all_ref_hashes_includes_both_users(self, pg_conn):
        insert_game_storage_ref("user-1", "prof-1", "both_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())
        insert_game_storage_ref("user-2", "prof-2", "both_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())

        all_hashes = get_all_ref_hashes()
        assert "both_hash" in all_hashes


# ===========================================================================
# can_extend flag: cross-user visibility
# ===========================================================================

class TestCanExtendCrossUser:
    """Verify can_extend is True when ANY user has a ref for the hash."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("sharer-user", email="sharer@test.com")
        create_user("recipient-user", email="recipient@test.com")

    def test_can_extend_true_when_sharer_ref_exists(self, pg_conn):
        insert_game_storage_ref("sharer-user", "sharer-profile", "extend_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())

        all_hashes = get_all_ref_hashes()
        grace_hashes = get_grace_deletion_hashes()
        can_extend = "extend_hash" in all_hashes or "extend_hash" in grace_hashes
        assert can_extend is True

    def test_can_extend_true_during_grace_period(self, pg_conn):
        insert_grace_deletion("grace_hash")

        all_hashes = get_all_ref_hashes()
        grace_hashes = get_grace_deletion_hashes()
        can_extend = "grace_hash" in all_hashes or "grace_hash" in grace_hashes
        assert can_extend is True

    def test_can_extend_false_when_no_refs_no_grace(self, pg_conn):
        all_hashes = get_all_ref_hashes()
        grace_hashes = get_grace_deletion_hashes()
        can_extend = "nonexistent_hash" in all_hashes or "nonexistent_hash" in grace_hashes
        assert can_extend is False


# ===========================================================================
# Grace period: extend cancels grace deletion
# ===========================================================================

class TestGracePeriodExtend:
    """Verify extending during grace period cancels the grace deletion."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("recipient-user", email="recipient@test.com")

    def test_extend_cancels_grace_deletion(self, pg_conn):
        insert_grace_deletion("grace_cancel_hash")
        assert "grace_cancel_hash" in get_grace_deletion_hashes()

        new_expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile",
                                "grace_cancel_hash", 5_000_000_000, new_expiry)

        assert "grace_cancel_hash" not in get_grace_deletion_hashes()

        ref = get_game_storage_ref("recipient-user", "recipient-profile", "grace_cancel_hash")
        assert ref is not None

    def test_extend_recreates_deleted_ref(self, pg_conn):
        expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile",
                                "recreate_hash", 5_000_000_000, expiry)
        delete_ref("recipient-user", "recipient-profile", "recreate_hash")

        ref = get_game_storage_ref("recipient-user", "recipient-profile", "recreate_hash")
        assert ref is None

        new_expiry = (datetime.utcnow() + timedelta(days=60)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile",
                                "recreate_hash", 5_000_000_000, new_expiry)

        ref = get_game_storage_ref("recipient-user", "recipient-profile", "recreate_hash")
        assert ref is not None


# ===========================================================================
# Extension cost: same for uploader and recipient
# ===========================================================================

class TestExtensionCostParity:
    """Verify recipients pay the same rate as uploaders."""

    def test_same_size_same_cost(self):
        size = int(5.0 * 1024 ** 3)
        uploader_cost = calculate_extension_cost(size, 30)
        recipient_cost = calculate_extension_cost(size, 30)
        assert uploader_cost == recipient_cost

    def test_zero_size_minimum_cost(self):
        assert calculate_extension_cost(0, 30) == 1

    def test_expiry_extension_from_existing(self):
        current = datetime.utcnow() + timedelta(days=5)
        new = storage_expires_at(from_dt=current, days=30)
        assert new > current + timedelta(days=29)


# ===========================================================================
# Expiry base calculation (replicates endpoint logic lines 954-958)
# ===========================================================================

class TestExpiryBaseCalculation:
    """The extend endpoint uses max(current_expiry, now) as the base for new expiry.
    This ensures extending an expired ref starts from now, not from the past."""

    def test_active_ref_extends_from_current_expiry(self):
        future_expiry = datetime.utcnow() + timedelta(days=10)
        exp_dt = future_expiry
        base = max(exp_dt.replace(tzinfo=None), datetime.utcnow())
        new_expiry = storage_expires_at(from_dt=base, days=30)
        assert new_expiry > future_expiry + timedelta(days=29)

    def test_expired_ref_extends_from_now(self):
        past_expiry = datetime.utcnow() - timedelta(days=5)
        exp_dt = past_expiry
        base = max(exp_dt.replace(tzinfo=None), datetime.utcnow())
        new_expiry = storage_expires_at(from_dt=base, days=30)
        expected_min = datetime.utcnow() + timedelta(days=29)
        assert new_expiry > expected_min

    def test_no_ref_extends_from_now(self):
        base = datetime.utcnow()
        new_expiry = storage_expires_at(from_dt=base, days=30)
        assert new_expiry > datetime.utcnow() + timedelta(days=29)

    def test_just_expired_ref_uses_now_not_past(self):
        just_expired = datetime.utcnow() - timedelta(hours=1)
        base = max(just_expired.replace(tzinfo=None), datetime.utcnow())
        new_expiry = storage_expires_at(from_dt=base, days=30)
        assert new_expiry > datetime.utcnow() + timedelta(days=29)
        assert new_expiry < datetime.utcnow() + timedelta(days=31)


# ===========================================================================
# list_games storage_status derivation (replicates endpoint logic lines 764-778)
# ===========================================================================

class TestStorageStatusDerivation:
    """Verify the inline logic that derives storage_status and can_extend."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn, tmp_path):
        # insert_game_storage_ref -> get_db_connection reads the CURRENT user
        # context (not the passed user_id) to locate the per-profile SQLite, so
        # a bare pytest run of this class hit "RuntimeError: No user context
        # set". The derivation assertions read from Postgres, so the SQLite
        # write is incidental but must not crash — set a context and isolate it
        # in tmp_path, mirroring the other pg-backed classes (T5050).
        from app.user_context import set_current_user_id, reset_user_id
        from app.profile_context import set_current_profile_id, reset_profile_id_token

        create_user("sharer-user", email="sharer@test.com")
        create_user("recipient-user", email="recipient@test.com")

        set_current_user_id("recipient-user")
        prof_token = set_current_profile_id("recipient-profile")
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", {"sharer-user", "recipient-user"}), \
             patch("app.database.R2_ENABLED", False):
            yield
        # Restore the pre-class context (session default profile / no user) so a
        # leaked context can't pollute later tests under full-suite ordering.
        reset_user_id()
        reset_profile_id_token(prof_token)

    @staticmethod
    def _derive_status(expires_at_val, auto_export_status=None):
        # Exercise the real shared helper so this test and the endpoints can't
        # diverge (games.py list_games + load_game both use it).
        from app.routers.games import _compute_storage_status
        return _compute_storage_status(expires_at_val, auto_export_status)

    def test_active_ref_shows_active(self, pg_conn):
        future = (datetime.utcnow() + timedelta(days=10)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile", "status_active",
                                1000, future)
        refs = get_storage_refs_for_user("recipient-user")
        expiry_by_hash = {r['blake3_hash']: r['storage_expires_at'] for r in refs}
        status = self._derive_status(expiry_by_hash.get("status_active"))
        assert status == 'active'

    def test_expired_ref_shows_expired(self, pg_conn):
        past = (datetime.utcnow() - timedelta(days=1)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile", "status_expired",
                                1000, past)
        refs = get_storage_refs_for_user("recipient-user")
        expiry_by_hash = {r['blake3_hash']: r['storage_expires_at'] for r in refs}
        status = self._derive_status(expiry_by_hash.get("status_expired"))
        assert status == 'expired'

    def test_no_ref_no_auto_export_shows_active(self):
        status = self._derive_status(None, auto_export_status=None)
        assert status == 'active'

    def test_no_ref_with_auto_export_shows_expired(self):
        status = self._derive_status(None, auto_export_status='completed')
        assert status == 'expired'

    def test_can_extend_true_recipient_expired_sharer_active(self, pg_conn):
        """Recipient's ref expired but sharer's is active -> can_extend=True."""
        sharer_future = (datetime.utcnow() + timedelta(days=20)).isoformat()
        insert_game_storage_ref("sharer-user", "sharer-profile", "cross_extend",
                                1000, sharer_future)
        recipient_past = (datetime.utcnow() - timedelta(days=2)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile", "cross_extend",
                                1000, recipient_past)

        recipient_refs = get_storage_refs_for_user("recipient-user")
        expiry_by_hash = {r['blake3_hash']: r['storage_expires_at'] for r in recipient_refs}
        status = self._derive_status(expiry_by_hash.get("cross_extend"))
        assert status == 'expired'

        all_hashes = get_all_ref_hashes()
        can_extend = "cross_extend" in all_hashes
        assert can_extend is True

    def test_expired_then_extend_then_active(self, pg_conn):
        """Full lifecycle: expired -> extend -> active."""
        past = (datetime.utcnow() - timedelta(days=2)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile", "lifecycle_hash",
                                5_000_000_000, past)

        refs = get_storage_refs_for_user("recipient-user")
        expiry_by_hash = {r['blake3_hash']: r['storage_expires_at'] for r in refs}
        assert self._derive_status(expiry_by_hash.get("lifecycle_hash")) == 'expired'

        new_expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile", "lifecycle_hash",
                                5_000_000_000, new_expiry)

        refs = get_storage_refs_for_user("recipient-user")
        expiry_by_hash = {r['blake3_hash']: r['storage_expires_at'] for r in refs}
        assert self._derive_status(expiry_by_hash.get("lifecycle_hash")) == 'active'


# ===========================================================================
# Full extend endpoint handler test
# ===========================================================================

class TestExtendEndpointHandler:
    """Test the extend_game_storage endpoint with mocked user context."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("recipient-user", email="recipient@test.com")
        create_user("sharer-user", email="sharer@test.com")

    @pytest.mark.asyncio
    async def test_recipient_extends_shared_game(self, pg_conn, tmp_path):
        from app.routers.games import extend_game_storage, ExtendStorageRequest

        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")
        game_id = _insert_game(r_conn, blake3_hash="endpoint_hash",
                               video_size=int(5.0 * 1024 ** 3))
        _insert_game_video(r_conn, game_id, "endpoint_hash", sequence=0,
                           video_size=int(5.0 * 1024 ** 3))

        initial_expiry = (datetime.utcnow() + timedelta(days=5)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile",
                                "endpoint_hash", int(5.0 * 1024 ** 3), initial_expiry)

        @contextmanager
        def mock_db_conn():
            yield r_conn

        with patch("app.routers.games.get_current_user_id", return_value="recipient-user"), \
             patch("app.routers.games.get_current_profile_id", return_value="recipient-profile"), \
             patch("app.routers.games.get_db_connection", mock_db_conn), \
             patch("app.routers.games.deduct_credits", return_value={"success": True, "balance": 9}):
            result = await extend_game_storage(game_id, ExtendStorageRequest(days=30))

        assert result["success"] is True
        assert result["cost_credits"] == 2  # 5 GB for 30 days
        assert result["new_balance"] == 9

        ref = get_game_storage_ref("recipient-user", "recipient-profile", "endpoint_hash")
        ref_dt = _parse_ref_dt(ref)
        assert ref_dt > datetime.utcnow() + timedelta(days=34)

        r_conn.close()

    @pytest.mark.asyncio
    async def test_extend_expired_shared_game_starts_from_now(self, pg_conn, tmp_path):
        from app.routers.games import extend_game_storage, ExtendStorageRequest

        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")
        game_id = _insert_game(r_conn, blake3_hash="expired_ep_hash",
                               video_size=int(2.5 * 1024 ** 3))
        _insert_game_video(r_conn, game_id, "expired_ep_hash", sequence=0,
                           video_size=int(2.5 * 1024 ** 3))

        past_expiry = (datetime.utcnow() - timedelta(days=10)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile",
                                "expired_ep_hash", int(2.5 * 1024 ** 3), past_expiry)

        @contextmanager
        def mock_db_conn():
            yield r_conn

        with patch("app.routers.games.get_current_user_id", return_value="recipient-user"), \
             patch("app.routers.games.get_current_profile_id", return_value="recipient-profile"), \
             patch("app.routers.games.get_db_connection", mock_db_conn), \
             patch("app.routers.games.deduct_credits", return_value={"success": True, "balance": 5}):
            result = await extend_game_storage(game_id, ExtendStorageRequest(days=30))

        assert result["success"] is True
        ref = get_game_storage_ref("recipient-user", "recipient-profile", "expired_ep_hash")
        ref_dt = _parse_ref_dt(ref)
        assert ref_dt > datetime.utcnow() + timedelta(days=29)
        assert ref_dt < datetime.utcnow() + timedelta(days=31)

        r_conn.close()

    @pytest.mark.asyncio
    async def test_extend_does_not_affect_sharer_ref(self, pg_conn, tmp_path):
        from app.routers.games import extend_game_storage, ExtendStorageRequest

        # Storage refs live in per-profile SQLite (game_storage keyed by hash);
        # sharer/recipient independence comes from separate profile DBs. The endpoint's
        # ref read/write go through app.database.get_db_connection (via auth_db), so
        # route that to the recipient DB during the call and to the sharer DB when
        # reading the sharer's ref afterward.
        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        for c in (r_conn, s_conn):
            c.executescript(
                "CREATE TABLE IF NOT EXISTS game_storage (blake3_hash TEXT PRIMARY KEY, "
                "game_size_bytes INTEGER, storage_expires_at TEXT, "
                "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);"
            )
        game_id = _insert_game(r_conn, blake3_hash="isolate_hash",
                               video_size=int(1.0 * 1024 ** 3))
        _insert_game_video(r_conn, game_id, "isolate_hash", sequence=0,
                           video_size=int(1.0 * 1024 ** 3))

        @contextmanager
        def _conn_for(conn):
            yield conn

        sharer_expiry = (datetime.utcnow() + timedelta(days=15)).isoformat()
        with patch("app.database.get_db_connection", lambda: _conn_for(s_conn)):
            insert_game_storage_ref("sharer-user", "sharer-profile",
                                    "isolate_hash", int(1.0 * 1024 ** 3), sharer_expiry)

        recipient_expiry = (datetime.utcnow() + timedelta(days=3)).isoformat()
        with patch("app.database.get_db_connection", lambda: _conn_for(r_conn)):
            insert_game_storage_ref("recipient-user", "recipient-profile",
                                    "isolate_hash", int(1.0 * 1024 ** 3), recipient_expiry)

        @contextmanager
        def mock_db_conn():
            yield r_conn

        with patch("app.routers.games.get_current_user_id", return_value="recipient-user"), \
             patch("app.routers.games.get_current_profile_id", return_value="recipient-profile"), \
             patch("app.routers.games.get_db_connection", mock_db_conn), \
             patch("app.database.get_db_connection", lambda: _conn_for(r_conn)), \
             patch("app.routers.games.deduct_credits", return_value={"success": True, "balance": 10}):
            await extend_game_storage(game_id, ExtendStorageRequest(days=60))

        with patch("app.database.get_db_connection", lambda: _conn_for(s_conn)):
            sharer_ref = get_game_storage_ref("sharer-user", "sharer-profile", "isolate_hash")
        sharer_dt = _parse_ref_dt(sharer_ref)
        assert abs((sharer_dt - _to_naive_utc(sharer_expiry)).total_seconds()) < 2

        r_conn.close()
        s_conn.close()

    @pytest.mark.asyncio
    async def test_extend_insufficient_credits_returns_402(self, pg_conn, tmp_path):
        from app.routers.games import extend_game_storage, ExtendStorageRequest
        from fastapi import HTTPException

        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")
        game_id = _insert_game(r_conn, blake3_hash="broke_hash",
                               video_size=int(5.0 * 1024 ** 3))

        @contextmanager
        def mock_db_conn():
            yield r_conn

        with patch("app.routers.games.get_current_user_id", return_value="recipient-user"), \
             patch("app.routers.games.get_current_profile_id", return_value="recipient-profile"), \
             patch("app.routers.games.get_db_connection", mock_db_conn), \
             patch("app.routers.games.deduct_credits", return_value={"success": False, "balance": 0}):
            with pytest.raises(HTTPException) as exc_info:
                await extend_game_storage(game_id, ExtendStorageRequest(days=30))
            assert exc_info.value.status_code == 402

        r_conn.close()


# ===========================================================================
# Multi-video game extension
# ===========================================================================

class TestMultiVideoExtend:
    """Verify all game_videos refs are updated when extending a multi-video game."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("recipient-user", email="recipient@test.com")

    @pytest.mark.asyncio
    async def test_extends_all_video_refs(self, pg_conn, tmp_path):
        from app.routers.games import extend_game_storage, ExtendStorageRequest

        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")
        game_id = _insert_game(r_conn, blake3_hash=None, video_size=None)
        _insert_game_video(r_conn, game_id, "multi_v1", sequence=0, video_size=3_000_000_000)
        _insert_game_video(r_conn, game_id, "multi_v2", sequence=1, video_size=2_000_000_000)
        _insert_game_video(r_conn, game_id, "multi_v3", sequence=2, video_size=1_500_000_000)

        initial_expiry = (datetime.utcnow() + timedelta(days=5)).isoformat()
        for h in ["multi_v1", "multi_v2", "multi_v3"]:
            insert_game_storage_ref("recipient-user", "recipient-profile", h, 1000, initial_expiry)

        @contextmanager
        def mock_db_conn():
            yield r_conn

        with patch("app.routers.games.get_current_user_id", return_value="recipient-user"), \
             patch("app.routers.games.get_current_profile_id", return_value="recipient-profile"), \
             patch("app.routers.games.get_db_connection", mock_db_conn), \
             patch("app.routers.games.deduct_credits", return_value={"success": True, "balance": 10}):
            result = await extend_game_storage(game_id, ExtendStorageRequest(days=30))

        assert result["success"] is True

        # Multi-video games have blake3_hash=None on the games table, so the endpoint
        # can't look up a base ref and extends from now() instead of current_expiry.
        for h in ["multi_v1", "multi_v2", "multi_v3"]:
            ref = get_game_storage_ref("recipient-user", "recipient-profile", h)
            ref_dt = _parse_ref_dt(ref)
            assert ref_dt > datetime.utcnow() + timedelta(days=29)

        r_conn.close()

    @pytest.mark.asyncio
    async def test_multi_video_grace_cancellation(self, pg_conn, tmp_path):
        """Extending a multi-video game cancels grace deletions for ALL hashes."""
        from app.routers.games import extend_game_storage, ExtendStorageRequest

        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")
        game_id = _insert_game(r_conn, blake3_hash=None, video_size=None)
        _insert_game_video(r_conn, game_id, "grace_mv1", sequence=0, video_size=2_000_000_000)
        _insert_game_video(r_conn, game_id, "grace_mv2", sequence=1, video_size=2_000_000_000)

        insert_grace_deletion("grace_mv1")
        insert_grace_deletion("grace_mv2")
        assert "grace_mv1" in get_grace_deletion_hashes()
        assert "grace_mv2" in get_grace_deletion_hashes()

        @contextmanager
        def mock_db_conn():
            yield r_conn

        with patch("app.routers.games.get_current_user_id", return_value="recipient-user"), \
             patch("app.routers.games.get_current_profile_id", return_value="recipient-profile"), \
             patch("app.routers.games.get_db_connection", mock_db_conn), \
             patch("app.routers.games.deduct_credits", return_value={"success": True, "balance": 10}):
            await extend_game_storage(game_id, ExtendStorageRequest(days=30))

        assert "grace_mv1" not in get_grace_deletion_hashes()
        assert "grace_mv2" not in get_grace_deletion_hashes()

        r_conn.close()
