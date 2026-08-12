"""
T5215 -- Intro attachment: resolution helper, reel PATCH, re-export
carry-forward, cross-profile move (no carry), collection freeze, consent gate,
no-N+1 list. The v041 threshold-storage/migration tests that used to live here
were removed by T6850 (dead setting deleted; see test_t6850_drop_intro_min_
duration.py for its v043 drop-column migration coverage instead).

Design: docs/plans/tasks/T5215-design.md. Acceptance criteria mapping:
  resolve_intro_card_id matrix (NULL/0/id) ................... TestResolveIntroCardIdMatrixT6680NoInherit
  re-export preserves attachment (THE important test) ........ TestReExportCarriesIntroCardId,
                                                                 test_export_final_endpoint_carries_intro_card_id
  cross-profile move never carries the attachment ............ TestMoveToProfileDoesNotCarryIntro
  reel PATCH: consent gate, dangling id, surgical write ....... TestSetDownloadIntro
  collection freeze survives a later default change ........... TestCollectionIntroFreeze
  GET /api/downloads has no per-tile N+1 ...................... TestListDownloadsNoN1
"""

import io
import sqlite3
from unittest.mock import patch

import pytest

from app.services.intro_cards import resolve_intro_card_id

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

# ===========================================================================
# T6680 -- the default/inherit concept is REMOVED (design v2, approved
# 2026-08-09). This class REPLACES the pre-T6680 `TestResolveIntroCardIdMatrix`
# (which asserted `NULL` inherited a profile default above a duration
# threshold via a 4-arg signature) -- that behavior no longer exists, so the
# old assertions were deleted rather than left alongside contradictory new
# ones. `resolve_intro_card_id` loses the `default_id` / `reel_duration` /
# `min_duration` inherit params entirely (Decision 4): the new signature is
# `resolve_intro_card_id(intro_card_id)` -> `0/NULL -> None`,
# `<positive> -> that id`.
# ===========================================================================

class TestResolveIntroCardIdMatrixT6680NoInherit:
    def test_zero_always_none(self):
        assert resolve_intro_card_id(0) is None

    def test_positive_id_always_wins(self):
        """Explicit attach is unchanged -- still consent-gated at the attach
        gesture, never at resolution."""
        assert resolve_intro_card_id(7) == 7

    def test_null_is_now_no_intro_not_inherit(self):
        """The direct hole-closure assertion: NULL no longer reads any
        default -- it resolves to None unconditionally, even when a default
        row exists and the reel is long (previously: inherits)."""
        assert resolve_intro_card_id(None) is None

    def test_signature_no_longer_accepts_inherit_params(self):
        """Decision 4: default_id/reel_duration/min_duration are DROPPED from
        the signature (not just ignored) -- a caller passing them is a signal
        the old call site was never updated. This call is expected to raise
        TypeError against the OLD (T5215) signature; it must succeed with
        exactly one positional arg once T6680 lands."""
        import inspect
        sig = inspect.signature(resolve_intro_card_id)
        params = list(sig.parameters)
        assert "default_id" not in params, (
            "resolve_intro_card_id must no longer accept default_id -- the "
            "inherit branch (and its parameter) must be removed, not just "
            "dead-branched"
        )
        assert "min_duration" not in params, (
            "resolve_intro_card_id must no longer accept min_duration -- the "
            "duration gate governed only the removed inherit path"
        )


# ===========================================================================
# 2. Re-export carries the attachment forward (THE important regression test)
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
# 3. Cross-profile move: the ONE writer that must NOT carry the attachment
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
# 4. Reel PATCH: consent gate, dangling id, surgical write
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
# 5. Collection freeze survives a later default change (serve-time, no PG)
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
        """A collection has no single 'duration' and (T6680) there is no
        duration gate left at all -- a frozen, concrete, non-NULL collection
        attachment always resolves."""
        from app.routers.collections import resolve_collection_share

        card_id = _seed_card(db, "Short-lived-ok", is_default=1)

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


def test_collection_share_create_freezes_zero_regardless_of_later_default_changes(pg_conn, tmp_path):
    """T6680 inversion of the pre-T6680 test of the same shape (this test used to
    assert the OLD behavior: sharing with no explicit intro pick froze the
    CURRENT default's concrete id). Decision 1/2 removed the default concept
    entirely, so 'no explicit pick' now freezes `0` (no intro) -- there is no
    default left to read. This test's remaining value is the second half:
    `is_default` churn on the intro_cards table (legacy column, still written
    by other flows/migrations) must never retroactively move an already-frozen
    link, since resolution no longer reads that column at all."""
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
        assert definition["intro_card_id"] == 0, (
            "picked None must freeze 0 (no intro), never a default id"
        )

        # Flip `is_default` on the legacy column -- the STORED definition must
        # still not change, since resolution never reads `is_default`.
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
        assert definition_again["intro_card_id"] == 0


