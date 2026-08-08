"""
T5215 -- Intro attachment: resolution helper, reel PATCH, re-export
carry-forward, cross-profile move (no carry), collection freeze, consent gate,
no-N+1 list, and the v041 migration (renumbered from v037 on merging master,
which had advanced to v040 via T6640 while this branch was in flight).

Design: docs/plans/tasks/T5215-design.md. Acceptance criteria mapping:
  resolve_intro_card_id matrix (NULL/0/id + duration gate) .. TestResolveIntroCardIdMatrix
  threshold storage + validation ............................ TestThresholdStorage
  v041 migration (fresh DB + upgrade + idempotent) ........... TestMigrationV041
  re-export preserves attachment (THE important test) ........ TestReExportCarriesIntroCardId,
                                                                 test_export_final_endpoint_carries_intro_card_id
  cross-profile move never carries the attachment ............ TestMoveToProfileDoesNotCarryIntro
  reel PATCH: consent gate, dangling id, surgical write ....... TestSetDownloadIntro
  collection freeze survives a later default change ........... TestCollectionIntroFreeze
  GET /api/downloads has no per-tile N+1 ...................... TestListDownloadsNoN1
"""

import io
import logging
import sqlite3
from unittest.mock import patch

import pytest

from app.services.intro_cards import (
    DEFAULT_INTRO_MIN_DURATION_SECONDS,
    get_intro_min_duration,
    resolve_intro_card_id,
    validate_intro_min_duration,
)

USER_ID = "t5215-user"
PROFILE_ID = "t5215prof"


# ---------------------------------------------------------------------------
# Shared fixture: a real per-profile profile.sqlite (same pattern as
# test_t5195_intro_cards.py / test_t4010_reexport_in_place.py)
# ---------------------------------------------------------------------------

@pytest.fixture()
def db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_card(db_path, name="Card", is_default=0):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO intro_cards (name, shown_fields, treatment, is_default) "
        "VALUES (?, '[]', 'gold', ?)",
        (name, is_default),
    )
    card_id = cur.lastrowid
    conn.commit()
    conn.close()
    return card_id


