"""T4370 DB-effects golden: triggers (a) single-clip render and (c) multi-clip
local branch.

Both share the EXACT same code path -- `multi_clip._export_clips(...,
is_test_mode=True)`'s local branch (MockVideoUpscaler, real ffmpeg crop+resize,
no AI/GPU/Modal/R2 network) -- so one parametrized test covers both triggers;
they differ only in clip_count/transition, which the audit found does NOT
change which finalize code path runs (both write via the same direct
`upsert_working_video` call at multi_clip.py ~1897-1905).

Stub boundary: only `upload_to_r2` (R2_ENABLED is False in this env, so the
real function returns False and the pipeline would hard-fail) and
`run_local_detection_on_frame` (the real YOLO call -- stubbed for determinism
across containers with/without the model available; the SURROUNDING detection
logic, including its own real fallback-on-exception branch, still runs).
"""


import pytest

from app.profile_context import set_current_profile_id
from app.routers.export import multi_clip as mc
from app.services.export_helpers import insert_export_job_if_none_active
from app.user_context import set_current_user_id
from tests.export_golden.fixtures import (
    FakeUploadFile,
    build_fixture_project,
    generate_tiny_mp4,
    new_test_user_id,
    snapshot_project_tables,
)
from tests.export_golden.snapshot import assert_matches_golden


@pytest.fixture
def golden_env(monkeypatch):
    """R2 upload + local player-detection stubbed; everything else (ffmpeg
    crop+resize via MockVideoUpscaler, concat, finalize DB writes) is real."""
    monkeypatch.setattr(mc, "upload_to_r2", lambda user_id, key, path: True)
    monkeypatch.setattr(
        mc, "run_local_detection_on_frame",
        lambda video_path, ts, confidence_threshold=0.5, seek_frame=None: {"boxes": [], "video_width": 320, "video_height": 180},
    )
    fixture_mp4 = generate_tiny_mp4(duration=3)
    return fixture_mp4


def _clip_export_data(index: int, duration: float, video_bytes: bytes) -> mc.ClipExportData:
    crop_keyframes = [
        {"time": 0.0, "x": 0, "y": 0, "width": 180, "height": 320},
        {"time": duration, "x": 0, "y": 0, "width": 180, "height": 320},
    ]
    return mc.ClipExportData(
        clip_index=index,
        crop_keyframes=crop_keyframes,
        segments=None,
        duration=duration,
        video_file=FakeUploadFile(video_bytes),
        clip_name=f"Fixture Clip {index}",
    )


async def _run_local_export(golden_env, *, clip_count: int, export_id: str):
    user_id = new_test_user_id(f"local{clip_count}")
    profile_id = "testdefault"
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    fixture = build_fixture_project(clip_count=clip_count, raw_duration=3.0)
    project_id = fixture["project_id"]
    assert insert_export_job_if_none_active(export_id, project_id, "framing"), \
        "fixture setup: export_jobs row must be freshly inserted"

    clips = [_clip_export_data(i, 3.0, golden_env) for i in range(clip_count)]
    transition = {"type": "cut", "duration": 0.0}

    await mc._export_clips(
        export_id=export_id,
        clips=clips,
        aspect_ratio="9:16",
        transition=transition,
        include_audio=False,
        target_fps=30,
        export_mode="quality",
        project_id=project_id,
        project_name="T4370 Golden Fixture",
        user_id=user_id,
        profile_id=profile_id,
        credits_deducted=0,
        total_video_seconds=3.0 * clip_count,
        is_test_mode=True,
    )
    return project_id


@pytest.mark.asyncio
async def test_single_clip_render_db_delta(golden_env):
    """Trigger (a): single-clip render, local branch."""
    project_id = await _run_local_export(golden_env, clip_count=1, export_id="exp-t4370-single")
    tables = snapshot_project_tables(project_id)
    assert_matches_golden("single_clip_render", tables)


@pytest.mark.asyncio
async def test_multi_clip_local_db_delta(golden_env):
    """Trigger (c): multi-clip local branch (MODAL_ENABLED unset/false)."""
    project_id = await _run_local_export(golden_env, clip_count=2, export_id="exp-t4370-multi-local")
    tables = snapshot_project_tables(project_id)
    assert_matches_golden("multi_clip_local", tables)
