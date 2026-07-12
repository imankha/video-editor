"""
T4900 / prod bug 31p — overlay keyframe persistence + render read path.

Two things are pinned here:

1. The render read path honours a region's CURRENT (possibly extended) bounds,
   so manual keyframes the user added PAST the original auto-segment boundary are
   NOT clipped at render (failure mode 3 explicitly ruled out). The bounds reader
   is tolerant of both the camelCase blob that surgical overlay actions write and
   the snake_case blob the framing->overlay transform writes.

2. When the surgical overlay actions LAND, the manual keyframes + the extended
   segment survive into the stored blob the render reads (failure mode 1 is a
   persistence gap, not a render bug). The companion test simulates the 31p
   failure — actions that never reached the backend — and shows the DB then holds
   ONLY the original auto keyframe, which is exactly why the render "ignored" the
   user's edits and why the frontend failure-visibility fix matters.
"""

import asyncio
import uuid

import httpx
import pytest

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.routers.export.overlay import (
    _region_bounds,
    _keyframes_within_bounds,
    _normalize_region_keys,
    _get_overlay_data,
)

TEST_USER_ID = f"test_t4900_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

# Drive the real ASGI app (full middleware + handler + DB RMW) via ASGITransport
# — portable across starlette/httpx versions.
_HDRS = {"X-User-ID": TEST_USER_ID}


# --------------------------------------------------------------------------- #
# Unit: render read-path bounds + keyframe filter (no DB)
# --------------------------------------------------------------------------- #

class TestNormalizeRegionKeys:
    """_normalize_region_keys is the DB-read boundary fix for the Modal path.

    video_processing.py uses direct bracket access ``region["start_time"]``
    which KeyErrors on camelCase-only blobs from create_region/update_region.
    Normalizing at render_overlay before dispatch to Modal/local fixes both
    renderers without touching the stored blob.
    """

    def test_camelcase_only_gets_snake_case_aliases(self):
        r = {"startTime": 1.0, "endTime": 5.0, "keyframes": []}
        _normalize_region_keys(r)
        assert r["start_time"] == 1.0 and r["end_time"] == 5.0

    def test_existing_snake_case_not_overwritten(self):
        r = {"start_time": 2.0, "end_time": 4.0, "startTime": 0.0}
        _normalize_region_keys(r)
        # start_time already present — must not be clobbered
        assert r["start_time"] == 2.0

    def test_mixed_blob_snake_takes_priority(self):
        # framing-export blob may have both; snake wins
        r = {"start_time": 1.5, "end_time": 3.0, "startTime": 0.0, "endTime": 0.0}
        _normalize_region_keys(r)
        assert r["start_time"] == 1.5 and r["end_time"] == 3.0


class TestRegionBounds:
    def test_bounds_tolerate_camelcase_action_blob(self):
        # overlay_action writes camelCase startTime/endTime
        assert _region_bounds({"startTime": 1.0, "endTime": 6.0}) == (1.0, 6.0)

    def test_bounds_tolerate_snakecase_transform_blob(self):
        # framing->overlay transform / export payload uses snake_case
        assert _region_bounds({"start_time": 2.0, "end_time": 4.0}) == (2.0, 4.0)

    def test_extended_region_keeps_keyframes_past_original_boundary(self):
        # Region was auto-created 0..2s, user EXTENDED it to 0..6s and added
        # manual keyframes at 3s and 5s (past the original 2s boundary).
        region = {
            "id": "r1",
            "startTime": 0.0,
            "endTime": 6.0,  # extended
            "keyframes": [
                {"time": 0.0}, {"time": 2.0},   # original auto boundaries
                {"time": 3.0}, {"time": 5.0},   # manual, past original range
            ],
        }
        kept = _keyframes_within_bounds(region)
        times = sorted(kf["time"] for kf in kept)
        assert times == [0.0, 2.0, 3.0, 5.0], "extended-segment keyframes must survive"

    def test_keyframe_truly_outside_bounds_is_dropped(self):
        region = {
            "id": "r1", "startTime": 0.0, "endTime": 2.0,
            "keyframes": [{"time": 1.0}, {"time": 9.0}],
        }
        kept = _keyframes_within_bounds(region)
        assert [kf["time"] for kf in kept] == [1.0]