def _seed_published_final(db_path, intro_card_id=None, duration=30.0):
    """A minimal published final_videos row (project + final, pointers wired)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "duration, aspect_ratio, published_at, intro_card_id) "
        "VALUES (?, 'f.mp4', 1, 'custom_project', 'Reel', ?, '9:16', CURRENT_TIMESTAMP, ?)",
        (project_id, duration, intro_card_id),
    )
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return project_id, fv_id


# ===========================================================================
# 1. Pure resolver matrix (resolve_intro_card_id) -- the SINGLE resolution
#    order every consumer shares.
# ===========================================================================

class TestResolveIntroCardIdMatrix:
    def test_zero_always_none_at_any_duration(self):
        assert resolve_intro_card_id(0, 5.0, 3, 20.0) is None
        assert resolve_intro_card_id(0, 500.0, 3, 20.0) is None
        assert resolve_intro_card_id(0, None, 3, 20.0) is None

    def test_explicit_id_always_wins_never_gated_by_duration(self):
        """The acceptance criterion: an EXPLICIT id applies even to a reel
        below the threshold -- the gate governs only the NULL/inherit path."""
        assert resolve_intro_card_id(7, 1.0, 3, 20.0) == 7
        assert resolve_intro_card_id(7, 999.0, 3, 20.0) == 7
        assert resolve_intro_card_id(7, None, 3, 20.0) == 7

    def test_null_inherit_long_reel_uses_default(self):
        assert resolve_intro_card_id(None, 25.0, 3, 20.0) == 3

    def test_null_inherit_short_reel_is_none(self):
        assert resolve_intro_card_id(None, 5.0, 3, 20.0) is None

    def test_null_inherit_boundary_is_inclusive(self):
        assert resolve_intro_card_id(None, 20.0, 3, 20.0) == 3
        assert resolve_intro_card_id(None, 19.999, 3, 20.0) is None

    def test_null_inherit_no_default_is_none(self):
        assert resolve_intro_card_id(None, 100.0, None, 20.0) is None

    def test_null_unknown_duration_fails_closed_and_warns_loudly(self, caplog):
        """A NULL duration on our OWN final_videos row is an internal bug, not
        an expected state -- fail closed to no-intro AND warn with the reel id
        (user requirement 2026-08-06), never silently substitute a duration."""
        with caplog.at_level(logging.WARNING):
            result = resolve_intro_card_id(None, None, 3, 20.0, reel_id=42)
        assert result is None
        assert "reel id=42" in caplog.text
        assert "internal data bug" in caplog.text


# ===========================================================================
# 2. Threshold storage + validation
# ===========================================================================

class TestThresholdStorage:
    def test_default_when_column_absent(self, db, monkeypatch):
        import app.services.intro_cards as ic
        monkeypatch.setattr(ic, "column_exists", lambda cursor, table, col: False)
        conn = _connect(db)
        assert get_intro_min_duration(conn.cursor()) == DEFAULT_INTRO_MIN_DURATION_SECONDS
        conn.close()

    def test_default_on_fresh_profile_db(self, db):
        conn = _connect(db)
        assert get_intro_min_duration(conn.cursor()) == 20.0
        conn.close()

    def test_reads_stored_value(self, db):
        conn = _connect(db)
        conn.execute("UPDATE user_settings SET intro_min_duration_seconds = 45.0 WHERE id = 1")
        conn.commit()
        assert get_intro_min_duration(conn.cursor()) == 45.0
        conn.close()

    def test_validate_bounds_reject_zero_and_over_300(self):
        with pytest.raises(ValueError):
            validate_intro_min_duration(0)
        with pytest.raises(ValueError):
            validate_intro_min_duration(300.01)

    def test_validate_bounds_accept_edges(self):
        assert validate_intro_min_duration(300) == 300.0
        assert validate_intro_min_duration(0.01) == 0.01

    def test_validate_rejects_non_numeric_and_bool(self):
        with pytest.raises(ValueError):
            validate_intro_min_duration("20")
        with pytest.raises(ValueError):
            validate_intro_min_duration(True)


class TestProfileThresholdEndpoint:
    @pytest.mark.asyncio
    async def test_get_returns_default(self, db):
        from app.routers.profiles import get_current_intro_min_duration
        resp = await get_current_intro_min_duration()
        assert resp["intro_min_duration_seconds"] == 20.0

    @pytest.mark.asyncio
    async def test_patch_updates_and_get_reflects_it(self, db):
        from app.routers.profiles import (
            UpdateIntroMinDurationRequest,
            get_current_intro_min_duration,
            update_current_intro_min_duration,
        )
        resp = await update_current_intro_min_duration(
            UpdateIntroMinDurationRequest(intro_min_duration_seconds=45.0)
        )
        assert resp["intro_min_duration_seconds"] == 45.0
        assert (await get_current_intro_min_duration())["intro_min_duration_seconds"] == 45.0

    @pytest.mark.asyncio
    async def test_patch_rejects_out_of_range(self, db):
        from fastapi import HTTPException
        from app.routers.profiles import (
            UpdateIntroMinDurationRequest,
            update_current_intro_min_duration,
        )
        with pytest.raises(HTTPException) as exc:
            await update_current_intro_min_duration(
                UpdateIntroMinDurationRequest(intro_min_duration_seconds=0)
            )
        assert exc.value.status_code == 400

        with pytest.raises(HTTPException) as exc:
            await update_current_intro_min_duration(
                UpdateIntroMinDurationRequest(intro_min_duration_seconds=301)
            )
        assert exc.value.status_code == 400


# ===========================================================================
# 3. Migration v041
# ===========================================================================

class TestMigrationV041:
    def test_fresh_db_has_column_with_default(self, db):
        conn = _connect(db)
        row = conn.execute(
            "SELECT intro_min_duration_seconds FROM user_settings WHERE id = 1"
        ).fetchone()
        assert row["intro_min_duration_seconds"] == 20.0
        conn.close()

    def test_runner_applies_v041_to_a_below_head_db(self, tmp_path):
        db_path = tmp_path / "legacy.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute("""
            CREATE TABLE user_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                settings_json TEXT NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("INSERT INTO user_settings (id) VALUES (1)")
        conn.execute("PRAGMA user_version = 40")
        conn.commit()

        from app.migrations.profile_db import RUNNER
        applied = RUNNER.run(conn, "sqlite")
        assert any(m.version == 41 for m in applied)

        cols = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        assert "intro_min_duration_seconds" in cols
        row = conn.execute("SELECT intro_min_duration_seconds FROM user_settings WHERE id = 1").fetchone()
        assert row[0] == 20.0
        # A below-v041 DB run through the full registry also picks up v042 (T6630,
        # text_overlays regions) -- a genuine no-op here since this fixture has no
        # working_videos table, but the runner still advances user_version past it.
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 42
        conn.close()

    def test_idempotent_rerun(self, tmp_path):
        db_path = tmp_path / "legacy2.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "CREATE TABLE user_settings (id INTEGER PRIMARY KEY CHECK (id=1), "
            "settings_json TEXT NOT NULL DEFAULT '{}')"
        )
        conn.execute("INSERT INTO user_settings (id) VALUES (1)")
        conn.commit()

        from app.migrations.profile_db.v041_intro_min_duration import V041IntroMinDuration
        m = V041IntroMinDuration()
        m.up(conn)
        m.up(conn)  # must not raise
        conn.commit()
        cols = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        assert "intro_min_duration_seconds" in cols
        conn.close()

    def test_v041_is_still_the_free_version(self):
        """Guards against a future duplicate-version regression (the runner
        silently skips a duplicate). If this fails, someone added another v041."""
        from app.migrations.profile_db import MIGRATIONS
        versions = [m.version for m in MIGRATIONS]
        assert versions.count(41) == 1
        assert versions == sorted(versions)


