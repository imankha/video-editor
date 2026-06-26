"""
T4010 — Atomic Re-Export-In-Place for Published Reels (No Lost Final-Video References).

These tests lock in the invariant that a re-export NEVER nulls a live pointer
speculatively, that a FAILED render leaves working_video_id + final_video_id (and
the final_videos row + its R2 object) exactly as before the job, and that the
post-commit old-R2 cleanup only fires after the new version is committed (and
never deletes the just-written object, nor an object an active share still serves).

Bug class (bug-reproduction skill, prefix `bug-test-`): a re-export that fails or
is in-flight must not lose the published final-video reference.
"""

import sqlite3
from unittest.mock import patch, MagicMock, AsyncMock

import pytest

USER_ID = "t4010-user"
PROFILE_ID = "testdefault"


# ---------------------------------------------------------------------------
# Fixture: canonical profile DB via the real ensure_database()
# ---------------------------------------------------------------------------

@pytest.fixture()
def db(tmp_path):
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_project_with_final(db_path, final_filename="old_final.mp4",
                             working_filename="wv.mp4"):
    """project + working_video + final_video, with project pointing at both.
    Returns (project_id, working_video_id, final_video_id)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
    project_id = cur.lastrowid

    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) "
        "VALUES (?, ?, 1, 5.0)",
        (project_id, working_filename))
    working_video_id = cur.lastrowid

    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel')",
        (project_id, final_filename))
    final_video_id = cur.lastrowid

    # A latest working clip so render_project's clip query returns a valid clip.
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time) "
        "VALUES ('raw.mp4', 4, 0.0, 0.0)")
    raw_clip_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
        "VALUES (?, ?, 1, 0)",
        (project_id, raw_clip_id))

    cur.execute("UPDATE projects SET working_video_id = ?, final_video_id = ? WHERE id = ?",
                (working_video_id, final_video_id, project_id))
    conn.commit()
    conn.close()
    return project_id, working_video_id, final_video_id


def _pointers(db_path, project_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT working_video_id, final_video_id FROM projects WHERE id = ?",
        (project_id,)).fetchone()
    conn.close()
    return row["working_video_id"], row["final_video_id"]


def _final_rows(db_path, project_id):
    conn = _connect(db_path)
    rows = conn.execute(
        "SELECT id, filename, version FROM final_videos WHERE project_id = ? ORDER BY version",
        (project_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ===========================================================================
# Framing render: no speculative null + failure rollback
# ===========================================================================

class TestFramingRenderPreservesPointers:

    @pytest.mark.asyncio
    async def test_render_project_does_not_null_pointers_pre_step(self, db):
        """ROOT CAUSE (framing.py:367): the /render pre-step must NOT null
        working_video_id / final_video_id. The pointers stay valid for the whole
        in-flight export; the success path repoints working_video_id later."""
        from app.routers.export import framing
        from app.routers.export.framing import render_project, RenderRequest

        project_id, wv, fv = _seed_project_with_final(db)

        http_request = MagicMock()
        http_request.headers.get.return_value = ""

        # Isolate the synchronous pre-step: stub out the background render so no
        # real ffmpeg / R2 work runs.
        with patch.object(framing, "_run_render_background", new=AsyncMock()), \
             patch.object(framing.asyncio, "create_task", lambda coro: coro.close()), \
             patch.object(framing.manager, "send_progress", new=AsyncMock()):
            req = RenderRequest(project_id=project_id, export_id="exp-t4010-a")
            await render_project(req, http_request)

        assert _pointers(db, project_id) == (wv, fv), \
            "render_project must leave working_video_id + final_video_id intact"

    @pytest.mark.asyncio
    async def test_failed_render_restores_pointers_and_keeps_final(self, db):
        """If the pipeline advances the working pointer / nulls the final pointer
        and then fails, _run_render_background's failure path must restore both to
        their pre-job values and leave the final_videos row intact."""
        from app.routers.export import framing
        from app.routers.export.framing import _run_render_background

        project_id, wv, fv = _seed_project_with_final(db)

        def _fake_download(user_id, r2_key, dest_path):
            # Produce a real (tiny) file so extraction "succeeds" and we reach
            # the pipeline stage.
            from pathlib import Path
            Path(dest_path).write_bytes(b"\x00\x00")
            return True

        async def _fake_export_clips(**kwargs):
            # Mimic a partial advance: new working video committed + final nulled,
            # then the render blows up.
            from app.database import get_db_connection
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute(
                    "INSERT INTO working_videos (project_id, filename, version) "
                    "VALUES (?, 'new_wv.mp4', 2)", (project_id,))
                new_wv = c.lastrowid
                c.execute(
                    "UPDATE projects SET working_video_id = ?, final_video_id = NULL WHERE id = ?",
                    (new_wv, project_id))
                conn.commit()
            raise RuntimeError("render boom")

        clip = {
            "id": 1, "raw_clip_id": 1, "uploaded_filename": None,
            "crop_data": None, "game_id": None, "raw_filename": "raw.mp4",
            "clip_name": "Goal", "raw_start_time": 0.0, "raw_end_time": 5.0,
            "raw_duration": 5.0, "game_blake3_hash": None, "video_sequence": None,
        }

        with patch.object(framing, "generate_presigned_url", return_value="https://r2/raw"), \
             patch.object(framing, "get_video_info", return_value={"fps": 30.0, "width": 1080, "height": 1920}), \
             patch.object(framing, "download_from_r2", side_effect=_fake_download), \
             patch.object(framing, "_export_clips", side_effect=_fake_export_clips), \
             patch.object(framing.manager, "send_progress", new=AsyncMock()), \
             patch("app.services.export_helpers.sync_export_db_to_r2", return_value=True), \
             patch("app.services.export_helpers.fail_export_job", return_value=None):
            await _run_render_background(
                export_id="exp-t4010-b", project_id=project_id, project_name="Reel",
                aspect_ratio="9:16", clip=clip, segments_raw=None, include_audio=True,
                target_fps=30, export_mode="quality", user_id=USER_ID,
                profile_id=PROFILE_ID, credits_deducted=0, video_seconds=0.0,
                is_test_mode=True)

        assert _pointers(db, project_id) == (wv, fv), \
            "failed render must restore working_video_id + final_video_id to pre-job values"
        rows = _final_rows(db, project_id)
        assert any(r["id"] == fv for r in rows), "the final_videos row must survive a failed render"


# ===========================================================================
# Multi-clip export: no speculative null pre-step
# ===========================================================================

class TestMultiClipPreservesPointers:

    @pytest.mark.asyncio
    async def test_export_multi_clip_does_not_null_pointers_pre_step(self, db):
        """multi_clip.py:1837 pre-step must NOT null the pointers before render."""
        from app.routers.export import multi_clip
        from app.routers.export.multi_clip import export_multi_clip

        project_id, wv, fv = _seed_project_with_final(db)

        http_request = MagicMock()
        http_request.headers.get.return_value = ""

        multi_clip_data = '{"clips": [], "aspectRatio": "9:16", "transition": {"type": "cut", "duration": 0}}'

        # Stub the heavy pipeline so only the pre-step transaction runs. The body
        # raises after the pre-step (no clips), but the pointers must already be intact.
        with patch.object(multi_clip, "_export_clips", new=AsyncMock(side_effect=RuntimeError("stop after pre-step"))), \
             patch.object(multi_clip.manager, "send_progress", new=AsyncMock()):
            try:
                await export_multi_clip(
                    request=http_request, export_id="exp-t4010-c",
                    multi_clip_data_json=multi_clip_data, include_audio="true",
                    target_fps=30, export_mode="fast", project_id=project_id,
                    project_name="Reel")
            except Exception:
                pass

        assert _pointers(db, project_id) == (wv, fv), \
            "export_multi_clip must leave working_video_id + final_video_id intact"


# ===========================================================================
# Overlay finalize: post-commit old-R2 cleanup
# ===========================================================================

class TestOverlayFinalizeCleanup:

    def _seed(self, db_path):
        return _seed_project_with_final(db_path, final_filename="old_final.mp4")

    def test_atomic_swap_deletes_prior_object_only_after_commit(self, db):
        """New version inserted + pointer repointed, THEN the prior R2 object is
        deleted — and only the prior one, never the just-written object."""
        from app.routers.export import overlay

        project_id, wv, fv = self._seed(db)

        seen = {}

        def _capture_delete(user_id, key):
            # Snapshot DB state at delete time to prove the swap already committed.
            conn = _connect(db)
            row = conn.execute(
                "SELECT final_video_id FROM projects WHERE id = ?", (project_id,)).fetchone()
            rows = conn.execute(
                "SELECT filename FROM final_videos WHERE project_id = ?", (project_id,)).fetchall()
            conn.close()
            seen["pointer_at_delete"] = row["final_video_id"]
            seen["filenames_at_delete"] = {r["filename"] for r in rows}
            seen["deleted_key"] = key
            return True

        with patch.object(overlay, "delete_from_r2", side_effect=_capture_delete) as mock_del, \
             patch("app.services.sharing_db.filename_has_active_share", return_value=False), \
             patch("app.analytics.record_milestone"):
            new_fid = overlay._finalize_overlay_export(
                project_id, "new_final.mp4", "exp-t4010-d", USER_ID)

        # pointer repointed to the new version
        assert _pointers(db, project_id)[1] == new_fid
        assert new_fid != fv
        # prior object deleted, new object NOT
        mock_del.assert_called_once_with(USER_ID, "final_videos/old_final.mp4")
        assert seen["deleted_key"] == "final_videos/old_final.mp4"
        # at delete time the swap was already committed
        assert seen["pointer_at_delete"] == new_fid
        assert "new_final.mp4" in seen["filenames_at_delete"]

    def test_active_share_preserves_prior_object_and_row(self, db):
        """If an active (non-revoked) share still serves the prior object, the
        cleanup keeps BOTH the prior R2 object and its row (share stays playable)."""
        from app.routers.export import overlay

        project_id, wv, fv = self._seed(db)

        with patch.object(overlay, "delete_from_r2") as mock_del, \
             patch("app.services.sharing_db.filename_has_active_share", return_value=True), \
             patch("app.analytics.record_milestone"):
            new_fid = overlay._finalize_overlay_export(
                project_id, "new_final.mp4", "exp-t4010-e", USER_ID)

        mock_del.assert_not_called()
        ids = {r["id"] for r in _final_rows(db, project_id)}
        assert fv in ids, "prior shared final_videos row must be kept"
        assert new_fid in ids
        assert _pointers(db, project_id)[1] == new_fid

    def test_cleanup_failure_does_not_roll_back_swap(self, db):
        """A failure deleting the prior R2 object must NOT undo the committed swap."""
        from app.routers.export import overlay

        project_id, wv, fv = self._seed(db)

        with patch.object(overlay, "delete_from_r2", side_effect=RuntimeError("R2 down")), \
             patch("app.services.sharing_db.filename_has_active_share", return_value=False), \
             patch("app.analytics.record_milestone"):
            new_fid = overlay._finalize_overlay_export(
                project_id, "new_final.mp4", "exp-t4010-f", USER_ID)

        assert _pointers(db, project_id)[1] == new_fid, \
            "swap must stand even if old-R2 cleanup fails"

    def test_first_export_has_no_prior_object_to_delete(self, db):
        """A project with no prior final video must not attempt any R2 delete."""
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
            overlay._finalize_overlay_export(project_id, "first.mp4", "exp-t4010-g", USER_ID)

        mock_del.assert_not_called()


# ===========================================================================
# sharing_db helper
# ===========================================================================

class TestFilenameHasActiveShare:

    def test_returns_true_for_active_share_false_for_revoked(self):
        """filename_has_active_share: non-revoked share -> True, revoked -> False."""
        from app.services import sharing_db

        fake_cur = MagicMock()
        fake_conn = MagicMock()
        fake_conn.cursor.return_value = fake_cur
        cm = MagicMock()
        cm.__enter__.return_value = fake_conn
        cm.__exit__.return_value = False

        with patch.object(sharing_db, "get_pg", return_value=cm):
            fake_cur.fetchone.return_value = {"x": 1}
            assert sharing_db.filename_has_active_share("served.mp4") is True
            fake_cur.fetchone.return_value = None
            assert sharing_db.filename_has_active_share("orphan.mp4") is False