def test_collection_share_create_t6680_none_freezes_zero_never_calls_get_default(pg_conn, tmp_path):
    """T6680 direct inversion of test_collection_share_create_freezes_zero_regardless_of_later_default_changes
    above: sharing with NO explicit intro pick (`intro_card_id=None`) must now
    freeze `0` (no intro), and `get_default_intro_card` must NEVER be called --
    collections.py:1093's 'picked None -> freeze default' branch is removed.
    Profile HAS a default row (v040-backfilled state) to prove it is not read.

    RED against current behavior: the current freeze branch calls
    `get_default_intro_card` and freezes `card_a`, not `0`.

    `get_default_intro_card` is asserted gone as an IMPORT in
    `app.routers.collections` (not merely un-called): T6680 Decision 4 deletes
    the function entirely rather than leaving it unread, so there is no symbol
    left to mock -- `hasattr` is the strongest available proof, matching the
    design's "security auditability: grep shows zero live callers" rationale."""
    import json

    from fastapi.testclient import TestClient

    from app.services.auth_db import create_user
    from app.services.sharing_db import get_collection_share_by_token
    from app.session_init import _init_cache
    from tests.test_collection_shares import (
        GAME_DEF,
        SHARER_EMAIL,
        SHARER_ID,
        _create,
        _seed_sharer_reels,
    )
    from tests.test_collection_shares import (
        PROFILE_ID as SHARER_PROFILE_ID,
    )

    create_user(SHARER_ID, email=SHARER_EMAIL)
    _init_cache[SHARER_ID] = {"profile_id": SHARER_PROFILE_ID, "is_new_user": False}

    import app.routers.collections as collections_router
    assert not hasattr(collections_router, "get_default_intro_card"), (
        "get_default_intro_card must be fully removed from collections.py, "
        "not just unused -- Decision 4 deletes the function, not just the call"
    )

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
        assert definition["intro_card_id"] == 0, (
            "picked None must freeze 0 (no intro), never a default id"
        )


# ===========================================================================
# 6. GET /api/downloads: no per-tile N+1
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

    @pytest.mark.asyncio
    async def test_null_no_longer_inherits_default_in_download_list(self, db):
        """T6680 direct hole-closure test for the site v1's design missed
        (downloads.py:337-345,577 batch-loads `is_default` directly, NOT via
        `resolve_intro_card`). Profile HAS cards including an `is_default=1`
        row (simulating the v040-backfilled state). A NULL-attachment reel
        must show no intro name at EVERY duration -- short AND above the old
        20s inherit threshold -- because there is no inherit left, not
        because it was gated by length.

        RED against the current resolver: the long reel currently resolves
        to "Default Card" (see test_resolved_name_accounts_for_duration_gate
        above, which this test directly inverts)."""
        from app.routers.downloads import list_downloads

        _seed_card(db, "Default Card", is_default=1)
        _project_short, fv_short = _seed_published_final(db, intro_card_id=None, duration=5.0)
        _project_long, fv_long = _seed_published_final(db, intro_card_id=None, duration=30.0)

        resp = await list_downloads()
        by_id = {d.id: d for d in resp.downloads}

        assert by_id[fv_short].intro_card_id is None
        assert by_id[fv_short].intro_card_name is None

        assert by_id[fv_long].intro_card_id is None  # raw stored value
        assert by_id[fv_long].intro_card_name is None, (
            "a NULL attachment must resolve to no intro at every duration -- "
            "there is no default left to inherit"
        )


# ===========================================================================
# T6680 -- NULL no longer inherits at the cross-DB egress choke point
# (`resolve_intro_card`, `services/intro_cards.py:303-339`), which
# `intro_egress.resolve_intro_for_reel` delegates to for owner download burn,
# single-reel share playback/burn, and the reel share page. Exercising
# `resolve_intro_card` directly covers all of those without R2/network mocks,
# per the design's "ONE seam" note (T5220).
# ===========================================================================

