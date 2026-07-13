"""T4990: missing-source re-export classification (confirmed-404-only).

Companion to test_t4050_missing_source_reexport (the primary spec). Pins the
two contract edges the primary test doesn't cover:

  1. Confirmed-404-only (T4820): an extract failure while the source object is
     STILL PRESENT (transient ffmpeg/R2 blip) must NOT be classified as
     expired/unavailable — it stays generic. Otherwise a flaky render would lie
     "your source expired".
  2. The recorded failure carries a stable machine-readable code
     (SOURCE_UNAVAILABLE), not a raw ffmpeg string.
"""

import re
import sqlite3
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.export_helpers import (
    SOURCE_UNAVAILABLE_CODE,
    classified_source_unavailable_message,
    source_confirmed_unavailable,
)

USER_ID = "t4990-user"
PROFILE_ID = "testdefault"


@pytest.fixture()
def db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(p):
    c = sqlite3.connect(str(p))
    c.row_factory = sqlite3.Row
    return c


def _seed(db_path):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('P', '9:16')")
    pid = cur.lastrowid
    cur.execute("INSERT INTO working_videos (project_id, filename, version, duration) "
                "VALUES (?, 'wv1.mp4', 1, 6.0)", (pid,))
    wv = cur.lastrowid
    cur.execute("INSERT INTO final_videos (project_id, filename, version, source_type, name, published_at) "
                "VALUES (?, 'fv1.mp4', 1, 'brilliant_clip', 'P', CURRENT_TIMESTAMP)", (pid,))
    fv = cur.lastrowid
    cur.execute("UPDATE projects SET working_video_id=?, final_video_id=? WHERE id=?", (wv, fv, pid))
    export_id = "exp-t4990"
    cur.execute("INSERT INTO export_jobs (id, project_id, type, status, input_data) "
                "VALUES (?, ?, 'framing', 'processing', '{}')", (export_id, pid))
    conn.commit()
    conn.close()
    return pid, wv, fv, export_id


def _clip():
    return {
        "id": 56, "raw_clip_id": 56, "uploaded_filename": None, "crop_data": None,
        "game_id": 7, "raw_filename": None, "clip_name": "P",
        "raw_start_time": 3560.0, "raw_end_time": 3566.0, "raw_duration": 6.0,
        "game_blake3_hash": "deadbeefdeadbeefdeadbeefdeadbeef", "video_sequence": 1,
    }


def _job_error(db_path, export_id):
    conn = _connect(db_path)
    row = conn.execute("SELECT status, error FROM export_jobs WHERE id=?", (export_id,)).fetchone()
    conn.close()
    return row["status"], row["error"]


# ---------------------------------------------------------------------------
# Unit: the classifier helpers
# ---------------------------------------------------------------------------

def test_classified_message_has_code_and_actionable_words():
    msg = classified_source_unavailable_message(56)
    assert SOURCE_UNAVAILABLE_CODE in msg  # machine-readable code
    assert re.search(r"unavailable|expired|reclaim", msg, re.I)  # human-actionable
    assert "56" in msg  # carries the clip id


def test_source_confirmed_unavailable_true_when_all_gone(db):
    # R2 disabled in this env -> head/exists probes all report gone (db fixture
    # sets the user/profile context the helper reads).
    assert source_confirmed_unavailable(_clip()) is True


def test_source_confirmed_unavailable_false_when_game_present(db):
    # A present game object means the failure is NOT a missing source.
    with patch("app.storage.r2_head_object_global", return_value={"ContentLength": 123}):
        assert source_confirmed_unavailable(_clip()) is False


# ---------------------------------------------------------------------------
# Integration: present-source extract failure stays GENERIC (confirmed-404-only)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_present_source_extract_failure_stays_generic(db):
    """A transient ffmpeg failure while the source object still EXISTS must not be
    misclassified as an expired/unavailable source (T4820 confirmed-404-only)."""
    from app.routers.export import framing
    from app.routers.export.framing import _run_render_background

    pid, wv, fv, export_id = _seed(db)

    ffmpeg_mock = MagicMock()
    ffmpeg_mock.input.return_value.output.return_value.overwrite_output.return_value.run.side_effect = \
        RuntimeError("Conversion failed! transient encoder hiccup")

    with patch("app.services.export_helpers.resolve_clip_source",
               return_value=("https://r2/games/x.mp4", 3560.0, 3566.0, True)), \
         patch.object(framing, "get_video_info", return_value={}), \
         patch.object(framing, "ffmpeg", ffmpeg_mock), \
         patch.object(framing.manager, "send_progress", new=AsyncMock()), \
         patch("app.services.export_helpers.sync_export_db_to_r2", return_value=None), \
         patch("app.services.export_helpers.source_confirmed_unavailable", return_value=False):
        await _run_render_background(
            export_id=export_id, project_id=pid, project_name="P", aspect_ratio="16:9",
            clip=_clip(), segments_raw=None, include_audio=True, target_fps=30,
            export_mode="quality", user_id=USER_ID, profile_id=PROFILE_ID,
            credits_deducted=0, video_seconds=0.0, is_test_mode=True)

    status, error = _job_error(db, export_id)
    assert status == "error"
    # Stays generic — NOT reclassified as expired/unavailable.
    assert SOURCE_UNAVAILABLE_CODE not in (error or "")
    assert not re.search(r"unavailable|expired|reclaim", error or "", re.I)
