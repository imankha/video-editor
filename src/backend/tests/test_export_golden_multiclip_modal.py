"""T4370 DB-effects golden: trigger (b) multi-clip Modal branch.

Same `multi_clip._export_clips` entry point as the local-branch tests, but with
`modal_enabled()` forced True so the OTHER branch (lines ~1401-1660) runs: R2
source upload, `call_modal_clips_ai`, R2 output download for duration probing,
then the SHARED `finalize_export` orchestrator (detect -> persist -> sync) --
a genuinely different code path from the local branch's direct
`upsert_working_video` call (the audit's Section 4(b): local passes
`detections_data=None`, Modal populates it).

Stub boundary: `call_modal_clips_ai` (the actual GPU call), R2 transport
(`upload_bytes_to_r2`/`download_from_r2`/`delete_from_r2`, all no-ops or
local-file writes since R2_ENABLED is False in this env), and
`run_player_detection_for_highlights` (the detection call `finalize_export`
makes) for deterministic regions. `finalize_export` -> `upsert_working_video`
itself runs FOR REAL.
"""

import pytest

from app.profile_context import set_current_profile_id
from app.routers.export import multi_clip as mc
from app.services import export_finalize
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


@pytest.mark.asyncio
async def test_multi_clip_modal_db_delta(monkeypatch):
    user_id = new_test_user_id("modal")
    profile_id = "testdefault"
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    fixture = build_fixture_project(clip_count=2, raw_duration=3.0)
    project_id = fixture["project_id"]
    export_id = "exp-t4370-multi-modal"
    assert insert_export_job_if_none_active(export_id, project_id, "framing")

    fixture_mp4 = generate_tiny_mp4(duration=3)

    async def fake_call_modal_clips_ai(**kwargs):
        call_id_callback = kwargs.get("call_id_callback")
        if call_id_callback:
            call_id_callback("modal-call-t4370-fixed")
        return {
            "status": "success",
            "clips_processed": len(kwargs.get("source_keys", [])),
            "gpu_seconds": 2.5,
            "modal_function": "clips_ai_test_stub",
        }

    def fake_download_from_r2(user_id, key, local_path):
        local_path.write_bytes(fixture_mp4)
        return True

    async def fake_run_player_detection_for_highlights(*, user_id, output_key, source_clips, progress_callback=None):
        regions = [
            {"id": "det-1", "start_time": 0.2, "end_time": 1.0, "enabled": True, "keyframes": []},
        ]
        video_detections = {"fps": 30, "detections": []}
        return regions, video_detections

    monkeypatch.setattr(mc, "modal_enabled", lambda: True)
    monkeypatch.setattr(mc, "call_modal_clips_ai", fake_call_modal_clips_ai)
    monkeypatch.setattr(mc, "upload_bytes_to_r2", lambda user_id, key, content: True)
    monkeypatch.setattr(mc, "download_from_r2", fake_download_from_r2)
    monkeypatch.setattr(mc, "delete_from_r2", lambda user_id, key: True)
    monkeypatch.setattr(mc, "run_player_detection_for_highlights", fake_run_player_detection_for_highlights)

    clips = [
        mc.ClipExportData(
            clip_index=i,
            crop_keyframes=[
                {"time": 0.0, "x": 0, "y": 0, "width": 180, "height": 320},
                {"time": 3.0, "x": 0, "y": 0, "width": 180, "height": 320},
            ],
            segments=None,
            duration=3.0,
            video_file=FakeUploadFile(fixture_mp4),
            clip_name=f"Fixture Clip {i}",
        )
        for i in range(2)
    ]

    await mc._export_clips(
        export_id=export_id,
        clips=clips,
        aspect_ratio="9:16",
        transition={"type": "cut", "duration": 0.0},
        include_audio=False,
        target_fps=30,
        export_mode="quality",
        project_id=project_id,
        project_name="T4370 Golden Fixture",
        user_id=user_id,
        profile_id=profile_id,
        credits_deducted=0,
        total_video_seconds=6.0,
        is_test_mode=False,
    )

    tables = snapshot_project_tables(project_id)
    assert_matches_golden("multi_clip_modal", tables)
