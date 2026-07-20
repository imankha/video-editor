"""
T4200 — framing/multi-clip export durability (sync-then-announce).

Framing and multi-clip both render through _export_clips (framing delegates to it).
Before this task, _export_clips:
  - announced COMPLETE before the profile DB was durably synced to R2, ignoring
    sync failure (a Fly machine cycling in between silently lost the export), and
  - swallowed a DB-save exception, logged it, and STILL announced "Export complete!"
    (phantom success -- an R2 object with no DB row pointing at it).

The fix copies overlay's boundary: sync-then-announce (gate COMPLETE on the durable
R2 sync, emit the shared retryable `sync_failed` event on failure) and makes a DB-save
failure terminal (re-raise -> outer handler refunds + marks failed, never COMPLETE).

These tests drive the Modal branch of _export_clips with the heavy externals mocked,
mirroring the T4110 overlay-worker test.
"""

import uuid

import pytest

import app.routers.export.multi_clip as mc
import app.services.export_helpers as helpers
from app.constants import ExportStatus
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_t4200_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def _make_clip():
    return mc.ClipExportData(
        clip_index=0,
        crop_keyframes=[],
        segments=[],
        duration=5.0,
        video_file=mc.BytesFile(b"fake-mp4"),
        source_fps=30.0,
        clip_name="Clip A",
    )


@pytest.fixture
def project():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T4200', '9:16')")
        project_id = cur.lastrowid
        conn.commit()
    yield project_id
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,))
        cur.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cur.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _patch_modal_pipeline(monkeypatch, sent):
    """Mock everything the Modal branch touches except the DB save + sync gate."""
    async def fake_send_progress(export_id, data):
        sent.append(data)

    async def fake_modal(**kwargs):
        return {"status": "success", "gpu_seconds": 1.0, "modal_function": "test", "clips_processed": 1}

    async def fake_detect(**kwargs):
        return [], {"videoWidth": None, "videoHeight": None, "fps": 30, "detections": []}

    async def fake_delete(*a, **k):
        return True

    monkeypatch.setattr(mc, "modal_enabled", lambda: True)
    monkeypatch.setattr(mc.manager, "send_progress", fake_send_progress)
    monkeypatch.setattr(mc, "upload_bytes_to_r2", lambda *a, **k: True)
    monkeypatch.setattr(mc, "call_modal_clips_ai", fake_modal)
    monkeypatch.setattr(mc, "delete_from_r2", fake_delete)
    monkeypatch.setattr(mc, "download_from_r2", lambda *a, **k: False)  # skip duration probe
    monkeypatch.setattr(mc, "run_player_detection_for_highlights", fake_detect)


async def _run(project_id):
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    return await mc._export_clips(
        export_id=f"exp-{uuid.uuid4().hex[:6]}",
        clips=[_make_clip()],
        aspect_ratio="9:16",
        transition={"type": "cut", "duration": 0},
        include_audio=False,
        target_fps=30,
        export_mode="standard",
        project_id=project_id,
        project_name="T4200 Reel",
        user_id=TEST_USER_ID,
        profile_id=TEST_PROFILE_ID,
        credits_deducted=0,
        total_video_seconds=5.0,
    )


@pytest.mark.asyncio
async def test_sync_ok_announces_complete(project, monkeypatch):
    sent = []
    _patch_modal_pipeline(monkeypatch, sent)
    monkeypatch.setattr(helpers, "sync_export_db_to_r2", lambda *a, **k: True)

    await _run(project)

    terminal = sent[-1]
    assert terminal["status"] == ExportStatus.COMPLETE, terminal
    assert not terminal.get("retryable")


@pytest.mark.asyncio
async def test_sync_failure_emits_sync_failed_not_complete(project, monkeypatch):
    sent = []
    _patch_modal_pipeline(monkeypatch, sent)
    # Force the durable R2 sync to fail.
    monkeypatch.setattr(helpers, "sync_export_db_to_r2", lambda *a, **k: False)

    resp = await _run(project)

    # 503 to the caller, and the WS terminal event is a retryable sync_failed error,
    # NOT a COMPLETE.
    assert resp.status_code == 503
    terminal = sent[-1]
    assert terminal["status"] == ExportStatus.ERROR, terminal
    assert terminal.get("retryable") is True
    assert terminal.get("code") == "sync_failed"
    assert not any(e.get("status") == ExportStatus.COMPLETE for e in sent), \
        "COMPLETE must never be announced when the durable sync failed"


@pytest.mark.asyncio
async def test_db_save_failure_is_terminal_no_complete(project, monkeypatch):
    sent = []
    _patch_modal_pipeline(monkeypatch, sent)
    # If the sync were reached it would pass -- prove the DB failure short-circuits first.
    monkeypatch.setattr(helpers, "sync_export_db_to_r2", lambda *a, **k: True)
    # Make the DB-save block raise (encode_data is only used inside the save blocks).
    def boom(*a, **k):
        raise RuntimeError("simulated DB-save failure")
    monkeypatch.setattr(mc, "encode_data", boom)

    from fastapi import HTTPException
    # Terminal: the DB-save failure is re-raised and the outer handler turns it into a
    # 500 (framing's background caller catches this; the multi-clip endpoint returns 500).
    with pytest.raises(HTTPException) as exc_info:
        await _run(project)
    assert exc_info.value.status_code == 500

    # No phantom success: an error was broadcast and COMPLETE never was.
    assert not any(e.get("status") == ExportStatus.COMPLETE for e in sent), \
        "DB-save failure must not announce COMPLETE"
    assert sent, "an error event should have been broadcast"
    assert sent[-1].get("status") == "error"
    # The project must not have been left pointing at a working video.
    with get_db_connection() as conn:
        row = conn.cursor().execute(
            "SELECT working_video_id FROM projects WHERE id = ?", (project,)
        ).fetchone()
    assert row["working_video_id"] is None