# ===========================================================================
# 4. Re-export carries the attachment forward (THE important regression test)
# ===========================================================================

class TestReExportCarriesIntroCardId:
    def _seed(self, db_path, intro_card_id):
        from tests.test_t4010_reexport_in_place import _seed_project_with_final
        project_id, wv, fv = _seed_project_with_final(db_path, final_filename="old_final.mp4")
        conn = _connect(db_path)
        conn.execute("UPDATE final_videos SET intro_card_id = ? WHERE id = ?", (intro_card_id, fv))
        conn.commit()
        conn.close()
        return project_id, fv

    def _row_intro(self, db_path, final_id):
        conn = _connect(db_path)
        row = conn.execute(
            "SELECT intro_card_id FROM final_videos WHERE id = ?", (final_id,)
        ).fetchone()
        conn.close()
        return row["intro_card_id"] if row else None

    def test_explicit_id_survives_reexport(self, db):
        from app.routers.export import overlay
        card_id = _seed_card(db, "Hero")
        project_id, fv = self._seed(db, card_id)

        with patch.object(overlay, "delete_from_r2", return_value=True), \
             patch("app.services.sharing_db.filename_has_active_share", return_value=False), \
             patch("app.analytics.record_milestone"):
            new_fid, *_ = overlay._finalize_overlay_export(project_id, "new.mp4", "exp-t5215-a", USER_ID)

        assert new_fid != fv, "a genuinely new version row must have been created"
        assert self._row_intro(db, new_fid) == card_id

    def test_zero_no_intro_survives_reexport(self, db):
        from app.routers.export import overlay
        project_id, fv = self._seed(db, 0)
        with patch.object(overlay, "delete_from_r2", return_value=True), \
             patch("app.services.sharing_db.filename_has_active_share", return_value=False), \
             patch("app.analytics.record_milestone"):
            new_fid, *_ = overlay._finalize_overlay_export(project_id, "new.mp4", "exp-t5215-b", USER_ID)
        assert self._row_intro(db, new_fid) == 0

    def test_null_inherit_survives_reexport(self, db):
        from app.routers.export import overlay
        project_id, fv = self._seed(db, None)
        with patch.object(overlay, "delete_from_r2", return_value=True), \
             patch("app.services.sharing_db.filename_has_active_share", return_value=False), \
             patch("app.analytics.record_milestone"):
            new_fid, *_ = overlay._finalize_overlay_export(project_id, "new.mp4", "exp-t5215-c", USER_ID)
        assert self._row_intro(db, new_fid) is None

    def test_carries_forward_even_when_prior_is_kept_for_active_share(self, db):
        from app.routers.export import overlay
        card_id = _seed_card(db, "Hero")
        project_id, fv = self._seed(db, card_id)
        with patch.object(overlay, "delete_from_r2") as mock_del, \
             patch("app.services.sharing_db.filename_has_active_share", return_value=True), \
             patch("app.analytics.record_milestone"):
            new_fid, *_ = overlay._finalize_overlay_export(project_id, "new.mp4", "exp-t5215-d", USER_ID)
        mock_del.assert_not_called()
        assert self._row_intro(db, new_fid) == card_id

    def test_first_export_has_no_prior_defaults_to_null(self, db):
        """A first-ever export (no prior final_videos row) has nothing to carry
        -- the new row is NULL (inherit-the-default), never a crash."""
        from app.routers.export import overlay
        conn = _connect(db)
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Fresh', '9:16')")
        project_id = cur.lastrowid
        conn.commit()
        conn.close()

        with patch.object(overlay, "delete_from_r2") as mock_del, \
             patch("app.services.sharing_db.filename_has_active_share", return_value=False), \
             patch("app.analytics.record_milestone"):
            new_fid, *_ = overlay._finalize_overlay_export(project_id, "first.mp4", "exp-t5215-e", USER_ID)

        mock_del.assert_not_called()
        assert self._row_intro(db, new_fid) is None


