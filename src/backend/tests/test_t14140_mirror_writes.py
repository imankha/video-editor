"""T14140 (commit 1): keep the Postgres game_storage_refs mirror a SUPERSET of
every profile's SQLite game_storage rows (INV-M, T14140-design.md §2), so a
PG-driven sweep can never miss a profile that still holds a live ref.

- G3/G4: the dual writers write Postgres FIRST; a PG failure leaves no SQLite row.
- G6: deleting a profile deletes its game_storage_refs rows.
- Schema: idx_game_refs_expires + r2_grace_deletions.queued_by_* exist.
- Audit script: a SQLite-only LIVE row is a failure (exit 1).
"""

import importlib.util
import sqlite3
import sys
import types
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest

if "cv2" not in sys.modules:
    sys.modules["cv2"] = types.ModuleType("cv2")

REPO_ROOT = Path(__file__).resolve().parents[3]

FUTURE = (datetime.now(UTC) + timedelta(days=30)).isoformat()
PAST = (datetime.now(UTC) - timedelta(days=1)).isoformat()


def _load_audit_script():
    path = REPO_ROOT / "scripts" / "audit_game_storage_mirror.py"
    spec = importlib.util.spec_from_file_location("audit_game_storage_mirror", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _pg_ref(user_id, profile_id, blake3_hash):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM game_storage_refs WHERE user_id = %s AND profile_id = %s AND blake3_hash = %s",
            (user_id, profile_id, blake3_hash),
        )
        return cur.fetchone() is not None


@pytest.fixture
def profile_db(pg_conn, tmp_path):
    from app.profile_context import set_current_profile_id
    from app.services.auth_db import create_user
    from app.user_context import set_current_user_id

    user_id = f"t14140-{uuid4().hex[:8]}"
    create_user(user_id, email=f"{user_id}@example.com")
    set_current_user_id(user_id)
    set_current_profile_id("prof-1")

    db_path = tmp_path / user_id / "profiles" / "prof-1" / "profile.sqlite"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE game_storage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blake3_hash TEXT NOT NULL UNIQUE,
            game_size_bytes INTEGER NOT NULL,
            storage_expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", {user_id}), \
         patch("app.database.R2_ENABLED", False):
        yield {"user_id": user_id, "db_path": db_path}


class TestPgFirstOrdering:
    def test_insert_game_storage_ref_pg_failure_leaves_no_sqlite_row(self, profile_db):
        """G3: a PG failure must not leave a SQLite-only ref (the dangerous
        direction for a PG-driven Phase 2)."""
        from app.services import auth_db

        with patch.object(auth_db, "insert_game_storage_ref_pg_only",
                          side_effect=RuntimeError("pg down")), pytest.raises(RuntimeError):
            auth_db.insert_game_storage_ref(
                profile_db["user_id"], "prof-1", "h-g3", 100, FUTURE)

        conn = sqlite3.connect(str(profile_db["db_path"]))
        rows = conn.execute("SELECT 1 FROM game_storage WHERE blake3_hash = 'h-g3'").fetchall()
        conn.close()
        assert rows == [], "SQLite row written before the Postgres mirror (G3)"

    def test_insert_game_storage_ref_writes_both(self, profile_db):
        from app.services import auth_db

        auth_db.insert_game_storage_ref(profile_db["user_id"], "prof-1", "h-ok", 100, FUTURE)
        assert _pg_ref(profile_db["user_id"], "prof-1", "h-ok")
        conn = sqlite3.connect(str(profile_db["db_path"]))
        assert conn.execute("SELECT 1 FROM game_storage WHERE blake3_hash = 'h-ok'").fetchone()
        conn.close()

    @patch("app.services.materialization.mark_game_share_materialized")
    def test_materialization_pg_failure_leaves_no_recipient_sqlite_row(self, _mark, tmp_path, pg_conn):
        """G4: share materialization wrote+synced the recipient's SQLite ref and
        only THEN the PG row; a PG failure left a durable SQLite-only LIVE ref."""
        from app.services.auth_db import create_user
        from app.services.materialization import materialize_game_share
        from tests.test_materialization import _create_profile_db, _insert_clip, _insert_game

        sharer, recip = f"t14140-s-{uuid4().hex[:8]}", f"t14140-r-{uuid4().hex[:8]}"
        create_user(sharer, email=f"{sharer}@test.com")
        create_user(recip, email=f"{recip}@test.com")
        s_conn = _create_profile_db(tmp_path / sharer / "profiles" / "sp" / "profile.sqlite")
        r_path = tmp_path / recip / "profiles" / "rp" / "profile.sqlite"
        r_conn = _create_profile_db(r_path)
        r_conn.close()
        game_id = _insert_game(s_conn, name="G", blake3_hash="h-g4")
        _insert_clip(s_conn, game_id, 0, 5, tagged_teammates=["Jake"], name="Goal")
        s_conn.execute(
            "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES (?, ?, ?)",
            ("h-g4", 100, FUTURE),
        )
        s_conn.commit()
        s_conn.close()

        with patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
             patch("app.services.materialization.insert_game_storage_ref_pg_only",
                   side_effect=RuntimeError("pg down")), pytest.raises(RuntimeError):
            materialize_game_share(
                sharer_user_id=sharer, sharer_profile_id="sp",
                recipient_user_id=recip, recipient_profile_id="rp",
                game_id=game_id, tag_name="Jake", share_id=1,
            )

        conn = sqlite3.connect(str(r_path))
        rows = conn.execute("SELECT 1 FROM game_storage WHERE blake3_hash = 'h-g4'").fetchall()
        conn.close()
        assert rows == [], "recipient SQLite ref written before the Postgres mirror (G4)"


