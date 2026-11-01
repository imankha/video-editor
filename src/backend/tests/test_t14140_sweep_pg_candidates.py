"""T14140 (commit 2): the expiry sweep selects its work from Postgres
game_storage_refs instead of walking every user's R2 profile listing.

- Phase 1 opens ONLY profiles with an expiring PG ref (10K users, 3 expiring).
- No R2 ListObjectsV2 / user enumeration per sweep.
- A PG ref whose profile.sqlite is gone (orphan) is skipped loudly, never opened.
- Phase 2 checks the PG holders of a grace hash (opened via the seam), plus the
  profile that queued it; a grace row with no recorded queuer and no holder is
  deferred, never deleted blind.
- Phase 1 records who queued the grace row.
"""

import logging
import sqlite3
import sys
import types
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from psycopg2.extras import execute_values

if "cv2" not in sys.modules:
    sys.modules["cv2"] = types.ModuleType("cv2")

M = "app.services.sweep_scheduler"
N_USERS = 10_000
PAST = datetime.now(UTC) - timedelta(days=2)
FUTURE = datetime.now(UTC) + timedelta(days=30)


def _make_profile_db(base, user_id, profile_id, live_hashes=()):
    path = base / user_id / "profiles" / profile_id / "profile.sqlite"
    path.parent.mkdir(parents=True)
    conn = sqlite3.connect(str(path))
    conn.executescript("""
        CREATE TABLE games (id INTEGER PRIMARY KEY, blake3_hash TEXT, auto_export_status TEXT,
                            auto_export_attempts INTEGER DEFAULT 0, recap_video_url TEXT);
        CREATE TABLE game_videos (id INTEGER PRIMARY KEY, game_id INTEGER, blake3_hash TEXT,
                                  sequence INTEGER);
        CREATE TABLE game_storage (id INTEGER PRIMARY KEY AUTOINCREMENT,
            blake3_hash TEXT NOT NULL UNIQUE, game_size_bytes INTEGER NOT NULL,
            storage_expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
    """)
    for h in live_hashes:
        conn.execute(
            "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES (?, 1, ?)",
            (h, FUTURE.isoformat()),
        )
    conn.commit()
    conn.close()
    return path


@pytest.fixture
def synthetic_pg(pg_conn):
    """Yield a cursor; delete every row this test created afterwards."""
    import psycopg2
    from psycopg2.extras import RealDictCursor

    conn = psycopg2.connect(pg_conn, cursor_factory=RealDictCursor)
    conn.autocommit = True
    cur = conn.cursor()
    tag = f"t14140-{uuid4().hex[:6]}"
    yield cur, tag
    cur.execute("DELETE FROM r2_grace_deletions WHERE blake3_hash LIKE %s", (f"{tag}%",))
    cur.execute("DELETE FROM game_storage_refs WHERE user_id LIKE %s", (f"{tag}%",))
    cur.execute("DELETE FROM users WHERE user_id LIKE %s", (f"{tag}%",))
    conn.close()


def _seed_users(cur, tag, n):
    ids = [f"{tag}-u{i:05d}" for i in range(n)]
    execute_values(cur, "INSERT INTO users (user_id, email) VALUES %s",
                   [(u, f"{u}@t14140.invalid") for u in ids], page_size=2000)
    return ids


def _seed_refs(cur, rows):
    execute_values(
        cur,
        """INSERT INTO game_storage_refs
               (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
           VALUES %s""",
        rows, page_size=2000,
    )