@pytest.mark.asyncio
async def test_export_final_endpoint_carries_intro_card_id(tmp_path):
    """Writer #2 (`export_final`, POST /api/export/final) also carries the
    attachment forward -- through the REAL HTTP endpoint (catches wiring bugs
    a pure unit test of the SQL alone would miss). Reuses the T4110 durable-
    export harness."""
    from tests.test_t4050_durable_sync import FakeR2, _r2_patched, _request_context, USER_ID as U, PROFILE_ID as P, HEADERS
    from tests.test_t4050_publish_restore_roundtrip import _seed_published_reel

    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         _r2_patched(fake):
        from app.main import app
        from app.database import ensure_database, get_database_path, set_local_db_version

        with _request_context():
            ensure_database()
            db_path = get_database_path()
            set_local_db_version(U, P, 0)

        project_id, final_video_id = _seed_published_reel(db_path)
        card_id = _seed_card(db_path, "Hero")
        conn = _connect(db_path)
        conn.execute(
            "UPDATE final_videos SET intro_card_id = ? WHERE id = ?", (card_id, final_video_id)
        )
        conn.commit()
        conn.close()

        import httpx
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver", headers=HEADERS,
        ) as c:
            resp = await c.post(
                "/api/export/final",
                data={"project_id": str(project_id), "overlay_data": "{}"},
                files={"video": ("final.mp4", io.BytesIO(b"fake-mp4-bytes"), "video/mp4")},
            )
        assert resp.status_code == 200, resp.text

        conn = _connect(db_path)
        new_fid = conn.execute(
            "SELECT final_video_id FROM projects WHERE id = ?", (project_id,)
        ).fetchone()["final_video_id"]
        intro = conn.execute(
            "SELECT intro_card_id FROM final_videos WHERE id = ?", (new_fid,)
        ).fetchone()["intro_card_id"]
        conn.close()

        assert new_fid != final_video_id
        assert intro == card_id


# ===========================================================================
# 5. Cross-profile move: the ONE writer that must NOT carry the attachment
# ===========================================================================

class TestMoveToProfileDoesNotCarryIntro:
    def test_intro_card_id_not_in_carry_columns(self):
        from app.routers.downloads import _MOVED_REEL_CARRY_COLUMNS
        assert "intro_card_id" not in _MOVED_REEL_CARRY_COLUMNS

    def test_build_moved_reel_row_omits_intro_card_id(self):
        from app.routers.downloads import _build_moved_reel_row

        src_row = {
            "filename": "f.mp4", "version": 1, "duration": 10.0,
            "source_type": "custom_project", "name": "Reel", "rating_counts": None,
            "created_at": "2026-01-01", "aspect_ratio": "9:16", "tags": None,
            "clip_count": 1, "quality_score": None, "clip_start_time": None,
            "clip_game_start_time": None, "poster_filename": None,
            "game_ids": None, "game_id": None, "published_at": "2026-01-01",
            "rating": None,
        }
        row = _build_moved_reel_row(src_row, {})
        assert "intro_card_id" not in row


# ===========================================================================
# 6. Reel PATCH: consent gate, dangling id, surgical write
# ===========================================================================