class TestDeleteProfileRefs:
    @patch("app.routers.profiles.delete_profile_r2_data")
    @patch("app.routers.profiles.delete_local_profile_data")
    def test_delete_profile_removes_its_pg_refs(self, _local, _r2, pg_conn):
        """G6: a deleted profile's game_storage_refs rows were left behind, pinning
        get_next_expiry in the past and pointing the sweep at a missing profile."""
        from fastapi.testclient import TestClient

        from app.main import app
        from app.services.auth_db import create_user, insert_game_storage_ref_pg_only
        from app.services.user_db import create_profile, ensure_user_database, set_selected_profile_id

        uid = f"t14140-del-{uuid4().hex[:8]}"
        create_user(uid, email=f"{uid}@example.com")
        p1, p2 = uuid4().hex[:8], uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Keep", "#3B82F6", is_default=True)
        create_profile(uid, p2, "Gone", "#10B981")
        set_selected_profile_id(uid, p1)
        insert_game_storage_ref_pg_only(uid, p1, "h-keep", 1, FUTURE)
        insert_game_storage_ref_pg_only(uid, p2, "h-gone", 1, PAST)

        resp = TestClient(app).delete(f"/api/profiles/{p2}", headers={"X-User-ID": uid, "X-Profile-ID": p1})

        assert resp.status_code == 200
        assert not _pg_ref(uid, p2, "h-gone"), "deleted profile's PG ref survived (G6)"
        assert _pg_ref(uid, p1, "h-keep"), "other profile's ref must be untouched"


class TestSchema:
    def test_expiry_index_and_grace_queued_by_columns(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_game_refs_expires'")
            assert cur.fetchone(), "idx_game_refs_expires missing"
            cur.execute(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_name = 'r2_grace_deletions'"""
            )
            cols = {r["column_name"] for r in cur.fetchall()}
        assert {"queued_by_user_id", "queued_by_profile_id"} <= cols


class TestAuditDiff:
    NOW = datetime(2026, 11, 1, tzinfo=UTC)

    def _diff(self, sqlite_rows, pg_rows, user_version=47):
        mod = _load_audit_script()
        return mod, mod.diff_profile(
            "u1", "p1", user_version, sqlite_rows, pg_rows, now=self.NOW)

    def test_sqlite_only_live_row_fails(self):
        mod, d = self._diff([("h1", "2026-12-01T00:00:00+00:00")], [])
        assert d["sqlite_only_live"] == ["h1"]
        assert mod.exit_code([d]) == 1

    def test_sqlite_only_expired_row_is_reported_not_fatal(self):
        mod, d = self._diff([("h1", "2026-10-01T00:00:00+00:00")], [])
        assert d["sqlite_only_expired"] == ["h1"]
        assert d["sqlite_only_live"] == []
        assert mod.exit_code([d]) == 0

    def test_unparseable_expiry_counts_as_live(self):
        _mod, d = self._diff([("h1", "garbage")], [])
        assert d["sqlite_only_live"] == ["h1"]

    def test_mirrored_and_pg_only(self):
        mod, d = self._diff(
            [("h1", "2026-12-01T00:00:00+00:00")],
            [("h1", datetime(2026, 12, 1, tzinfo=UTC)), ("h2", datetime(2026, 12, 1, tzinfo=UTC))],
        )
        assert d["sqlite_only_live"] == [] and d["pg_only"] == ["h2"]
        assert mod.exit_code([d]) == 0

    def test_below_v047_is_flagged_and_fatal(self):
        mod, d = self._diff([], [], user_version=46)
        assert d["below_backfill"] is True
        assert mod.exit_code([d]) == 1

    def test_unreadable_profile_is_fatal(self):
        mod = _load_audit_script()
        assert mod.exit_code([mod.unreadable_profile("u1", "p1", "boom")]) == 1
