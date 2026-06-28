"""
T4050 — Re-editing a published reel whose GAME SOURCE object is gone must fail
LOUD, not silently produce nothing.

Reproduction (bug-reproduction skill, prefix `bug-test-`):

A published reel is built from a game clip. After the game's storage ref expires
and the sweep scheduler's grace period elapses, `games/{blake3}.mp4` is deleted
from R2 (see app/services/sweep_scheduler.py:165). The profile DB still carries
the blake3_hash (games / game_videos rows are never cleaned up), so re-editing the
reel and hitting export reaches `_run_render_background`, which extracts the clip
straight from `games/{blake3}.mp4`. The presigned URL is generated WITHOUT an
existence check (storage.generate_presigned_url_global), so ffmpeg is handed a URL
that 404s and the extraction blows up deep in the pipeline.

Observed end state (the user's symptom): the re-framed result never materializes —
no new working_video, no new final_video — and the only trace is a raw ffmpeg
stderr on the export_jobs row. The user is given no actionable "source expired"
signal, so the reel just shows a draft with no preview.

This test drives `_run_render_background` with a game-backed clip whose source is
gone. It locks in the symptom invariants (nothing materializes; the live pointers
are preserved) and asserts the DESIRED loud failure: the recorded error must
classify the failure as a missing/expired SOURCE rather than echoing a raw ffmpeg
crash. That last assertion FAILS against current code — it is the reproduction.
"""

import re
import sqlite3
from unittest.mock import patch, MagicMock, AsyncMock

import pytest

USER_ID = "t4050-user"
PROFILE_ID = "testdefault"


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


def _seed_published_reel(db_path):
    """project + working_video v1 + final_video v1, project pointing at both, plus
    a 'processing' export_jobs row (mimics render_project's pre-step).
    Returns (project_id, working_video_id, final_video_id, export_id)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Brilliant Dribble', '9:16')")
    project_id = cur.lastrowid

    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) "
        "VALUES (?, 'wv_v1.mp4', 1, 6.0)", (project_id,))
    working_video_id = cur.lastrowid

    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, published_at) "
        "VALUES (?, 'final_v1.mp4', 1, 'brilliant_clip', 'Brilliant Dribble', CURRENT_TIMESTAMP)",
        (project_id,))
    final_video_id = cur.lastrowid

    cur.execute("UPDATE projects SET working_video_id = ?, final_video_id = ? WHERE id = ?",
                (working_video_id, final_video_id, project_id))

    export_id = "exp-t4050"
    cur.execute(
        "INSERT INTO export_jobs (id, project_id, type, status, input_data) "
        "VALUES (?, ?, 'framing', 'processing', '{}')", (export_id, project_id))
    conn.commit()
    conn.close()
    return project_id, working_video_id, final_video_id, export_id


def _versions(db_path, table, project_id):
    conn = _connect(db_path)
    rows = conn.execute(
        f"SELECT version FROM {table} WHERE project_id = ? ORDER BY version",
        (project_id,)).fetchall()
    conn.close()
    return [r["version"] for r in rows]


def _pointers(db_path, project_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT working_video_id, final_video_id FROM projects WHERE id = ?",
        (project_id,)).fetchone()
    conn.close()
    return row["working_video_id"], row["final_video_id"]


def _export_job(db_path, export_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT status, error FROM export_jobs WHERE id = ?", (export_id,)).fetchone()
    conn.close()
    return row["status"], row["error"]


@pytest.mark.asyncio
async def test_missing_game_source_reexport_fails_loud_not_silent(db):
    from app.routers.export import framing
    from app.routers.export.framing import _run_render_background

    project_id, wv, fv, export_id = _seed_published_reel(db)

    # The clip is backed by a game whose `games/{blake3}.mp4` has been reclaimed
    # from R2 (sweep_scheduler grace-deletion). The profile DB still has the hash.
    clip = {
        "id": 56, "raw_clip_id": 56, "uploaded_filename": None,
        "crop_data": None, "game_id": 7, "raw_filename": None,
        "clip_name": "Brilliant Dribble",
        "raw_start_time": 3560.0, "raw_end_time": 3566.0, "raw_duration": 6.0,
        "game_blake3_hash": "deadbeefdeadbeefdeadbeefdeadbeef", "video_sequence": 1,
    }

    # ffmpeg is handed a presigned URL for an object that no longer exists, so the
    # extraction 404s. Simulate exactly that: a generic ffmpeg open failure with NO
    # source-classification words in it (this is what gets recorded today).
    ffmpeg_mock = MagicMock()
    ffmpeg_mock.input.return_value.output.return_value.overwrite_output.return_value.run.side_effect = \
        RuntimeError("Error opening input file: Server returned 404 Not Found")

    with patch.object(framing, "generate_presigned_url_global", return_value="https://r2/games/x.mp4"), \
         patch.object(framing, "generate_presigned_url", return_value="https://r2/raw"), \
         patch.object(framing, "get_video_info", return_value={}), \
         patch.object(framing, "ffmpeg", ffmpeg_mock), \
         patch.object(framing.manager, "send_progress", new=AsyncMock()), \
         patch("app.services.export_helpers.sync_export_db_to_r2", return_value=None):
        await _run_render_background(
            export_id=export_id, project_id=project_id, project_name="Brilliant Dribble",
            aspect_ratio="16:9", clip=clip, segments_raw=None, include_audio=True,
            target_fps=30, export_mode="quality", user_id=USER_ID,
            profile_id=PROFILE_ID, credits_deducted=0, video_seconds=0.0,
            is_test_mode=True)

    # --- Symptom invariants (true now; must remain true after a fail-loud fix) ---
    # The re-framed result never materializes: no new working_video, no new final.
    assert _versions(db, "working_videos", project_id) == [1], \
        "missing-source re-export must not create a new working_video version"
    assert _versions(db, "final_videos", project_id) == [1], \
        "missing-source re-export must not create a new final_video"
    # The published reel's live pointers are preserved (T4010 invariant).
    assert _pointers(db, project_id) == (wv, fv), \
        "a failed re-export must restore working_video_id + final_video_id"

    status, error = _export_job(db, export_id)
    assert status == "error", "the export job must be marked failed"

    # --- DESIRED loud failure (THIS IS THE REPRODUCTION — fails on current code) ---
    # When the SOURCE object is gone, the recorded failure must say so in
    # user-actionable terms (expired / unavailable / reclaimed) instead of echoing
    # a raw ffmpeg crash. Today the export_jobs.error is the raw ffmpeg stderr, so
    # this assertion fails: that is the bug.
    assert error and re.search(r"unavailable|expired|reclaim|source video is missing", error, re.I), (
        "missing game source must surface a classified 'source expired/unavailable' "
        f"error so the UI can tell the user, not a raw render crash. Got: {error!r}"
    )
