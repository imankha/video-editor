"""
Regression: create_region must persist the editor's SEED keyframes, and
delete_keyframe must be idempotent.

Prod report (2026-07-29): adding a spotlight and then dragging the circle near
the region boundary produced a repeating
``[overlayActions] Action failed: Keyframe at 2.0s not found`` and an
unclearable "Your edits aren't saving -- Retry" toast (Retry re-sent the same
rejected request forever; only a page refresh cleared it).

Root cause chain:
  1. ``useHighlightRegions.addRegion`` materializes TWO boundary keyframes so
     the new region shows a spotlight immediately, but ``create_region`` stored
     ``keyframes: []`` -- the stored region diverged from the visible one.
  2. Dragging near a boundary makes the editor MOVE the seeded boundary
     keyframe onto the current frame; ``persistKeyframeEdit`` mirrors a move as
     delete(old) + add(new), so the delete targeted a keyframe that only ever
     existed in memory -> 400.
  3. Separately, a region stored with no keyframes renders NOTHING: the render
     endpoint's ``has_keyframes`` check skips GPU processing entirely, so a
     spotlight the user added but never dragged vanished from the export.

These tests pin (1) and (2). The frontend halves are pinned in
``overlayActionStore.test.js`` (retryability) and ``OverlayScreen``'s wrapper.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.utils.encoding import decode_data

TEST_USER_ID = f"test_ovseed_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


def _seed_keyframe(time: float) -> dict:
    """A keyframe in the shape the editor sends (defaultHighlightForRegion)."""
    return {
        "time": time,
        "x": 540.0,
        "y": 960.0,
        "radiusX": 115.0,
        "radiusY": 230.0,
        "strokeOpacity": 0.85,
        "fillOpacity": 0.05,
        "color": "#FFFFFF",
    }


@pytest.fixture
def project():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('Seed KF Project', '9:16')"
        )
        project_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO working_videos
                (project_id, filename, version, highlights_data, effect_type, overlay_version)
            VALUES (?, 'test_working.mp4', 1, NULL, 'original', 0)
            """,
            (project_id,),
        )
        working_video_id = cursor.lastrowid
        cursor.execute(
            "UPDATE projects SET working_video_id = ? WHERE id = ?",
            (working_video_id, project_id),
        )
        conn.commit()

        yield project_id

        cursor.execute(
            "UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,)
        )
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _post(project_id: int, body: dict):
    return client.post(
        f"/api/export/projects/{project_id}/overlay/actions", json=body
    )


def _stored_regions(project_id: int) -> list:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT wv.highlights_data
            FROM working_videos wv
            JOIN projects p ON p.working_video_id = wv.id
            WHERE p.id = ?
            """,
            (project_id,),
        )
        row = cursor.fetchone()
    return decode_data(row['highlights_data']) or []


class TestCreateRegionPersistsSeedKeyframes:
    def test_seed_keyframes_are_stored(self, project):
        """The two boundary keyframes the editor shows must reach the DB."""
        resp = _post(project, {
            "action": "create_region",
            "data": {
                "start_time": 0.0,
                "end_time": 2.0,
                "region_id": "region-seeded",
                "keyframes": [_seed_keyframe(0.0), _seed_keyframe(2.0)],
            },
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["success"] is True

        regions = _stored_regions(project)
        assert len(regions) == 1
        kfs = regions[0]["keyframes"]
        # Without this, `has_keyframes` in the render endpoint is False and the
        # export skips overlay rendering entirely -- no spotlight in the video.
        assert [kf["time"] for kf in kfs] == [0.0, 2.0]
        assert kfs[0]["x"] == 540.0
        assert kfs[0]["color"] == "#FFFFFF"

    def test_seed_keyframes_are_sorted_by_time(self, project):
        """Stored order matches the invariant add_keyframe maintains."""
        _post(project, {
            "action": "create_region",
            "data": {
                "start_time": 0.0,
                "end_time": 2.0,
                "region_id": "region-unsorted",
                "keyframes": [_seed_keyframe(2.0), _seed_keyframe(0.0)],
            },
        })
        kfs = _stored_regions(project)[0]["keyframes"]
        assert [kf["time"] for kf in kfs] == [0.0, 2.0]

    def test_create_without_keyframes_still_works(self, project):
        """Callers that send no seed keyframes are unchanged (back-compat)."""
        resp = _post(project, {
            "action": "create_region",
            "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "region-bare"},
        })
        assert resp.status_code == 200
        assert _stored_regions(project)[0]["keyframes"] == []


class TestDeleteKeyframeIsIdempotent:
    def test_delete_absent_keyframe_succeeds(self, project):
        """The exact prod failure: delete a keyframe that was never persisted.

        The postcondition ("no keyframe at 2.0s") already holds, so this is a
        no-op success -- not a 400 that strands the user behind a Retry button
        which can never succeed.
        """
        _post(project, {
            "action": "create_region",
            "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "region-empty"},
        })

        resp = _post(project, {
            "action": "delete_keyframe",
            "target": {"region_id": "region-empty", "keyframe_time": 2.0},
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["success"] is True

    def test_delete_present_keyframe_still_removes_it(self, project):
        """Idempotence must not weaken the real delete."""
        _post(project, {
            "action": "create_region",
            "data": {
                "start_time": 0.0,
                "end_time": 2.0,
                "region_id": "region-full",
                "keyframes": [_seed_keyframe(0.0), _seed_keyframe(2.0)],
            },
        })

        resp = _post(project, {
            "action": "delete_keyframe",
            "target": {"region_id": "region-full", "keyframe_time": 2.0},
        })
        assert resp.status_code == 200
        assert [kf["time"] for kf in _stored_regions(project)[0]["keyframes"]] == [0.0]

    def test_delete_on_missing_region_is_still_an_error(self, project):
        """A wrong region id is a genuine mismatch and must stay visible."""
        resp = _post(project, {
            "action": "delete_keyframe",
            "target": {"region_id": "no-such-region", "keyframe_time": 2.0},
        })
        assert resp.status_code == 400
        assert "not found" in resp.json()["error"]

    def test_snap_move_round_trip(self, project):
        """The full gesture: drag near the boundary -> delete(old) + add(new).

        Reproduces the reported sequence end to end. With seed keyframes stored
        the delete now finds its target; the region ends with the moved keyframe
        at the dragged frame and no orphan at the old boundary.
        """
        _post(project, {
            "action": "create_region",
            "data": {
                "start_time": 0.0,
                "end_time": 2.0,
                "region_id": "region-drag",
                "keyframes": [_seed_keyframe(0.0), _seed_keyframe(2.0)],
            },
        })

        # persistKeyframeEdit mirrors the snap-move as delete(old) then add(new)
        del_resp = _post(project, {
            "action": "delete_keyframe",
            "target": {"region_id": "region-drag", "keyframe_time": 2.0},
        })
        assert del_resp.status_code == 200
        assert del_resp.json()["success"] is True

        add_resp = _post(project, {
            "action": "add_keyframe",
            "target": {"region_id": "region-drag"},
            "data": {**_seed_keyframe(1.9), "x": 300.0},
        })
        assert add_resp.status_code == 200

        kfs = _stored_regions(project)[0]["keyframes"]
        assert [kf["time"] for kf in kfs] == [0.0, 1.9]
        assert kfs[1]["x"] == 300.0
