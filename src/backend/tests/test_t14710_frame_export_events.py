"""T14710: the Frame render path records the Journey's export events.

`POST /api/export/render` is the only route the Frame screen's paid button calls
(T11240), but `export_started` / `export_completed` / `framing_exported` were only
written by the legacy job route, so the Journey read "Pressed Export 0".

These tests run the REAL `record_milestone` and read what it sends to `user_actions`
through an in-memory Postgres stand-in. They deliberately avoid the `pg_conn` fixture:
it truncates tables on the shared dev Postgres.
"""

import uuid
from contextlib import contextmanager
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app import analytics
from app.main import app
from app.profile_context import set_current_profile_id
from app.routers.export import framing
from app.routers.export import multi_clip as mc
from app.services import credit_ledger, export_finalize
from app.services.analytics_journey import annotate_coverage
from app.services.export_helpers import insert_export_job_if_none_active
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from tests.export_golden.fixtures import (
    FakeUploadFile,
    build_fixture_project,
    generate_tiny_mp4,
    new_test_user_id,
)

PROFILE_ID = "testdefault"
EXPORT_EVENTS = ("export_started", "export_completed", "framing_exported")


@pytest.fixture
def user_actions(monkeypatch):
    """In-memory `user_actions`: (user_id, action) -> count, fed by record_milestone's SQL."""
    rows: dict[tuple[str, str], int] = {}

    def execute(sql, params=None):
        if "INSERT INTO user_actions" in sql:
            user_id, action, _platform = params
            rows[(user_id, action)] = rows.get((user_id, action), 0) + 1

    @contextmanager
    def fake_get_pg():
        conn = MagicMock()
        cursor = MagicMock()
        cursor.execute.side_effect = execute
        cursor.fetchone.return_value = None
        conn.cursor.return_value = cursor
        yield conn

    monkeypatch.setattr(analytics, "get_pg", fake_get_pg)
    return rows


def _export_counts(rows: dict, user_id: str) -> dict:
    return {event: rows[(user_id, event)] for event in EXPORT_EVENTS if (user_id, event) in rows}


def _new_user(slug: str) -> str:
    user_id = new_test_user_id(f"t14710_{slug}")
    _init_cache[user_id] = {"profile_id": PROFILE_ID, "is_new_user": False}
    set_current_user_id(user_id)
    set_current_profile_id(PROFILE_ID)
    return user_id


def _press_render(user_id: str, project_id: int):
    """Press the paid Frame button: the real route, with the background render stubbed."""
    headers = {"X-User-ID": user_id, "X-Profile-ID": PROFILE_ID}
    with TestClient(app, headers=headers) as client:
        return client.post(
            "/api/export/render",
            json={"project_id": project_id, "export_id": f"press_{uuid.uuid4().hex}"},
        )


@pytest.fixture
def render_press(monkeypatch):
    """Credits succeed and the render itself does not run; a test overrides as needed."""
    monkeypatch.setattr(framing, "_run_render_background", AsyncMock())
    monkeypatch.setattr(credit_ledger, "reserve_credits", lambda *a, **k: {"success": True, "balance": 10})
    monkeypatch.setattr(credit_ledger, "confirm_reservation", lambda *a, **k: None)


def test_accepted_press_records_export_started(user_actions, render_press):
    user_id = _new_user("press")
    project_id = build_fixture_project(clip_count=1, raw_duration=3.0)["project_id"]

    response = _press_render(user_id, project_id)

    assert response.status_code == 202
    assert _export_counts(user_actions, user_id) == {"export_started": 1}


def test_duplicate_press_is_not_counted(user_actions, render_press):
    user_id = _new_user("dup")
    project_id = build_fixture_project(clip_count=1, raw_duration=3.0)["project_id"]
    assert insert_export_job_if_none_active(f"first_{uuid.uuid4().hex}", project_id, "framing")

    response = _press_render(user_id, project_id)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "export_in_flight"
    assert _export_counts(user_actions, user_id) == {}


def test_press_without_credits_is_not_counted(user_actions, render_press, monkeypatch):
    user_id = _new_user("broke")
    project_id = build_fixture_project(clip_count=1, raw_duration=3.0)["project_id"]
    monkeypatch.setattr(credit_ledger, "reserve_credits", lambda *a, **k: {"success": False, "balance": 0})

    response = _press_render(user_id, project_id)

    assert response.status_code == 402
    assert response.json()["detail"]["error"] == "insufficient_credits"
    assert _export_counts(user_actions, user_id) == {}


@pytest.fixture
def tiny_mp4():
    return generate_tiny_mp4(duration=3)


def _clip(video_bytes: bytes) -> mc.ClipExportData:
    frame = {"x": 0, "y": 0, "width": 180, "height": 320}
    return mc.ClipExportData(
        clip_index=0,
        crop_keyframes=[{"time": 0.0, **frame}, {"time": 3.0, **frame}],
        segments=None,
        duration=3.0,
        video_file=FakeUploadFile(video_bytes),
        clip_name="T14710 clip",
    )