class TestResolveIntroCardT6680NoInheritAtEgress:
    def test_null_no_intro_short_reel(self, db):
        """Profile HAS cards including an is_default row; short reel; NULL
        attachment -- already no-intro under the old inherit gate too, kept
        as a baseline (must still be None after the change)."""
        from app.services.intro_cards import resolve_intro_card
        _seed_card(db, "Default Card", is_default=1)
        conn = _connect(db)
        result = resolve_intro_card(None, 5.0, conn, reel_id=1)
        conn.close()
        assert result is None

    def test_null_no_intro_long_reel_above_old_threshold(self, db):
        """The direct hole-closure case: a LONG reel (above the old 20s
        inherit threshold) with NULL attachment on a profile that HAS an
        is_default row must resolve to no intro. RED against the current
        resolver, which returns the default row here."""
        from app.services.intro_cards import resolve_intro_card
        _seed_card(db, "Default Card", is_default=1)
        conn = _connect(db)
        result = resolve_intro_card(None, 30.0, conn, reel_id=1)
        conn.close()
        assert result is None, (
            "NULL must resolve to no intro even for a long reel on a "
            "profile with a default row -- there is no inherit left"
        )

    def test_zero_no_intro_unchanged(self, db):
        from app.services.intro_cards import resolve_intro_card
        _seed_card(db, "Default Card", is_default=1)
        conn = _connect(db)
        result = resolve_intro_card(0, 30.0, conn, reel_id=1)
        conn.close()
        assert result is None

    def test_positive_id_resolves_to_that_card_unchanged(self, db):
        """Explicit attach is untouched -- still consent-gated at the attach
        gesture (TestSetDownloadIntro above), never at resolution."""
        from app.services.intro_cards import resolve_intro_card
        card_id = _seed_card(db, "Hero", is_default=0)
        conn = _connect(db)
        result = resolve_intro_card(card_id, 5.0, conn, reel_id=1)
        conn.close()
        assert result is not None
        assert result["id"] == card_id

    def test_unconsented_profile_with_cards_never_serves_an_unattached_card(self, db):
        """T6680's replacement for a would-be new egress gate (Decision 1):
        for a profile that has NOT consented (no `set_intro_consent` call)
        and HAS cards (incl. an is_default row from the v040 backfill), every
        NULL-attachment reel at every egress path resolves to no intro --
        there is no inherit left to expose, so no card belonging to this
        profile is ever served without having passed the attach-time consent
        gate."""
        from app.services.intro_cards import resolve_intro_card
        from app.services.user_db import get_intro_consent
        assert get_intro_consent(USER_ID, PROFILE_ID) is None  # precondition: unconsented

        _seed_card(db, "Default Card", is_default=1)
        conn = _connect(db)
        for duration in (5.0, 30.0, 300.0):
            result = resolve_intro_card(None, duration, conn, reel_id=1)
            assert result is None, (
                f"unconsented profile leaked an intro at duration={duration}"
            )
        conn.close()


# ===========================================================================
# T6680 -- `is_default` retirement (Decision 4 / OQ5). No auto-default on
# create, no set-default endpoint, no default-promotion on delete.
# ===========================================================================

class TestIsDefaultRetirementT6680:
    @pytest.mark.asyncio
    async def test_first_card_created_does_not_set_is_default(self, db):
        """RED against current behavior: intro_cards.py:249-252 sets
        is_default=1 for the first card in a profile. After T6680, creating a
        card never touches is_default -- there is nothing left that reads it
        for resolution, so writing it is dead code that must be removed, not
        just unread."""
        from app.routers.intro_cards import CreateIntroCardRequest, create_intro_card
        from app.services.user_db import set_intro_consent
        set_intro_consent(USER_ID, PROFILE_ID, "2026-08-09T00:00:00Z")

        created = await create_intro_card(
            CreateIntroCardRequest(name="First", shown_fields=[], treatment="gold")
        )

        conn = _connect(db)
        row = conn.execute(
            "SELECT is_default FROM intro_cards WHERE id = ?", (created["id"],)
        ).fetchone()
        conn.close()
        assert not bool(row["is_default"]), (
            "creating the first card in a profile must not set is_default -- "
            "the concept is retired end-to-end"
        )

    @pytest.mark.asyncio
    async def test_set_default_endpoint_no_longer_reachable(self, db):
        """RED against current behavior: POST /{card_id}/default exists and
        succeeds. After T6680 it must be removed (404/410), not merely made a
        no-op -- Decision 4 retires the manual set-default gesture."""
        from fastapi import HTTPException

        card_id = _seed_card(db, "Hero")

        with pytest.raises((HTTPException, AttributeError, ImportError)) as exc:
            from app.routers.intro_cards import set_default_intro_card
            result = await set_default_intro_card(card_id)
            # If the symbol still exists and doesn't raise, fail explicitly --
            # the endpoint must be gone, not just behaviorally inert.
            pytest.fail(
                f"set_default_intro_card must no longer exist/succeed, got: {result!r}"
            )
        if isinstance(exc.value, HTTPException):
            assert exc.value.status_code in (404, 410)

    def test_is_default_dropped_from_load_profile_cards_projection(self, db):
        """Decision 2/4: load_profile_cards' batch projection stops reading
        is_default (the download-list N+1-avoidance map no longer needs it,
        since nothing resolves via it anymore)."""
        from app.services.intro_cards import load_profile_cards
        card_id = _seed_card(db, "Hero", is_default=1)
        conn = _connect(db)
        cards = load_profile_cards(conn.cursor())
        conn.close()
        assert "is_default" not in cards[card_id], (
            "load_profile_cards must drop is_default from its projection -- "
            "it is dead data now that nothing resolves via it"
        )
