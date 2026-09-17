"""T4370 DB-effects golden: trigger (e) durable worker
(`export_worker.process_export_job` -> `process_framing_export`).

This is a DIVERGENT finalize writer from the shared `upsert_working_video`
transaction (the audit's Section 5, item 3): its inline INSERT carries
`effect_type` and OMITS `detections_data`/`framing_snapshot`/
`highlight_carry_note` entirely -- one of the "5 finalize copies" T4390 will
consolidate. The golden pins this divergent column set verbatim.

Stub boundary: `export_worker.get_upscaler` (the real AI upscaler) is replaced
with a fake whose `process_video_with_upscale` copies the fixture input to the
output path (real ffprobe-readable file, no AI/GPU).
"""

import shutil

import pytest

from app.profile_context import set_current_profile_id
from app.routers.exports import create_export_job
from app.services import export_worker
from app.user_context import set_current_user_id

from tests.export_golden.fixtures import (
    build_fixture_project,
    new_test_user_id,
    snapshot_project_tables,
    write_tiny_mp4,
)
from tests.export_golden.snapshot import assert_matches_golden


class _FakeUpscaler:
    def __init__(self, **kwargs):
        self.upsampler = True

    def process_video_with_upscale(self, *, input_path, output_path, keyframes, target_fps,
                                    export_mode, progress_callback=None, segment_data=None,
                                    include_audio=True):
        shutil.copyfile(input_path, output_path)
        return {"status": "success"}


@pytest.mark.asyncio
async def test_durable_worker_db_delta(monkeypatch, tmp_path):
    user_id = new_test_user_id("worker")
    profile_id = "testdefault"
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    fixture = build_fixture_project(clip_count=1, raw_duration=4.0)
    project_id = fixture["project_id"]

    input_video = write_tiny_mp4(tmp_path / "worker_input.mp4", duration=4)

    monkeypatch.setattr(export_worker, "get_upscaler", lambda: _FakeUpscaler)
    # R2_ENABLED is False in this env so sync_db_to_r2_explicit/
    # sync_user_db_to_r2_explicit are already no-ops (verified: storage.R2_ENABLED
    # is False by default) -- _sync_after_export runs for real, unstubbed.

    config = {
        "video_path": str(input_video),
        "keyframes": [
            {"time": 0.0, "x": 0, "y": 0, "width": 180, "height": 320},
            {"time": 4.0, "x": 0, "y": 0, "width": 180, "height": 320},
        ],
        "target_fps": 30,
        "export_mode": "quality",
        "segment_data": None,
        "include_audio": False,
        "credit_user_id": user_id,
        "profile_id": profile_id,
    }
    job_id = create_export_job(project_id, "framing", config)

    await export_worker.process_export_job(job_id)

    tables = snapshot_project_tables(project_id)
    assert_matches_golden("durable_worker", tables)