async def _run_pipeline(user_id: str, video_bytes: bytes, *, is_test_mode: bool):
    project_id = build_fixture_project(clip_count=1, raw_duration=3.0)["project_id"]
    export_id = f"exp_{uuid.uuid4().hex}"
    assert insert_export_job_if_none_active(export_id, project_id, "framing")
    return await mc._export_clips(
        export_id=export_id,
        clips=[_clip(video_bytes)],
        aspect_ratio="9:16",
        transition={"type": "cut", "duration": 0.0},
        include_audio=False,
        target_fps=30,
        export_mode="quality",
        project_id=project_id,
        project_name="T14710",
        user_id=user_id,
        profile_id=PROFILE_ID,
        credits_deducted=0,
        total_video_seconds=3.0,
        is_test_mode=is_test_mode,
    )


@pytest.fixture
def modal_render(monkeypatch, tiny_mp4):
    """Modal branch with only the GPU call, R2 transport and detection stubbed."""

    async def fake_call_modal_clips_ai(**kwargs):
        kwargs["call_id_callback"]("modal-call-t14710")
        return {"status": "success", "clips_processed": 1, "gpu_seconds": 2.5, "modal_function": "stub"}

    def fake_download_from_r2(user_id, key, local_path):
        local_path.write_bytes(tiny_mp4)
        return True

    async def fake_detection(*, user_id, output_key, source_clips, progress_callback=None):
        return [], mc._empty_video_detections()

    monkeypatch.setattr(mc, "modal_enabled", lambda: True)
    monkeypatch.setattr(mc, "call_modal_clips_ai", fake_call_modal_clips_ai)
    monkeypatch.setattr(mc, "upload_bytes_to_r2", lambda user_id, key, content: True)
    monkeypatch.setattr(mc, "download_from_r2", fake_download_from_r2)
    monkeypatch.setattr(mc, "delete_from_r2", lambda user_id, key: True)
    monkeypatch.setattr(mc, "run_player_detection_for_highlights", fake_detection)


@pytest.mark.asyncio
async def test_modal_render_records_completion_once(user_actions, modal_render, tiny_mp4):
    user_id = _new_user("modal")

    await _run_pipeline(user_id, tiny_mp4, is_test_mode=False)

    assert _export_counts(user_actions, user_id) == {"export_completed": 1, "framing_exported": 1}


@pytest.mark.asyncio
async def test_local_render_records_completion_once(user_actions, monkeypatch, tiny_mp4):
    monkeypatch.setattr(mc, "modal_enabled", lambda: False)
    monkeypatch.setattr(mc, "upload_to_r2", lambda user_id, key, path: True)
    monkeypatch.setattr(
        mc, "run_local_detection_on_frame",
        lambda video_path, ts, confidence_threshold=0.5, seek_frame=None: {
            "boxes": [], "video_width": 320, "video_height": 180,
        },
    )
    user_id = _new_user("local")

    await _run_pipeline(user_id, tiny_mp4, is_test_mode=True)

    assert _export_counts(user_actions, user_id) == {"export_completed": 1, "framing_exported": 1}


@pytest.mark.asyncio
async def test_finalize_won_by_recovery_is_not_counted_again(user_actions, modal_render, monkeypatch, tiny_mp4):
    """The recovery poll that won the finalize already wrote export_completed (type recovered)."""
    monkeypatch.setattr(
        export_finalize, "finalize_export",
        AsyncMock(return_value={"finalized": False, "already_finalizing": True}),
    )
    monkeypatch.setattr(
        mc, "_await_concurrent_finalize",
        AsyncMock(return_value={"finalized": True, "working_video_id": 1, "output_filename": "out.mp4"}),
    )
    user_id = _new_user("lost")

    await _run_pipeline(user_id, tiny_mp4, is_test_mode=False)

    assert _export_counts(user_actions, user_id) == {}


@pytest.mark.asyncio
async def test_render_that_never_became_durable_is_not_counted(user_actions, modal_render, monkeypatch, tiny_mp4):
    monkeypatch.setattr(
        export_finalize, "finalize_export",
        AsyncMock(return_value={"finalized": True, "sync_failed": True, "working_video_id": 1}),
    )
    user_id = _new_user("unsynced")

    await _run_pipeline(user_id, tiny_mp4, is_test_mode=False)

    assert _export_counts(user_actions, user_id) == {}


@pytest.mark.parametrize("stage_key", ["export_pressed", "exported"])
def test_windows_before_the_fix_are_badged_not_shown_as_zero(stage_key):
    ladder = [stage for stage in analytics.JOURNEY_LADDER if stage["key"] == stage_key]
    nodes = [{"key": stage_key}]

    annotate_coverage(nodes, ladder, date(2026, 10, 1), date(2026, 10, 31), analytics.EVENT_INSTRUMENTED_AT)

    assert nodes[0].get("no_data") is True


def test_pressed_export_is_not_labelled_a_client_beacon():
    stage = next(s for s in analytics.JOURNEY_LADDER if s["key"] == "export_pressed")
    assert not stage.get("client_beacon")
