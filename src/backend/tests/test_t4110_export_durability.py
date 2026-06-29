"""
T4110 — Durable export boundary (sync-then-announce).

Re-export of a reel writes the new final_videos/export_jobs rows to the LOCAL
profile.sqlite; before T4110 the COMPLETE signal was announced before those rows
durably reached R2, so a single Fly machine cycling in between silently lost the
re-export (prod project 46). The fix gates the COMPLETE event on a durable R2 sync.

This reuses the T4050 in-memory boto3-shaped R2 harness so the REAL storage.py +
middleware logic runs end-to-end via httpx.ASGITransport.

Tests:
  1. /api/export/final (inline finalize, now Depends(durable_sync)) — forced R2
     failure returns 503 sync_failed (a 200 would lie); healthy survives a machine
     swap (the new final_videos row is durably in R2).
  2. The overlay background worker GATES its COMPLETE WebSocket event on the durable
     sync: sync OK -> status=complete; sync FAILED -> terminal error + retryable.
"""

import io
import sqlite3

import httpx
import pytest

# Reuse the T4050 harness: FakeR2, the R2 patch context, machine-swap helpers.
from tests.test_t4050_durable_sync import (
    FakeR2,
    _r2_patched,
    _request_context,
    _simulate_machine_replacement,
    _reload_from_r2,
    USER_ID,
    PROFILE_ID,
    HEADERS,
)
from tests.test_t4050_publish_restore_roundtrip import _connect, _seed_published_reel

from unittest.mock import patch


@pytest.fixture()
def dur_env(tmp_path):
    """Real per-user profile.sqlite under tmp_path + in-memory R2 (mirrors the
    T4050 dur_env fixture)."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         _r2_patched(fake):
        from app.main import app
        from app.database import ensure_database, get_database_path, set_local_db_version

        with _request_context():
            ensure_database()
            db_path = get_database_path()
            set_local_db_version(USER_ID, PROFILE_ID, 0)

        yield app, fake, db_path


def _client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=HEADERS,
    )


def _final_count(db_path, project_id):
    conn = _connect(db_path)
    n = conn.execute(
        "SELECT COUNT(*) c FROM final_videos WHERE project_id = ?", (project_id,)
    ).fetchone()["c"]
    conn.close()
    return n


# ===========================================================================
# 1. /api/export/final inline finalize is durable
# ===========================================================================

def _new_final_id(db_path, project_id):
    conn = _connect(db_path)
    fid = conn.execute(
        "SELECT final_video_id FROM projects WHERE id = ?", (project_id,)
    ).fetchone()["final_video_id"]
    conn.close()
    return fid


def _final_exists(db_path, final_id):
    conn = _connect(db_path)
    row = conn.execute("SELECT 1 FROM final_videos WHERE id = ?", (final_id,)).fetchone()
    conn.close()
    return row is not None


@pytest.mark.asyncio
async def test_export_final_durably_persists_new_final(dur_env):
    """A successful /final export does a T4010 atomic swap (new final replaces the
    prior). The NEW final_video the project now points at must survive a machine
    swap (durable_sync pushed it to R2 inside the write lock)."""
    app, fake, db_path = dur_env
    project_id, _ = _seed_published_reel(db_path)

    async with _client(app) as c:
        resp = await c.post(
            "/api/export/final",
            data={"project_id": str(project_id), "overlay_data": "{}"},
            files={"video": ("final.mp4", io.BytesIO(b"fake-mp4-bytes"), "video/mp4")},
        )
    assert resp.status_code == 200, resp.text

    new_fid = _new_final_id(db_path, project_id)
    assert new_fid is not None, "export did not repoint project.final_video_id"

    _simulate_machine_replacement(db_path)
    _reload_from_r2()

    assert _final_exists(db_path, new_fid), \
        "new final_videos row reverted after machine swap — export finalize not durable"


@pytest.mark.asyncio
async def test_export_final_returns_503_on_sync_failure(dur_env):
    """When the R2 profile upload fails, /final returns 503 sync_failed instead of a
    lying 200, and after a machine swap the new final is NOT present."""
    app, fake, db_path = dur_env
    project_id, _ = _seed_published_reel(db_path)

    fake.fail_profile_upload = True
    async with _client(app) as c:
        resp = await c.post(
            "/api/export/final",
            data={"project_id": str(project_id), "overlay_data": "{}"},
            files={"video": ("final.mp4", io.BytesIO(b"fake-mp4-bytes"), "video/mp4")},
        )
    assert resp.status_code == 503, resp.text
    assert resp.json()["code"] == "sync_failed"

    _simulate_machine_replacement(db_path)
    _reload_from_r2()
    # profile.sqlite never uploaded; the fresh machine has no record of the new final.
    assert _final_count(db_path, project_id) == 0, \
        "503 path must NOT be durable — a 200 here would have silently reverted"


# ===========================================================================
# 2. Overlay background worker gates COMPLETE on the durable sync
# ===========================================================================

@pytest.mark.asyncio
async def test_overlay_background_gates_complete_on_durable_sync(monkeypatch):
    """_run_overlay_export_background must announce COMPLETE only when the durable
    R2 sync succeeds; on sync failure it emits a terminal error flagged retryable
    (the WebSocket analog of T4050's 503) — never a false 'complete'."""
    import app.routers.export.overlay as ov
    import app.services.export_helpers as helpers

    sent = []

    async def fake_send_progress(export_id, data):
        sent.append(data)

    async def fake_modal(**kwargs):
        return {"status": "success", "gpu_seconds": 1.0, "modal_function": "test"}

    async def fake_helper_progress(*a, **k):
        return None

    def fake_finalize(*a, **k):
        return 4242

    monkeypatch.setattr(ov.manager, "send_progress", fake_send_progress)
    monkeypatch.setattr(ov, "call_modal_overlay_auto", fake_modal)
    monkeypatch.setattr(ov, "_finalize_overlay_export", fake_finalize)
    # send_progress / create_progress_callback / store_modal_call_id are imported
    # from export_helpers inside the worker — patch them at the source module.
    monkeypatch.setattr(helpers, "send_progress", fake_helper_progress)
    monkeypatch.setattr(helpers, "create_progress_callback", lambda *a, **k: (lambda *x, **y: None))
    monkeypatch.setattr(helpers, "store_modal_call_id", lambda *a, **k: None)

    async def run_worker():
        await ov._run_overlay_export_background(
            export_id="exp-1", project_id=41, project_name="Brilliant Dribble",
            user_id="u1", profile_id="p1", working_filename="wv.mp4",
            highlight_regions=[], effect_type="dark_overlay", video_duration=10.0,
        )

    from app.constants import ExportStatus

    # --- sync OK -> COMPLETE ---
    monkeypatch.setattr(helpers, "sync_export_db_to_r2", lambda *a, **k: True)
    sent.clear()
    await run_worker()
    terminal = sent[-1]
    assert terminal["status"] == ExportStatus.COMPLETE, terminal
    assert not terminal.get("retryable")

    # --- sync FAILED -> terminal error, retryable, NOT complete ---
    monkeypatch.setattr(helpers, "sync_export_db_to_r2", lambda *a, **k: False)
    sent.clear()
    await run_worker()
    terminal = sent[-1]
    assert terminal["status"] == ExportStatus.ERROR, terminal
    assert terminal.get("retryable") is True
    assert terminal.get("code") == "sync_failed"