class TestSetDownloadIntro:
    @pytest.mark.asyncio
    async def test_blocked_without_consent(self, db):
        from fastapi import HTTPException
        from app.routers.downloads import IntroAttachRequest, set_download_intro
        card_id = _seed_card(db, "Hero")
        _project_id, fv = _seed_published_final(db)

        with pytest.raises(HTTPException) as exc:
            await set_download_intro(fv, IntroAttachRequest(intro_card_id=card_id))
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_allowed_after_consent(self, db):
        from app.routers.downloads import IntroAttachRequest, set_download_intro
        from app.services.user_db import set_intro_consent
        set_intro_consent(USER_ID, PROFILE_ID, "2026-08-06T00:00:00Z")

        card_id = _seed_card(db, "Hero")
        _project_id, fv = _seed_published_final(db)

        resp = await set_download_intro(fv, IntroAttachRequest(intro_card_id=card_id))
        assert resp["success"] is True
        conn = _connect(db)
        row = conn.execute("SELECT intro_card_id FROM final_videos WHERE id = ?", (fv,)).fetchone()
        conn.close()
        assert row["intro_card_id"] == card_id

    @pytest.mark.asyncio
    async def test_detach_to_zero_always_allowed_without_consent(self, db):
        from app.routers.downloads import IntroAttachRequest, set_download_intro
        _project_id, fv = _seed_published_final(db)
        resp = await set_download_intro(fv, IntroAttachRequest(intro_card_id=0))
        assert resp["success"] is True

    @pytest.mark.asyncio
    async def test_clear_to_null_always_allowed_without_consent(self, db):
        from app.routers.downloads import IntroAttachRequest, set_download_intro
        card_id = _seed_card(db, "Hero")
        _project_id, fv = _seed_published_final(db, intro_card_id=card_id)
        resp = await set_download_intro(fv, IntroAttachRequest(intro_card_id=None))
        assert resp["success"] is True
        conn = _connect(db)
        row = conn.execute("SELECT intro_card_id FROM final_videos WHERE id = ?", (fv,)).fetchone()
        conn.close()
        assert row["intro_card_id"] is None

    @pytest.mark.asyncio
    async def test_dangling_id_rejected_404_never_persisted(self, db):
        """A gesture that names a card id that doesn't exist in THIS profile is
        REJECTED (404), not silently persisted -- a dangling id must never be
        written by a gesture (only by cascading a card delete elsewhere)."""
        from fastapi import HTTPException
        from app.routers.downloads import IntroAttachRequest, set_download_intro
        from app.services.user_db import set_intro_consent
        set_intro_consent(USER_ID, PROFILE_ID, "2026-08-06T00:00:00Z")

        _project_id, fv = _seed_published_final(db)
        with pytest.raises(HTTPException) as exc:
            await set_download_intro(fv, IntroAttachRequest(intro_card_id=99999))
        assert exc.value.status_code == 404

        conn = _connect(db)
        row = conn.execute("SELECT intro_card_id FROM final_videos WHERE id = ?", (fv,)).fetchone()
        conn.close()
        assert row["intro_card_id"] is None, "the dangling id must never reach the row"

    @pytest.mark.asyncio
    async def test_unpublished_download_id_404s(self, db):
        from fastapi import HTTPException
        from app.routers.downloads import IntroAttachRequest, set_download_intro
        with pytest.raises(HTTPException) as exc:
            await set_download_intro(999999, IntroAttachRequest(intro_card_id=None))
        assert exc.value.status_code == 404


# ===========================================================================
# 7. Collection freeze survives a later default change (serve-time, no PG)
# ===========================================================================

