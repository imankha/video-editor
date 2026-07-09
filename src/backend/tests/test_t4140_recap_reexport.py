"""
T4140 — money path: a Create-Clip (T4130) draft re-exports from the RECAP after
the game video has been reclaimed.

Scenario: the user clicked "+Create Clip" in the recap viewer, which made a draft
pointing at a game clip that has NO preserved per-clip extract (raw_clips.filename
is empty). Later the sweep hard-deletes `games/{blake3}.mp4`. Re-exporting the
draft must NOT fail: resolve_clip_source falls through game (gone) -> extract
(absent) -> recap (present) and hands the render pipeline the recap URL at the
clip's FROZEN bounds (recap_start/recap_end, flexible=False).

This drives the real `_run_render_background` with the real `resolve_clip_source`
(only R2 + the render tail are mocked). It proves the extract streams from the
recap at the recap offsets and the render pipeline is entered — i.e. the draft
re-exports instead of aborting with SOURCE EXTRACT FAILED. MODAL_ENABLED is
irrelevant here because the render delegate is mocked; the fix under test is the
source-resolution seam.
"""

import json
import logging
import sqlite3
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

USER_ID = "t4140-user"
PROFILE_ID = "testdefault"

GAME_ID = 7
RAW_CLIP_ID = 56
GAME_HASH = "deadbeefdeadbeefdeadbeefdeadbeef"
RECAP_START, RECAP_END = 12.5, 18.0  # frozen bounds inside the stitched recap


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


def _seed_draft(db_path):
    """A frameable draft (project + working_clip + raw_clip) whose game clip has
    NO preserved extract. Returns (project_id, export_id, clip_dict) shaped exactly
    like framing.render's SELECT row."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Recap Clip', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (id, filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES (?, '', 5, ?, ?, ?, 1)",
        (RAW_CLIP_ID, RECAP_START, RECAP_END, GAME_ID))
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
        "VALUES (?, ?, 1, 0)", (project_id, RAW_CLIP_ID))
    working_clip_id = cur.lastrowid
    export_id = "exp-t4140"
    cur.execute(
        "INSERT INTO export_jobs (id, project_id, type, status, input_data) "
        "VALUES (?, ?, 'framing', 'processing', '{}')", (export_id, project_id))
    conn.commit()
    conn.close()

    # Mirror the framing.render SELECT: `id` = working_clip id, `raw_clip_id` =
    # raw_clips.id (the recap-mapping key), raw_filename empty (no extract).
    clip = {
        "id": working_clip_id, "raw_clip_id": RAW_CLIP_ID, "uploaded_filename": None,
        "crop_data": None, "timing_data": None, "segments_data": None, "sort_order": 0,
        "raw_filename": "", "clip_name": "Recap Clip", "game_id": GAME_ID,
        "video_sequence": 1, "raw_start_time": RECAP_START, "raw_end_time": RECAP_END,
        "raw_duration": RECAP_END - RECAP_START, "game_blake3_hash": GAME_HASH,
    }
    return project_id, export_id, clip


def _job_status(db_path, export_id):
    conn = sqlite3.connect(str(db_path))
    row = conn.execute("SELECT status, error FROM export_jobs WHERE id = ?", (export_id,)).fetchone()
    conn.close()
    return row[0], row[1]


class _FakeFfmpeg:
    """Minimal ffmpeg stand-in: records input() args and materializes the clip
    file so the render's `open(clip_path)` read succeeds."""
    def __init__(self):
        self.input_calls = []
        self._path = None

    def input(self, *args, **kwargs):
        self.input_calls.append((args, kwargs))
        return self

    def output(self, path, **kwargs):
        self._path = path
        return self

    def overwrite_output(self):
        return self

    def run(self, **kwargs):
        Path(self._path).write_bytes(b"\x00" * 64)


@pytest.mark.asyncio
async def test_create_clip_draft_reexports_from_recap_after_game_deleted(db, caplog):
    from app.routers.export import framing
    from app.routers.export.framing import _run_render_background

    project_id, export_id, clip = _seed_draft(db)

    recap_mapping = [
        {"id": RAW_CLIP_ID, "name": "Recap Clip", "rating": 5,
         "recap_start": RECAP_START, "recap_end": RECAP_END},
        {"id": 999, "recap_start": 0.0, "recap_end": 4.0},
    ]

    def _fake_download(user_id, rel_path, local_path, *a, **k):
        assert rel_path == f"recaps/{GAME_ID}_clips.json"
        Path(local_path).write_text(json.dumps(recap_mapping))
        return True

    fake_ffmpeg = _FakeFfmpeg()
    export_clips_mock = AsyncMock()

    with patch("app.storage.r2_head_object_global", return_value=None), \
         patch("app.storage.download_from_r2", side_effect=_fake_download), \
         patch("app.storage.generate_presigned_url", return_value="RECAP_PRESIGNED_URL"), \
         patch.object(framing, "get_video_info", return_value={}), \
         patch.object(framing, "ffmpeg", fake_ffmpeg), \
         patch.object(framing, "_export_clips", export_clips_mock), \
         patch.object(framing.manager, "send_progress", new=AsyncMock()), \
         patch("app.services.export_helpers.sync_export_db_to_r2", return_value=None):
        with caplog.at_level(logging.INFO, logger="app.routers.export.framing"):
            await _run_render_background(
                export_id=export_id, project_id=project_id, project_name="Recap Clip",
                aspect_ratio="9:16", clip=clip, segments_raw=None, include_audio=True,
                target_fps=30, export_mode="quality", user_id=USER_ID,
                profile_id=PROFILE_ID, credits_deducted=0, video_seconds=0.0,
                is_test_mode=True)

    # The extract streamed from the RECAP at the clip's frozen bounds.
    assert fake_ffmpeg.input_calls, "ffmpeg extract was never invoked"
    (in_args, in_kwargs) = fake_ffmpeg.input_calls[0]
    assert in_args[0] == "RECAP_PRESIGNED_URL", \
        f"extract must source from the recap, got {in_args[0]!r}"
    assert in_kwargs.get("ss") == RECAP_START and in_kwargs.get("to") == RECAP_END, \
        "extract must use the recap-relative frozen bounds"

    # The render pipeline was entered (draft re-exported, not aborted).
    export_clips_mock.assert_awaited_once()

    # Frozen bounds surfaced (flexible=False) and no failure recorded.
    assert "flexible=False" in caplog.text
    status, error = _job_status(db, export_id)
    assert status != "error", f"re-export from recap must not fail, error={error!r}"
