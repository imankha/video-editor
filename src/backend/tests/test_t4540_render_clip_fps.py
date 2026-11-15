"""
T4540 -- the framing render times the crop with the clip's STORED frame rate
(working_clips.fps, else game_videos.fps -- the same value the editor reads from
GET /clips), never a guessed 30.

The editor stores crop keyframes by frame number at the clip's fps. The render
converts them to seconds with `frame / framerate`. Before T4540 the render took
its framerate from an ffprobe of the source and fell back to 30 with only a
warning when the probe failed, so a 60 fps clip's crop path ran at double speed.

- test_render_uses_stored_clip_fps_when_probe_fails: a 60 fps clip whose probe
  fails still renders its frame-120 keyframe at 2.0s (not 4.0s from a guessed 30).
- test_render_uses_stored_clip_fps_over_probe: the stored rate wins over the
  probe, so editor and render agree on one number.
- test_render_endpoint_refuses_clip_without_fps: a clip with no stored rate is
  refused with a clear 400 and leaves no in-flight job behind.

Run: pytest tests/test_t4540_render_clip_fps.py -v
"""

import sqlite3
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

USER_ID = f"test_t4540_{uuid.uuid4().hex[:8]}"
PROFILE_ID = "testdefault"

from app.session_init import _init_cache  # noqa: E402

_init_cache[USER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}


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


def _clip(fps):
    from app.utils.encoding import encode_data
    crop = [
        {"frame": 0, "x": 0, "y": 0, "width": 100, "height": 178},
        {"frame": 120, "x": 50, "y": 0, "width": 100, "height": 178},
    ]
    return {
        "id": 1, "raw_clip_id": 1, "uploaded_filename": None,
        "crop_data": encode_data(crop), "game_id": None, "raw_filename": "clip.mp4",
        "clip_name": "Run", "raw_start_time": 0.0, "raw_end_time": 4.0, "raw_duration": 4.0,
        "game_blake3_hash": None, "video_sequence": None, "rotation": 0.0, "fps": fps,
    }


async def _render(clip, probe):
    from app.routers.export import framing

    captured = {}

    async def fake_export_clips(**kwargs):
        captured["clips"] = kwargs["clips"]

    ffmpeg_mock = MagicMock()
    with patch("app.services.export_helpers.resolve_clip_source",
               return_value=("https://r2/clip.mp4", 0.0, 4.0, True)), \
         patch.object(framing, "get_video_info", **probe), \
         patch.object(framing, "ffmpeg", ffmpeg_mock), \
         patch.object(framing, "_export_clips", new=fake_export_clips), \
         patch("builtins.open", MagicMock()), \
         patch.object(framing.manager, "send_progress", new=AsyncMock()), \
         patch("app.services.export_helpers.sync_export_db_to_r2", return_value=None):
        await framing._run_render_background(
            export_id="exp-t4540", project_id=1, project_name="Run",
            aspect_ratio="9:16", clip=clip, segments_raw=None, include_audio=True,
            target_fps=30, export_mode="quality", user_id=USER_ID,
            profile_id=PROFILE_ID, credits_deducted=0, video_seconds=4.0,
            is_test_mode=True)
    return captured["clips"][0]


@pytest.mark.asyncio
async def test_render_uses_stored_clip_fps_when_probe_fails(db):
    export = await _render(_clip(60.0), {"side_effect": RuntimeError("probe failed")})
    assert [kf["time"] for kf in export.crop_keyframes] == [0.0, 2.0]
    assert export.source_fps == 60.0


@pytest.mark.asyncio
async def test_render_uses_stored_clip_fps_over_probe(db):
    export = await _render(_clip(60.0), {"return_value": {"fps": 30.0, "width": 1920, "height": 1080}})
    assert [kf["time"] for kf in export.crop_keyframes] == [0.0, 2.0]
    assert export.source_fps == 60.0


def test_render_endpoint_refuses_clip_without_fps(db):
    from fastapi.testclient import TestClient

    from app.main import app

    conn = sqlite3.connect(str(db))
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('No rate', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, name, start_time, end_time) VALUES ('clip.mp4', 'Run', 0, 4)")
    raw_clip_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version, fps) "
        "VALUES (?, ?, 0, 1, NULL)", (project_id, raw_clip_id))
    conn.commit()
    conn.close()

    # Credits are never reached once the clip is refused; stub them so a pre-fix
    # run fails on the status code, not on a Postgres round trip.
    with patch("app.services.credit_ledger.reserve_credits",
               return_value={"success": False, "balance": 0}), \
         TestClient(app, headers={"X-User-ID": USER_ID, "X-Profile-ID": PROFILE_ID}) as client:
        resp = client.post(
            "/api/export/render",
            json={"project_id": project_id, "export_id": f"exp_{uuid.uuid4().hex}"},
        )

    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["error"] == "missing_framerate"
    conn = sqlite3.connect(str(db))
    active = conn.execute(
        "SELECT COUNT(*) FROM export_jobs WHERE project_id = ? AND status IN ('pending', 'processing')",
        (project_id,)).fetchone()[0]
    conn.close()
    assert active == 0, "a refused render must not leave an in-flight job that blocks the next try"