class TestCollectionIntroFreeze:
    def test_canonical_definition_includes_concrete_intro_id(self):
        from app.routers.collections import CollectionDefinition, _canonical_definition
        d = CollectionDefinition(scope={"type": "all"}, aspect_ratio="9:16")
        out = _canonical_definition(d, "Top Plays - Portrait", intro_card_id=7)
        assert out["intro_card_id"] == 7

        out_zero = _canonical_definition(d, "Top Plays - Portrait", intro_card_id=0)
        assert out_zero["intro_card_id"] == 0

    def test_resolve_frozen_concrete_id_survives_default_change(self, db):
        """The design's core promise: a share frozen with an explicit concrete
        id keeps resolving to THAT card even after the profile default moves
        to a different card."""
        from app.routers.collections import resolve_collection_share

        card_a = _seed_card(db, "A", is_default=1)
        card_b = _seed_card(db, "B", is_default=0)

        share = {
            "sharer_user_id": USER_ID,
            "sharer_profile_id": PROFILE_ID,
            "share_token": "tok-1",
            "collection_definition": {
                "scope": {"type": "all"}, "filter": {}, "aspect_ratio": "9:16",
                "title": "Top Plays", "intro_card_id": card_a,
            },
        }

        with patch("app.routers.collections.open_profile_db_readonly",
                   side_effect=lambda uid, pid: _connect(db)), \
             patch("app.routers.collections.evaluate_collection_members", return_value=[]):
            result_before = resolve_collection_share(share)
        assert result_before["intro_card_id"] == card_a

        # Flip the default to card_b -- the frozen share must NOT move.
        conn = _connect(db)
        conn.execute("UPDATE intro_cards SET is_default = 0 WHERE id = ?", (card_a,))
        conn.execute("UPDATE intro_cards SET is_default = 1 WHERE id = ?", (card_b,))
        conn.commit()
        conn.close()

        with patch("app.routers.collections.open_profile_db_readonly",
                   side_effect=lambda uid, pid: _connect(db)), \
             patch("app.routers.collections.evaluate_collection_members", return_value=[]):
            result_after = resolve_collection_share(share)
        assert result_after["intro_card_id"] == card_a, \
            "changing the profile default must NOT retroactively move a frozen share"

    def test_deleted_card_degrades_to_no_intro(self, db):
        from app.routers.collections import resolve_collection_share

        card_id = _seed_card(db, "Gone")
        conn = _connect(db)
        conn.execute("DELETE FROM intro_cards WHERE id = ?", (card_id,))
        conn.commit()
        conn.close()

        share = {
            "sharer_user_id": USER_ID, "sharer_profile_id": PROFILE_ID,
            "share_token": "tok-2",
            "collection_definition": {
                "scope": {"type": "all"}, "filter": {}, "aspect_ratio": "9:16",
                "title": "Top Plays", "intro_card_id": card_id,
            },
        }
        with patch("app.routers.collections.open_profile_db_readonly",
                   side_effect=lambda uid, pid: _connect(db)), \
             patch("app.routers.collections.evaluate_collection_members", return_value=[]):
            result = resolve_collection_share(share)
        assert "intro_card_id" not in result

    def test_legacy_share_missing_key_resolves_to_no_intro(self, db):
        """A share frozen BEFORE this field existed has no `intro_card_id` key
        at all -- must resolve to no intro quietly, never a warning storm and
        never an invented attachment."""
        from app.routers.collections import resolve_collection_share

        share = {
            "sharer_user_id": USER_ID, "sharer_profile_id": PROFILE_ID,
            "share_token": "tok-3",
            "collection_definition": {
                "scope": {"type": "all"}, "filter": {}, "aspect_ratio": "9:16",
                "title": "Top Plays",
            },
        }
        with patch("app.routers.collections.open_profile_db_readonly",
                   side_effect=lambda uid, pid: _connect(db)), \
             patch("app.routers.collections.evaluate_collection_members", return_value=[]):
            result = resolve_collection_share(share)
        assert "intro_card_id" not in result

    def test_collection_freeze_is_never_duration_gated(self, db):
        """A collection has no single 'duration' -- the frozen concrete value
        (never NULL) makes the duration-gate branch structurally unreachable
        here, so even a 1-second-equivalent scenario still resolves."""
        from app.routers.collections import resolve_collection_share

        card_id = _seed_card(db, "Short-lived-ok", is_default=1)
        # threshold absurdly high -- would block a NULL/inherit reel resolution,
        # but must NOT block this frozen, concrete, non-NULL collection value.
        conn = _connect(db)
        conn.execute("UPDATE user_settings SET intro_min_duration_seconds = 300 WHERE id = 1")
        conn.commit()
        conn.close()

        share = {
            "sharer_user_id": USER_ID, "sharer_profile_id": PROFILE_ID,
            "share_token": "tok-4",
            "collection_definition": {
                "scope": {"type": "all"}, "filter": {}, "aspect_ratio": "9:16",
                "title": "Top Plays", "intro_card_id": card_id,
            },
        }
        with patch("app.routers.collections.open_profile_db_readonly",
                   side_effect=lambda uid, pid: _connect(db)), \
             patch("app.routers.collections.evaluate_collection_members", return_value=[]):
            result = resolve_collection_share(share)
        assert result["intro_card_id"] == card_id


