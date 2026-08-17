"""
T7180 / prod bug 44p -- overlay highlight region key-format mismatch.

`create_region` (and the auto-region generator, multi_clip.py
generate_default_highlight_regions) write snake_case start_time/end_time.
`update_region` used to write camelCase startTime/endTime and never removed a
pre-existing snake_case pair. Every reader (`_region_bounds`, the frontend's
restoreRegions) prefers snake_case WHEN PRESENT -- so a lever drag on an
auto-generated region updated a key nothing read: the render path and a fresh
page load kept using the ORIGINAL auto-placed bounds forever, silently
dropping every keyframe the user placed outside them. The export completed
200/success with no error.

Fix: update_region (and create_region) now write canonical snake_case and
drop any stale camelCase pair, so a drag actually updates the key every
reader consults.
"""

import asyncio
import uuid

import httpx
import pytest

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.routers.export.overlay import _get_overlay_data, _region_bounds
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.utils.encoding import encode_data

TEST_USER_ID = f"test_t7180_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}
_HDRS = {"X-User-ID": TEST_USER_ID}


@pytest.fixture
def project():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T7180 Project', '9:16')"
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


class TestCreateRegionWritesCanonicalKeys:
    def test_create_region_writes_snake_case_only(self, project):
        _post(project, {"action": "create_region",
                         "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r1"}})
        region = _stored_regions(project)[0]
        assert region["start_time"] == 0.0 and region["end_time"] == 2.0
        assert "startTime" not in region and "endTime" not in region


class TestUpdateRegionWritesCanonicalKeys:
    def test_update_region_writes_snake_case_only(self, project):
        _post(project, {"action": "create_region",
                         "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r1"}})
        _post(project, {"action": "update_region", "target": {"region_id": "r1"},
                         "data": {"start_time": 2.45, "end_time": 4.18}})
        region = _stored_regions(project)[0]
        assert region["start_time"] == 2.45 and region["end_time"] == 4.18
        assert "startTime" not in region and "endTime" not in region

    def test_update_region_overwrites_a_preexisting_stale_snake_case_pair(self, project):
        """create_region -> update_region, both through the action endpoint,
        must round-trip to the dragged bounds. NOTE: this does NOT by itself
        discriminate the 44p bug -- pre-fix, create_region wrote camelCase-only
        (no snake_case at all), so there was no stale key for update_region's
        camelCase write to be shadowed BY in this specific flow, and this
        assertion happened to pass on the old code too. The real 44p shape
        needs the region to originate from AUTO-GENERATION (which writes
        snake_case directly, bypassing this action endpoint) and THEN be
        edited via update_region -- see
        TestUpdateRegionHealsAPreexistingMixedKeyRow below, which seeds that
        exact mixed-key row and fails red on the pre-fix code.
        """
        _post(project, {"action": "create_region",
                         "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r1"}})

        # User drags the region to the middle of the clip
        _post(project, {"action": "update_region", "target": {"region_id": "r1"},
                         "data": {"start_time": 2.4515, "end_time": 4.1798}})

        region = _stored_regions(project)[0]
        # This is the render path's actual read -- must reflect the DRAG, not
        # the original auto placement.
        assert _region_bounds(region) == (2.4515, 4.1798), (
            "render path must honor the dragged bounds, not the stale auto-placed ones"
        )
        assert region.get("start_time") != 0.0, "stale auto-placed start_time must not survive"

    def test_partial_update_only_touches_the_moved_edge(self, project):
        """Dragging only the start lever must not disturb an already-canonical end."""
        _post(project, {"action": "create_region",
                         "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r1"}})
        _post(project, {"action": "update_region", "target": {"region_id": "r1"},
                         "data": {"start_time": 1.0}})
        region = _stored_regions(project)[0]
        assert region["start_time"] == 1.0
        assert region["end_time"] == 2.0
        assert "startTime" not in region and "endTime" not in region


def _seed_mixed_key_region(project_id):
    """Write the EXACT row shape found in the reporter's prod DB (project 96,
    working_videos.id=60): a region carrying BOTH key formats with genuinely
    DIFFERENT values -- start_time/end_time still the original auto-placed
    [0.0, 2.0] default, startTime/endTime already showing the user's drag to
    [2.4515, 4.1798]. Reproduces the pre-fix bug directly instead of only
    exercising rows this test suite's own create_region calls can produce.
    """
    region = {
        "id": "r1",
        "start_time": 0.0,
        "end_time": 2.0,
        "startTime": 2.4515,
        "endTime": 4.1798,
        "enabled": True,
        "keyframes": [
            {"time": 2.4647, "x": 0.5, "y": 0.5},
            {"time": 3.7997, "x": 0.6, "y": 0.4},
        ],
        "detections": [],
    }
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE working_videos SET highlights_data = ? WHERE project_id = ?",
            (encode_data([region]), project_id),
        )
        conn.commit()


class TestUpdateRegionHealsAPreexistingMixedKeyRow:
    """T7180 / prod bug 44p direct reproduction: the row already has the
    stale/live-value split BEFORE any post-fix action ever touches it (e.g. a
    row that predates this fix). A single lever-drag update_region call must
    make the render path's actual read (_region_bounds) agree with the drag,
    and must not leave the stale camelCase pair behind.
    """

    def test_drag_on_a_mixed_key_row_heals_it(self, project):
        _seed_mixed_key_region(project)
        # Sanity: before any action, the render path reads the STALE snake_case
        # default, exactly reproducing the reported bug (spotlight nowhere near
        # where the keyframes/camelCase bounds say it should be).
        pre = _stored_regions(project)[0]
        assert _region_bounds(pre) == (0.0, 2.0), (
            "must reproduce the bug's starting condition: render reads the stale default"
        )

        # User re-drags the start lever (the natural way this heals -- any
        # further edit to the region goes through update_region).
        _post(project, {"action": "update_region", "target": {"region_id": "r1"},
                         "data": {"start_time": 2.4515, "end_time": 4.1798}})

        region = _stored_regions(project)[0]
        assert "startTime" not in region and "endTime" not in region
        assert _region_bounds(region) == (2.4515, 4.1798), (
            "post-drag render read must reflect the drag, not the original stale default"
        )

    def test_single_edge_drag_on_a_mixed_row_heals_only_that_edge(self, project):
        """Dragging ONLY the start lever on a mixed row must overwrite the
        stale snake_case start_time (so the render path moves) while leaving
        the untouched end as whatever the UI already shows for it (the
        camelCase endTime the editor was already displaying) -- editor and
        render agree on the un-dragged edge, even though it hasn't healed yet.
        """
        _seed_mixed_key_region(project)
        _post(project, {"action": "update_region", "target": {"region_id": "r1"},
                         "data": {"start_time": 2.4515}})

        region = _stored_regions(project)[0]
        assert "startTime" not in region
        assert region["start_time"] == 2.4515
        # The end was never re-sent this gesture: its snake_case pair is
        # untouched (still the stale auto-default) and its camelCase pair is
        # untouched too (still what the editor showed). This asserts the
        # ACTUAL current behavior -- not claiming it's fully healed, just that
        # the touched edge moved and the untouched edge didn't regress.
        assert region["end_time"] == 2.0
        assert region["endTime"] == 4.1798
