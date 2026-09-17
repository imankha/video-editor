"""T4370 DB-effects golden: trigger (f) sweep auto-export
(`auto_export._export_brilliant_clip`).

Post-T4175 this trigger does NOT touch working_videos/final_videos at all (an
unframed clip must never enter My Reels -- see the epic's "raw-clips-in-
ranking-pool incident" and the T7600 idempotency invariant in
export-pipeline.md). It writes only `raw_clips.filename` + a `working_clips`
row. Snapshotting the FULL table set (not just those two) is deliberate: an
empty `final_videos`/`working_videos` delta is itself the property this golden
protects -- a future regression that makes the sweep publish again would show
up as a NEW nonempty entry, exactly the incident class this harness exists to
catch.

Stub boundary: `generate_presigned_url_global` (returns a local fixture MP4
path -- ffmpeg's `-i` accepts a local path directly, no R2 round-trip needed)
and `upload_to_r2`/`r2_head_object` (R2 disabled in this env).
"""

import pytest

from app.database import get_db_connection
from app.profile_context import set_current_profile_id
from app.services import auto_export
from app.user_context import set_current_user_id

from tests.export_golden.fixtures import (
    build_fixture_project,
    new_test_user_id,
    snapshot_project_tables,
    write_tiny_mp4,
)
from tests.export_golden.snapshot import assert_matches_golden


def test_sweep_auto_export_db_delta(monkeypatch, tmp_path):
    user_id = new_test_user_id("sweep")
    profile_id = "testdefault"
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    fixture = build_fixture_project(clip_count=0)
    project_id = fixture["project_id"]

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO raw_clips (filename, rating, start_time, end_time, auto_project_id, video_sequence)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ("orig_game_extract.mp4", 5, 10.0, 13.0, project_id, 1),
        )
        raw_clip_id = cursor.lastrowid
        conn.commit()

    source_video = write_tiny_mp4(tmp_path / "sweep_source.mp4", duration=15)

    monkeypatch.setattr(auto_export, "generate_presigned_url_global", lambda key: str(source_video))
    monkeypatch.setattr(auto_export, "upload_to_r2", lambda user_id, key, path: True)
    monkeypatch.setattr(auto_export, "r2_head_object", lambda user_id, key: False)

    clip = {
        "id": raw_clip_id,
        "auto_project_id": project_id,
        "video_hash": "fixturehash0123456789",
        "start_time": 10.0,
        "end_time": 13.0,
        "filename": None,
    }
    auto_export._export_brilliant_clip(user_id, profile_id, clip, game_id=999)

    tables = snapshot_project_tables(project_id)
    assert_matches_golden("sweep_auto_export", tables)