def test_collection_share_create_freezes_default_at_creation_time(pg_conn, tmp_path):
    """End-to-end (Postgres + TestClient): sharing with NO explicit intro pick
    ('use my default') freezes the CURRENT default's concrete id, and a later
    default change does not retroactively move the already-created link."""
    import json

    from fastapi.testclient import TestClient

    from app.services.auth_db import create_user
    from app.services.sharing_db import get_collection_share_by_token
    from app.session_init import _init_cache
    from tests.test_collection_shares import (
        GAME_DEF, SHARER_EMAIL, SHARER_ID, PROFILE_ID as SHARER_PROFILE_ID,
        _create, _seed_sharer_reels,
    )

    create_user(SHARER_ID, email=SHARER_EMAIL)
    _init_cache[SHARER_ID] = {"profile_id": SHARER_PROFILE_ID, "is_new_user": False}

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False), \
         patch("app.routers.collections.generate_presigned_url_global",
               side_effect=lambda key, **kw: f"https://r2.example/{key}"):
        from app.database import get_database_path
        from app.main import app

        client = TestClient(app, raise_server_exceptions=True)

        _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 20.0}])

        conn = sqlite3.connect(str(get_database_path()))
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO intro_cards (name, shown_fields, treatment, is_default) "
            "VALUES ('A', '[]', 'gold', 1)"
        )
        card_a = cur.lastrowid
        cur.execute(
            "INSERT INTO intro_cards (name, shown_fields, treatment, is_default) "
            "VALUES ('B', '[]', 'gold', 0)"
        )
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()

        resp = _create(client, GAME_DEF, is_public=True)
        assert resp.status_code == 200, resp.text
        token = resp.json()["shares"][0]["share_token"]

        share = get_collection_share_by_token(token)
        definition = share["collection_definition"]
        if isinstance(definition, str):
            definition = json.loads(definition)
        assert definition["intro_card_id"] == card_a

        # Flip the default -- the STORED definition must not change.
        conn = sqlite3.connect(str(get_database_path()))
        conn.execute("UPDATE intro_cards SET is_default = 0 WHERE id = ?", (card_a,))
        conn.execute(
            "UPDATE intro_cards SET is_default = 1 WHERE name = 'B'"
        )
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()

        share_again = get_collection_share_by_token(token)
        definition_again = share_again["collection_definition"]
        if isinstance(definition_again, str):
            definition_again = json.loads(definition_again)
        assert definition_again["intro_card_id"] == card_a


# ===========================================================================
# 8. GET /api/downloads: no per-tile N+1
# ===========================================================================

class TestListDownloadsNoN1:
    @pytest.mark.asyncio
    async def test_query_count_flat_as_reel_count_grows(self, db, query_counter):
        from app.routers.downloads import list_downloads

        _seed_card(db, "Default Card", is_default=1)
        _seed_published_final(db, intro_card_id=None, duration=30.0)

        before = len(query_counter.statements)
        await list_downloads()
        delta_one = len(query_counter.statements) - before

        for _ in range(20):
            _seed_published_final(db, intro_card_id=None, duration=30.0)

        before2 = len(query_counter.statements)
        await list_downloads()
        delta_many = len(query_counter.statements) - before2

        assert delta_many == delta_one, (
            f"query count grew with row count ({delta_one} -> {delta_many}); "
            "intro resolution must batch-load, not query per tile"
        )

    @pytest.mark.asyncio
    async def test_resolved_name_accounts_for_duration_gate(self, db):
        from app.routers.downloads import list_downloads

        _seed_card(db, "Default Card", is_default=1)
        # short reel inheriting the default -> no intro will play
        _project_short, fv_short = _seed_published_final(db, intro_card_id=None, duration=5.0)
        # long reel inheriting the default -> the default plays
        _project_long, fv_long = _seed_published_final(db, intro_card_id=None, duration=30.0)

        resp = await list_downloads()
        by_id = {d.id: d for d in resp.downloads}

        assert by_id[fv_short].intro_card_id is None  # raw stored value
        assert by_id[fv_short].intro_card_name is None  # nothing will play

        assert by_id[fv_long].intro_card_id is None  # raw stored value (still NULL)
        assert by_id[fv_long].intro_card_name == "Default Card"  # resolves to the default

    @pytest.mark.asyncio
    async def test_dangling_stored_id_shows_no_intro_name(self, db):
        from app.routers.downloads import list_downloads

        card_id = _seed_card(db, "Temp")
        _project_id, fv = _seed_published_final(db, intro_card_id=card_id, duration=30.0)
        conn = _connect(db)
        conn.execute("DELETE FROM intro_cards WHERE id = ?", (card_id,))
        conn.commit()
        conn.close()

        resp = await list_downloads()
        item = next(d for d in resp.downloads if d.id == fv)
        assert item.intro_card_id == card_id  # raw value still stored
        assert item.intro_card_name is None    # but nothing resolves/plays