class TestPhase1Candidates:
    def test_10k_users_three_expiring_opens_only_those(self, synthetic_pg, tmp_path):
        from app.services.sweep_scheduler import do_sweep
        from app.user_context import get_current_user_id

        cur, tag = synthetic_pg
        users = _seed_users(cur, tag, N_USERS)
        expiring = users[:3]
        # Every user holds a live ref; three also hold an expired one.
        _seed_refs(cur, [(u, "p", f"{tag}-live-{i}", 1, FUTURE) for i, u in enumerate(users)]
                   + [(u, "p", f"{tag}-exp-{i}", 1, PAST) for i, u in enumerate(expiring)])
        for u in expiring:
            _make_profile_db(tmp_path, u, "p")

        opened = []
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database.R2_ENABLED", False), \
             patch(f"{M}.ensure_database", side_effect=lambda: opened.append(get_current_user_id())), \
             patch(f"{M}.get_expired_refs_for_profile", return_value=[]), \
             patch(f"{M}.get_expired_grace_deletions", return_value=[]), \
             patch("app.migrations._get_profile_ids", return_value=[]) as listing, \
             patch("app.services.auth_db.get_all_users_for_admin",
                   return_value=[{"user_id": u} for u in users]) as enumerate_users:
            do_sweep()

        ours = [u for u in opened if u.startswith(tag)]
        assert sorted(ours) == sorted(expiring), "sweep must open exactly the expiring profiles"
        assert listing.call_count == 0, "no per-user R2 ListObjectsV2"
        assert enumerate_users.call_count == 0, "no all-users enumeration"

    def test_orphan_pg_ref_is_skipped_loudly(self, synthetic_pg, tmp_path, caplog):
        from app.services.sweep_scheduler import do_sweep
        from app.user_context import get_current_user_id

        cur, tag = synthetic_pg
        (user,) = _seed_users(cur, tag, 1)
        _seed_refs(cur, [(user, "gone", f"{tag}-orphan", 1, PAST)])  # no profile.sqlite

        opened = []
        caplog.set_level(logging.WARNING, logger=M)
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database.R2_ENABLED", False), \
             patch(f"{M}.ensure_database", side_effect=lambda: opened.append(get_current_user_id())), \
             patch(f"{M}.get_expired_grace_deletions", return_value=[]), \
             patch("app.migrations._get_profile_ids", return_value=[]):
            do_sweep()

        assert user not in opened
        assert not (tmp_path / user).exists(), "a missing profile must never be recreated"
        assert any("orphan" in r.message and user[:8] in r.message for r in caplog.records)

    def test_reclaim_records_who_queued_the_grace_row(self, synthetic_pg, tmp_path):
        from app.services.sweep_scheduler import GRACE_PERIOD_DAYS, do_sweep

        cur, tag = synthetic_pg
        (user,) = _seed_users(cur, tag, 1)
        h = f"{tag}-reclaim"
        _seed_refs(cur, [(user, "p", h, 1, PAST)])
        _make_profile_db(tmp_path, user, "p")

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database.R2_ENABLED", False), \
             patch("app.database._initialized_users", {user}), \
             patch(f"{M}.ensure_database"), \
             patch(f"{M}.get_expired_refs_for_profile", return_value=[{"blake3_hash": h}]), \
             patch(f"{M}.delete_ref"), \
             patch(f"{M}.has_remaining_refs", return_value=False), \
             patch(f"{M}.insert_grace_deletion") as queue, \
             patch(f"{M}.get_expired_grace_deletions", return_value=[]), \
             patch("app.migrations._get_profile_ids", return_value=[]):
            do_sweep()

        queue.assert_called_once_with(h, GRACE_PERIOD_DAYS, user, "p")


class TestPhase2Holders:
    @pytest.fixture(autouse=True)
    def _production_env(self, monkeypatch):
        monkeypatch.setattr("app.storage.APP_ENV", "production")

    def test_pg_holder_with_live_ref_cancels_delete(self, synthetic_pg, tmp_path):
        """The holder is not in any listing; Phase 2 must open it itself."""
        from app.services.sweep_scheduler import do_sweep
        from app.user_context import get_current_user_id

        cur, tag = synthetic_pg
        (user,) = _seed_users(cur, tag, 1)
        h = f"{tag}-held"
        _seed_refs(cur, [(user, "p", h, 1, FUTURE)])
        cur.execute("INSERT INTO r2_grace_deletions (blake3_hash, grace_expires_at) VALUES (%s, %s)",
                    (h, PAST))
        _make_profile_db(tmp_path, user, "p", live_hashes=[h])

        opened = []
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database.R2_ENABLED", False), \
             patch("app.database._initialized_users", {user}), \
             patch(f"{M}.ensure_database", side_effect=lambda: opened.append(get_current_user_id())), \
             patch(f"{M}.get_expired_grace_deletions", return_value=[h]), \
             patch(f"{M}.r2_delete_object_global") as r2_delete, \
             patch(f"{M}.delete_grace_deletion") as cancel, \
             patch("app.migrations._get_profile_ids", return_value=[]):
            do_sweep()

        r2_delete.assert_not_called()
        cancel.assert_called_once_with(h)
        assert user in opened, "Phase 2 must open the holder through the JIT seam"

    def test_legacy_grace_row_without_queuer_or_holder_is_deferred(self, synthetic_pg, tmp_path):
        from app.services.sweep_scheduler import do_sweep

        cur, tag = synthetic_pg
        h = f"{tag}-legacy"
        cur.execute("INSERT INTO r2_grace_deletions (blake3_hash, grace_expires_at) VALUES (%s, %s)",
                    (h, PAST))

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database.R2_ENABLED", False), \
             patch(f"{M}.get_expired_grace_deletions", return_value=[h]), \
             patch(f"{M}.r2_delete_object_global") as r2_delete, \
             patch(f"{M}.delete_grace_deletion") as cancel, \
             patch("app.migrations._get_profile_ids", return_value=[]):
            do_sweep()

        r2_delete.assert_not_called()
        cancel.assert_not_called()
