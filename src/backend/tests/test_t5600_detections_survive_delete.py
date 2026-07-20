"""
T5600 — player-detection tracking squares survive highlight-region delete.

Detections used to live ONLY inside each region's `detections` array in
`working_videos.highlights_data`, so `delete_region` (`del highlights[idx]`)
destroyed them along with the spotlight span. The fix decouples storage: a
video-level `working_videos.detections_data` column is the canonical store;
`create_region`/`delete_region` are UNCHANGED (they only ever touch
`highlights_data`); `/overlay-data` projects a read-time slice onto each
region.

Covers:
- delete_region leaves detections_data byte-for-byte intact
- /overlay-data slices detections_data onto each region AND returns the flat
  top-level field
- read-time hoist from region-embedded detections when detections_data is NULL
  (deploy-before-migrate window / un-backfilled row)
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.utils.encoding import decode_data, encode_data

TEST_USER_ID = f"test_t5600_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})

VIDEO_DETECTIONS = {
    "videoWidth": 810,
    "videoHeight": 1440,
    "fps": 30,
    "detections": [
        {"timestamp": 0.5, "frame": 15, "boxes": [{"x": 0.1, "y": 0.1, "w": 0.05, "h": 0.1}]},
        {"timestamp": 1.0, "frame": 30, "boxes": [{"x": 0.2, "y": 0.2, "w": 0.05, "h": 0.1}]},
        {"timestamp": 4.0, "frame": 120, "boxes": [{"x": 0.3, "y": 0.3, "w": 0.05, "h": 0.1}]},
    ],
}


@pytest.fixture
def project_with_detections_data():
    """A project whose working_video already has the canonical detections_data
    column populated (post-migration / new-export shape)."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('T5600 Detections Project', '9:16')
        """)
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_videos
                (project_id, filename, version, highlights_data, detections_data, effect_type, overlay_version)
            VALUES (?, 'test_working.mp4', 1, NULL, ?, 'original', 0)
        """, (project_id, encode_data(VIDEO_DETECTIONS)))
        working_video_id = cursor.lastrowid

        cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))
        conn.commit()

        yield project_id

        cursor.execute("UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,))
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _get_detections_data_blob(project_id):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT wv.detections_data FROM working_videos wv "
            "JOIN projects p ON p.working_video_id = wv.id WHERE p.id = ?",
            (project_id,),
        )
        return cursor.fetchone()["detections_data"]


class TestDeletePreservesDetectionsData:
    def test_delete_region_leaves_detections_data_intact(self, project_with_detections_data):
        project_id = project_with_detections_data
        before = _get_detections_data_blob(project_id)
        assert before is not None

        client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "region-to-delete"},
            },
        )
        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={"action": "delete_region", "target": {"region_id": "region-to-delete"}},
        )
        assert response.status_code == 200
        assert response.json()["success"] is True

        after = _get_detections_data_blob(project_id)
        assert after == before  # byte-for-byte unchanged
        assert decode_data(after) == VIDEO_DETECTIONS

        # The spotlight span + its keyframes ARE actually gone -- only tracking
        # is protected, not the region itself.
        overlay_data = client.get(f"/api/export/projects/{project_id}/overlay-data").json()
        region_ids = {r["id"] for r in overlay_data["highlights_data"]}
        assert "region-to-delete" not in region_ids

    def test_create_and_delete_never_touch_detections_data(self, project_with_detections_data):
        """create_region/delete_region only ever write highlights_data -- this
        is the whole point of the decoupled store (design ss(e))."""
        project_id = project_with_detections_data
        before = _get_detections_data_blob(project_id)

        for action, payload in [
            ("create_region", {"data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r1"}}),
            ("create_region", {"data": {"start_time": 3.0, "end_time": 5.0, "region_id": "r2"}}),
            ("delete_region", {"target": {"region_id": "r1"}}),
            ("delete_region", {"target": {"region_id": "r2"}}),
        ]:
            client.post(
                f"/api/export/projects/{project_id}/overlay/actions",
                json={"action": action, **payload},
            )

        assert _get_detections_data_blob(project_id) == before