# --------------------------------------------------------------------------- #
# Integration: actions -> stored blob the render reads
# --------------------------------------------------------------------------- #

@pytest.fixture
def project():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T4900 Project', '9:16')"
        )
        project_id = cursor.lastrowid
        cursor.execute(
            """INSERT INTO working_videos
               (project_id, filename, version, highlights_data, effect_type, overlay_version)
               VALUES (?, 'wv.mp4', 1, NULL, 'dark_overlay', 0)""",
            (project_id,),
        )
        wv_id = cursor.lastrowid
        cursor.execute(
            "UPDATE projects SET working_video_id = ? WHERE id = ?", (wv_id, project_id)
        )
        conn.commit()
        yield project_id
        cursor.execute("UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,))
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _post(project_id, body):
    async def _run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            return await c.post(
                f"/api/export/projects/{project_id}/overlay/actions",
                json=body, headers=_HDRS,
            )
    r = asyncio.run(_run())
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True
    return r


def _stored_regions(project_id):
    """Read the blob exactly as the render read path decodes it."""
    with get_db_connection() as conn:
        highlights, *_ = _get_overlay_data(conn.cursor(), project_id)
    return highlights


class TestManualKeyframesSurviveToRender:
    def test_extended_segment_and_manual_keyframes_reach_render_blob(self, project):
        rid = "region-auto-1"
        # Auto region 0..2s
        _post(project, {"action": "create_region",
                        "data": {"start_time": 0.0, "end_time": 2.0, "region_id": rid}})
        # Original auto keyframe
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 0.0, "x": 0.5, "y": 0.5}})
        # User EXTENDS the segment to 0..6s
        _post(project, {"action": "update_region", "target": {"region_id": rid},
                        "data": {"end_time": 6.0}})
        # User adds manual keyframes PAST the original 2s boundary
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 3.0, "x": 0.6, "y": 0.4}})
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 5.0, "x": 0.7, "y": 0.3}})

        regions = _stored_regions(project)
        assert len(regions) == 1
        region = regions[0]

        # Extended bound persisted (this is what prevents render clipping)
        assert _region_bounds(region) == (0.0, 6.0)

        # The render read path keeps ALL keyframes, including the manual ones
        # past the original auto boundary.
        rendered_times = sorted(kf["time"] for kf in _keyframes_within_bounds(region))
        assert rendered_times == [0.0, 3.0, 5.0], (
            "manual keyframes + extended segment must survive to the render payload"
        )

    def test_adjusted_auto_keyframe_position_is_honored(self, project):
        rid = "region-auto-2"
        _post(project, {"action": "create_region",
                        "data": {"start_time": 0.0, "end_time": 2.0, "region_id": rid}})
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 1.0, "x": 0.5, "y": 0.5}})
        # User drags the auto keyframe to a new position (update in place at t=1.0)
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 1.0, "x": 0.9, "y": 0.1}})

        region = _stored_regions(project)[0]
        kf = next(k for k in region["keyframes"] if abs(k["time"] - 1.0) < 0.02)
        assert kf["x"] == 0.9 and kf["y"] == 0.1, "adjusted position must be honored"

    def test_persistence_gap_leaves_only_auto_keyframe(self, project):
        """Simulate the 31p failure: the manual add_keyframe actions never reached
        the backend. The DB then holds ONLY the original auto keyframe, so the
        render 'ignores' the user's manual edits — the exact reported bug."""
        rid = "region-auto-3"
        _post(project, {"action": "create_region",
                        "data": {"start_time": 0.0, "end_time": 2.0, "region_id": rid}})
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 0.0, "x": 0.5, "y": 0.5}})
        # NOTE: the manual keyframe adds + extend are deliberately NOT sent (they
        # "Failed to fetch" in prod). Nothing else touches the blob.

        region = _stored_regions(project)[0]
        rendered_times = sorted(kf["time"] for kf in _keyframes_within_bounds(region))
        assert rendered_times == [0.0], (
            "with the surgical actions lost, the DB keeps only the auto keyframe — "
            "this is why failure visibility (block export + retry) is the real fix"
        )
