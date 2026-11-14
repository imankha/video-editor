"""T4790 regression tests for the three F821 undefined-name bugs found during
the lint-backlog triage. Each of these was a latent NameError that would fire at
runtime on a specific code path; each test below fails on the pre-fix code.

Bugs:
  1. exports.finalize_modal_export returned an undefined `presigned_url` on its
     success path -> the whole recovered-export finalization always fell into the
     `except` and returned {"finalized": False}.
  2. games_upload used generate_presigned_url_global without importing it.
  3. (an undefined name in the multi-clip export background runner; T11250
     deleted that function along with its test.)
"""

import pytest


@pytest.mark.asyncio
async def test_finalize_modal_export_delegates_to_finalize_export(monkeypatch):
    """Bug 1 (superseded by T5630): finalize_modal_export is now a thin async
    adapter over the unified finalize_export (recovery == normal export). It
    resolves output_key (persisted checkpoint, else modal_result), delegates, and
    records the recovery milestone on a FRESH finalize. The old undefined-name
    path is gone; the success behavior lives in test_t5630_* now."""
    from app.profile_context import set_current_profile_id
    from app.routers import exports
    from app.services import export_finalize

    set_current_profile_id("testprofile")
    captured = {}
    milestones = []

    async def fake_finalize_export(job, output_key, user_id, profile_id, **kwargs):
        captured.update(output_key=output_key, user_id=user_id, kwargs=kwargs)
        return {"finalized": True, "working_video_id": 7, "output_filename": output_key.split("/")[-1]}

    monkeypatch.setattr(export_finalize, "finalize_export", fake_finalize_export)
    monkeypatch.setattr(exports, "record_milestone", lambda *a, **k: milestones.append(a))

    result = await exports.finalize_modal_export(
        job={"id": "job-1", "project_id": 42},
        modal_result={"output_key": "working_videos/working_42_abc.mp4", "gpu_seconds": 3.0, "modal_function": "fn"},
        user_id="user-1",
    )

    assert result["finalized"] is True and result["working_video_id"] == 7
    assert "presigned_url" not in result  # generated on-the-fly, never stored here
    assert captured["output_key"] == "working_videos/working_42_abc.mp4"
    assert captured["kwargs"]["gpu_seconds"] == 3.0 and captured["kwargs"]["modal_function"] == "fn"
    assert milestones  # recovery milestone recorded on fresh finalize


def test_games_upload_imports_generate_presigned_url_global():
    """Bug 2: the name must resolve in the games_upload module namespace."""
    from app.routers import games_upload

    assert callable(games_upload.generate_presigned_url_global)
