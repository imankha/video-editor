"""T4400: an old tab cannot overwrite newer Frame edits.

Tab A loads the clip. Tab B moves the crop through the gesture endpoint. Tab A
then presses the render button. Before T4400 the button first PUT the tab's
whole framing state (`crop_data` + `segments_data`) with no version check, so
tab A's stale copy replaced tab B's edit and the render used it. The PUT
below is exactly what that older bundle sends, so it also covers a tab still
running pre-T4400 JavaScript.
"""

import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.routers.export import framing
from app.services import credit_ledger
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.utils.encoding import decode_data
from tests.export_golden.fixtures import build_fixture_project, new_test_user_id

PROFILE_ID = "testdefault"

TAB_A_CROP = [{"frame": 0, "x": 10, "y": 10, "width": 180, "height": 320, "origin": "user"}]
TAB_B_CROP = {"frame": 0, "x": 400, "y": 50, "width": 180, "height": 320, "origin": "user"}
TAB_A_SEGMENTS = {"boundaries": [], "segmentSpeeds": {}, "trimRange": None}


@pytest.fixture
def user_id():
    uid = new_test_user_id("t4400")
    _init_cache[uid] = {"profile_id": PROFILE_ID, "is_new_user": False}
    set_current_user_id(uid)
    set_current_profile_id(PROFILE_ID)
    return uid


@pytest.fixture
def render_spy(monkeypatch):
    spy = AsyncMock()
    monkeypatch.setattr(framing, "_run_render_background", spy)
    monkeypatch.setattr(credit_ledger, "reserve_credits", lambda *a, **k: {"success": True, "balance": 10})
    monkeypatch.setattr(credit_ledger, "confirm_reservation", lambda *a, **k: None)
    return spy


def _stored_crop(clip_id: int):
    with get_db_connection() as conn:
        row = conn.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,)).fetchone()
    return decode_data(row["crop_data"])


def test_stale_tab_render_uses_newer_crop_from_other_tab(user_id, render_spy):
    fixture = build_fixture_project(clip_count=1, raw_duration=3.0)
    project_id = fixture["project_id"]
    clip_id = fixture["working_clip_ids"][0]
    headers = {"X-User-ID": user_id, "X-Profile-ID": PROFILE_ID}

    with TestClient(app, headers=headers) as client:
        base = f"/api/clips/projects/{project_id}/clips/{clip_id}"
        # Tab A loaded earlier with its crop at TAB_A_CROP; tab B now moves the crop.
        r_b = client.post(f"{base}/actions", json={"action": "add_crop_keyframe", "data": TAB_B_CROP})
        assert r_b.status_code == 200, r_b.text
        assert _stored_crop(clip_id) == [TAB_B_CROP]

        # Tab A presses render: what an older bundle sends first, then the render itself.
        client.put(base, json={"crop_data": TAB_A_CROP, "segments_data": TAB_A_SEGMENTS})
        r_render = client.post(
            "/api/export/render",
            json={"project_id": project_id, "export_id": f"t4400_{uuid.uuid4().hex}"},
        )
        assert r_render.status_code == 202, r_render.text

    rendered_clip = render_spy.call_args.kwargs["clip"]
    assert decode_data(rendered_clip["crop_data"]) == [TAB_B_CROP]
    assert _stored_crop(clip_id) == [TAB_B_CROP]