class TestOverlayDataProjection:
    def test_overlay_data_returns_flat_field_and_projects_region_slice(self, project_with_detections_data):
        project_id = project_with_detections_data

        client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={"action": "create_region", "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r-early"}},
        )
        client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={"action": "create_region", "data": {"start_time": 3.5, "end_time": 4.5, "region_id": "r-late"}},
        )

        response = client.get(f"/api/export/projects/{project_id}/overlay-data")
        assert response.status_code == 200
        data = response.json()

        # Top-level flat payload, additive on the existing response shape
        assert data["detections_data"] == VIDEO_DETECTIONS

        regions_by_id = {r["id"]: r for r in data["highlights_data"]}
        early = regions_by_id["r-early"]
        late = regions_by_id["r-late"]

        # r-early [0, 2] should slice the 0.5s and 1.0s detections, not the 4.0s one
        early_timestamps = sorted(d["timestamp"] for d in early["detections"])
        assert early_timestamps == [0.5, 1.0]
        assert early["videoWidth"] == 810
        assert early["videoHeight"] == 1440
        assert early["fps"] == 30

        # r-late [3.5, 4.5] should slice only the 4.0s detection
        late_timestamps = sorted(d["timestamp"] for d in late["detections"])
        assert late_timestamps == [4.0]

    def test_deleted_region_span_recreated_shows_same_detections_again(self, project_with_detections_data):
        """The reported bug, end to end: delete a region, recreate one over the
        SAME span, and its tracking squares are back (server projection)."""
        project_id = project_with_detections_data

        client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={"action": "create_region", "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r-1"}},
        )
        client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={"action": "delete_region", "target": {"region_id": "r-1"}},
        )
        client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={"action": "create_region", "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r-1-again"}},
        )

        response = client.get(f"/api/export/projects/{project_id}/overlay-data")
        data = response.json()
        region = next(r for r in data["highlights_data"] if r["id"] == "r-1-again")
        assert sorted(d["timestamp"] for d in region["detections"]) == [0.5, 1.0]


class TestReadTimeHoistFallback:
    def test_hoists_from_region_detections_when_detections_data_is_null(self):
        """A row that predates the migration (or the migration couldn't
        backfill it) has detections_data NULL -- /overlay-data must hoist a
        flat payload from the regions' embedded detections at READ time,
        without persisting it."""
        set_current_user_id(TEST_USER_ID)
        set_current_profile_id(TEST_PROFILE_ID)

        legacy_regions = [
            {
                "id": "legacy-region",
                "startTime": 0.0,
                "endTime": 2.0,
                "enabled": True,
                "keyframes": [],
                "detections": [
                    {"timestamp": 0.5, "frame": 15, "boxes": [{"x": 0.1, "y": 0.1}]},
                ],
                "videoWidth": 640,
                "videoHeight": 1136,
                "fps": 30,
            }
        ]

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T5600 Legacy Project', '9:16')")
            project_id = cursor.lastrowid
            cursor.execute("""
                INSERT INTO working_videos
                    (project_id, filename, version, highlights_data, detections_data, effect_type, overlay_version)
                VALUES (?, 'legacy.mp4', 1, ?, NULL, 'original', 0)
            """, (project_id, encode_data(legacy_regions)))
            working_video_id = cursor.lastrowid
            cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))
            conn.commit()

        try:
            response = client.get(f"/api/export/projects/{project_id}/overlay-data")
            assert response.status_code == 200
            data = response.json()

            assert data["detections_data"] is not None
            assert data["detections_data"]["videoWidth"] == 640
            assert [d["timestamp"] for d in data["detections_data"]["detections"]] == [0.5]

            region = data["highlights_data"][0]
            assert [d["timestamp"] for d in region["detections"]] == [0.5]

            # Read-only: the DB row must still be NULL, the migration owns persistence
            assert _get_detections_data_blob(project_id) is None
        finally:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,))
                cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
                cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
                conn.commit()
