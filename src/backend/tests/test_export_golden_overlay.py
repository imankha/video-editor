"""T4370 DB-effects golden: trigger (d) overlay final -- two entry points:

1. `render_overlay` -> `_run_overlay_export_background` (called directly, same
   pattern as `test_t4110_export_durability.py::test_overlay_background_gates_complete_on_durable_sync`):
   stubs `call_modal_overlay_auto` (Modal-or-local dispatch) and
   `generate_poster_at_export` (best-effort poster capture, irrelevant to the
   DB delta under test); `_finalize_overlay_export` runs FOR REAL.
2. `export_final` (`POST /api/export/final`): a plain request/response (no
   background task), driven via `httpx.ASGITransport` like
   `test_t4110_export_durability.py`'s dur_env fixture.

These are genuinely different writers (the audit found `_finalize_overlay_export`
and `export_final`'s inline INSERT have different slowmo-column guarding) --
separate goldens, not parametrized together.
"""

import io

import httpx
import pytest

from app.profile_context import set_current_profile_id
from app.routers.export import overlay as ov
from app.services.export_helpers import insert_export_job_if_none_active
from app.user_context import set_current_user_id
from tests.export_golden.fixtures import (
    build_fixture_project,
    new_test_user_id,
    snapshot_project_tables,
)
from tests.export_golden.snapshot import assert_matches_golden


def _seed_working_video(project_id: int, filename: str = "wv_fixture.mp4", duration: float = 5.0) -> int:
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO working_videos (project_id, filename, version, duration) VALUES (?, ?, 1, ?)",
            (project_id, filename, duration),
        )
        wv_id = cursor.lastrowid
        cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (wv_id, project_id))
        conn.commit()
    return wv_id


# ===========================================================================
# 1. render_overlay -> _run_overlay_export_background
# ===========================================================================

@pytest.mark.asyncio
async def test_render_overlay_db_delta(monkeypatch):
    user_id = new_test_user_id("overlay")
    profile_id = "testdefault"
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    fixture = build_fixture_project(clip_count=1, raw_duration=5.0)
    project_id = fixture["project_id"]
    _seed_working_video(project_id, duration=5.0)

    export_id = "exp-t4370-overlay-render"
    assert insert_export_job_if_none_active(export_id, project_id, "overlay")

    async def fake_modal_overlay_auto(**kwargs):
        return {"status": "success", "gpu_seconds": 1.5, "modal_function": "test_stub"}

    async def fake_generate_poster(*a, **k):
        return None

    def fake_rasterize_text_layers(user_id, text_overlays, working_filename):
        # Real _rasterize_text_layers is a plain function invoked via
        # asyncio.to_thread -- an async fake here would return an unawaited
        # coroutine instead of a list.
        return []

    monkeypatch.setattr(ov, "call_modal_overlay_auto", fake_modal_overlay_auto)
    monkeypatch.setattr(ov, "generate_poster_at_export", fake_generate_poster)
    monkeypatch.setattr(ov, "_rasterize_text_layers", fake_rasterize_text_layers)

    await ov._run_overlay_export_background(
        export_id=export_id,
        project_id=project_id,
        project_name="T4370 Golden Fixture",
        user_id=user_id,
        profile_id=profile_id,
        working_filename="wv_fixture.mp4",
        highlight_regions=[
            {"id": "r1", "start_time": 0.5, "end_time": 1.5, "enabled": True, "keyframes": []},
        ],
        effect_type="dark_overlay",
        video_duration=5.0,
    )

    tables = snapshot_project_tables(project_id)
    assert_matches_golden("overlay_render", tables)


# ===========================================================================
# 2. export_final (POST /api/export/final)
# ===========================================================================

@pytest.fixture()
def final_env(tmp_path):
    """Real per-user profile.sqlite under tmp_path, R2 disabled (upload_bytes_to_r2
    stubbed True) -- mirrors test_t4110_export_durability.py's dur_env fixture
    minus the FakeR2 harness (that task's concern is durability across a machine
    swap; T4370's concern is the DB delta this writer produces)."""
    from unittest.mock import patch

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()):
        from app.database import ensure_database, set_local_db_version
        from app.main import app

        user_id = new_test_user_id("exportfinal")
        profile_id = "abcd1234"
        set_current_user_id(user_id)
        set_current_profile_id(profile_id)
        ensure_database()
        set_local_db_version(user_id, profile_id, 0)

        yield app, user_id, profile_id


@pytest.mark.asyncio
async def test_export_final_db_delta(final_env, monkeypatch):
    app, user_id, profile_id = final_env
    monkeypatch.setattr("app.routers.export.overlay.upload_bytes_to_r2", lambda *a, **k: True)

    fixture = build_fixture_project(clip_count=1, raw_duration=5.0)
    project_id = fixture["project_id"]
    _seed_working_video(project_id, duration=5.0)

    headers = {"X-User-ID": user_id, "X-Profile-ID": profile_id}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver", headers=headers) as client:
        resp = await client.post(
            "/api/export/final",
            data={"project_id": str(project_id), "overlay_data": "{}"},
            files={"video": ("final.mp4", io.BytesIO(b"fake-mp4-bytes-t4370"), "video/mp4")},
        )
    assert resp.status_code == 200, resp.text

    tables = snapshot_project_tables(project_id)
    assert_matches_golden("export_final_http", tables)
