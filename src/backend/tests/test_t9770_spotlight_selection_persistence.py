"""
T9770 — Spotlight (player-selection) persistence.

Which player is "selected" in Overlay is derived entirely from whether a
highlight region's keyframes carry a ``fromDetection: True`` marker at the
detected player's timestamp (frontend detectionAssignment.js). The
add_keyframe handler has two branches:

  * CREATE (no keyframe at this time): already writes fromDetection.
  * UPDATE (a keyframe already exists within _find_keyframe_index's 0.02s
    tolerance): historically set position/style but NEVER fromDetection.

A player-selection click anchors the keyframe to the detection's exact
timestamp; when that lands within 0.02s of a boundary scaffold keyframe the
region was seeded with, the UPDATE branch fires and silently dropped
fromDetection — so on reload the boundary keyframe read as unassigned and
"Pick your player" resurfaced (reported journeys E40/E55).

These tests pin the UPDATE branch now writing fromDetection, the CREATE
branch being unchanged, and legacy keyframes (no fromDetection key at all)
still reading as unassigned rather than a false positive.
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
from app.routers.export.overlay import _get_overlay_data

TEST_USER_ID = f"test_t9770_{uuid.uuid4().hex[:8]}"
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
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T9770 Project', '9:16')"
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
    with get_db_connection() as conn:
        highlights, *_ = _get_overlay_data(conn.cursor(), project_id)
    return highlights


def _kf_at(region, t, tol=0.02):
    return next(k for k in region["keyframes"] if abs(k["time"] - t) <= tol)


class TestSpotlightSelectionPersists:
    def test_selection_on_boundary_keyframe_keeps_fromDetection(self, project):
        """The exact reported bug: the player-selection click's detection
        timestamp lands within tolerance of an existing (boundary scaffold)
        keyframe, so add_keyframe takes the UPDATE branch. fromDetection must
        survive so isDetectionAssigned reads it as assigned on reload."""
        rid = "region-spotlight"
        # Region seeded with a boundary keyframe at its start (scaffold), no
        # fromDetection — exactly what useHighlightRegions.addRegion materializes.
        _post(project, {"action": "create_region",
                        "data": {"start_time": 1.0, "end_time": 3.0, "region_id": rid}})
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 1.0, "x": 0.5, "y": 0.5}})

        # Player selection anchors to the detection timestamp (1.01s), which
        # collides with the 1.0s boundary keyframe (< 0.02s) -> UPDATE branch.
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 1.01, "x": 0.72, "y": 0.34, "fromDetection": True}})

        region = _stored_regions(project)[0]
        kf = _kf_at(region, 1.0)
        assert kf.get("fromDetection") is True, (
            "selection landing on a boundary keyframe must persist fromDetection"
        )
        # Position was also updated to the selected player's location.
        assert kf["x"] == 0.72 and kf["y"] == 0.34

    def test_create_branch_still_writes_fromDetection(self, project):
        """Non-colliding case: a brand-new keyframe time still takes the CREATE
        branch and writes fromDetection as before (no regression)."""
        rid = "region-create"
        _post(project, {"action": "create_region",
                        "data": {"start_time": 0.0, "end_time": 4.0, "region_id": rid}})
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 2.0, "x": 0.6, "y": 0.4, "fromDetection": True}})

        region = _stored_regions(project)[0]
        assert _kf_at(region, 2.0).get("fromDetection") is True

    def test_update_without_fromDetection_does_not_clear_existing(self, project):
        """A later position-only edit (no fromDetection in payload) must not
        clear a previously-set marker — the write is additive-only."""
        rid = "region-additive"
        _post(project, {"action": "create_region",
                        "data": {"start_time": 0.0, "end_time": 4.0, "region_id": rid}})
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 2.0, "x": 0.6, "y": 0.4, "fromDetection": True}})
        # Drag the same keyframe (position-only, no fromDetection).
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 2.0, "x": 0.9, "y": 0.1}})

        kf = _kf_at(_stored_regions(project)[0], 2.0)
        assert kf.get("fromDetection") is True, "additive write must not clear the marker"
        assert kf["x"] == 0.9 and kf["y"] == 0.1

    def test_legacy_keyframe_has_no_fromDetection_key(self, project):
        """An ordinary keyframe never touched by a selection must NOT gain a
        fromDetection key — legacy/unassigned data reads as unassigned via
        `!kf.fromDetection` (undefined), never a false positive."""
        rid = "region-legacy"
        _post(project, {"action": "create_region",
                        "data": {"start_time": 0.0, "end_time": 4.0, "region_id": rid}})
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 1.0, "x": 0.5, "y": 0.5}})
        _post(project, {"action": "add_keyframe", "target": {"region_id": rid},
                        "data": {"time": 1.0, "x": 0.3, "y": 0.7}})  # update, still no marker

        kf = _kf_at(_stored_regions(project)[0], 1.0)
        assert "fromDetection" not in kf, (
            "unselected keyframe must not invent a fromDetection marker"
        )
