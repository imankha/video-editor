"""
Bug reproduction tests: archive/restore data loss.

Two user-reported bugs:
1. "Overlay is missing when reopening draft of reel from My Reels"
2. "Keyframes missing when reopening reel draft from My Reels"

Tests the full roundtrip including the API endpoints the frontend calls:
- GET /api/clips/projects/{id}/clips → crop_data, segments_data
- GET /api/export/projects/{id}/overlay-data → highlights_data
"""

import pytest
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.utils.encoding import decode_data, encode_data
from app.session_init import _init_cache

TEST_USER_ID = f"test_archive_bugs_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def project_with_overlay_and_framing():
    """Create a project with crop keyframes, segments, AND overlay highlights."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('Archive Restore Bug Test', '9:16')
        """)
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (
                project_id, uploaded_filename, version,
                crop_data, segments_data
            )
            VALUES (?, 'test_clip.mp4', 1, NULL, NULL)
        """, (project_id,))
        clip_id = cursor.lastrowid

        # Create working_video with highlights_data
        highlights = [
            {
                "id": "region-test001",
                "startTime": 1.0,
                "endTime": 4.0,
                "enabled": True,
                "keyframes": [
                    {"time": 1.0, "x": 0.5, "y": 0.5, "radiusX": 0.2, "radiusY": 0.3, "opacity": 1.0},
                    {"time": 3.0, "x": 0.6, "y": 0.4, "radiusX": 0.25, "radiusY": 0.35, "opacity": 0.8},
                ],
                "detections": [
                    {"frame": 30, "boxes": [{"x": 100, "y": 200, "w": 50, "h": 100}]},
                ],
            },
            {
                "id": "region-test002",
                "startTime": 5.0,
                "endTime": 8.0,
                "enabled": True,
                "keyframes": [],
                "detections": [],
            },
        ]

        cursor.execute("""
            INSERT INTO working_videos (
                project_id, filename, version, highlights_data,
                effect_type, highlight_color, overlay_version, duration
            )
            VALUES (?, 'working_test.mp4', 1, ?, 'brightness_boost', '#ff0000', 3, 10.0)
        """, (project_id, encode_data(highlights)))
        working_video_id = cursor.lastrowid

        # Set working_video_id FK on project
        cursor.execute(
            "UPDATE projects SET working_video_id = ? WHERE id = ?",
            (working_video_id, project_id)
        )

        conn.commit()

        # Add crop keyframes via action API
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {
                "frame": 0, "x": 100, "y": 50, "width": 1080, "height": 1920, "origin": "user"
            }}
        )
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {
                "frame": 60, "x": 200, "y": 100, "width": 1080, "height": 1920, "origin": "user"
            }}
        )

        # Set trim and segment speed
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "set_trim_range", "data": {"start": 1.5, "end": 8.0}}
        )
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "set_segment_speed", "target": {"segment_index": 0}, "data": {"speed": 0.5}}
        )

        yield project_id, clip_id, working_video_id

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM final_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


class TestOverlayDataAfterRestore:
    """Bug: Overlay is missing when reopening draft of reel from My Reels."""

    def test_overlay_data_endpoint_returns_data_after_restore(self, project_with_overlay_and_framing):
        """GET /api/export/projects/{id}/overlay-data should return highlights after restore."""
        project_id, clip_id, working_video_id = project_with_overlay_and_framing

        from app.services.project_archive import archive_project, restore_project
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled, skipping archive/restore test")

        # Verify overlay data exists before archive
        response_before = client.get(f"/api/export/projects/{project_id}/overlay-data")
        assert response_before.status_code == 200
        before = response_before.json()
        assert before["has_data"] is True
        assert len(before["highlights_data"]) == 2
        assert before["highlights_data"][0]["id"] == "region-test001"
        assert before["effect_type"] == "brightness_boost"
        assert before["highlight_color"] == "#ff0000"

        # Archive
        assert archive_project(project_id, TEST_USER_ID) is True

        # Verify data deleted from DB
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM working_videos WHERE project_id = ?", (project_id,))
            assert cursor.fetchone()[0] == 0

        # Restore
        assert restore_project(project_id, TEST_USER_ID) is True

        # Verify overlay data endpoint returns data after restore
        response_after = client.get(f"/api/export/projects/{project_id}/overlay-data")
        assert response_after.status_code == 200
        after = response_after.json()

        assert after["has_data"] is True, \
            f"Overlay data missing after restore. Response: {after}"
        assert len(after["highlights_data"]) == 2, \
            f"Expected 2 highlight regions, got {len(after['highlights_data'])}. Response: {after}"
        assert after["highlights_data"][0]["id"] == "region-test001"
        assert after["effect_type"] == "brightness_boost"
        assert after["highlight_color"] == "#ff0000"

    def test_highlights_keyframes_survive_roundtrip(self, project_with_overlay_and_framing):
        """Highlight region keyframes (time, x, y, radius, opacity) must survive archive/restore."""
        project_id, clip_id, working_video_id = project_with_overlay_and_framing

        from app.services.project_archive import archive_project, restore_project
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled")

        # Snapshot before
        response_before = client.get(f"/api/export/projects/{project_id}/overlay-data")
        before_regions = response_before.json()["highlights_data"]

        archive_project(project_id, TEST_USER_ID)
        restore_project(project_id, TEST_USER_ID)

        # Compare after
        response_after = client.get(f"/api/export/projects/{project_id}/overlay-data")
        after_regions = response_after.json()["highlights_data"]

        assert len(after_regions) == len(before_regions)
        for before_r, after_r in zip(before_regions, after_regions):
            assert after_r["id"] == before_r["id"]
            assert after_r["startTime"] == before_r["startTime"]
            assert after_r["endTime"] == before_r["endTime"]
            assert after_r["enabled"] == before_r["enabled"]
            assert after_r["keyframes"] == before_r["keyframes"], \
                f"Keyframes mismatch for region {before_r['id']}:\n  before: {before_r['keyframes']}\n  after: {after_r['keyframes']}"
            assert after_r["detections"] == before_r["detections"], \
                f"Detections mismatch for region {before_r['id']}:\n  before: {before_r['detections']}\n  after: {after_r['detections']}"

    def test_highlights_data_stored_as_msgpack_after_restore(self, project_with_overlay_and_framing):
        """After restore, highlights_data should be msgpack bytes in DB, not JSON string."""
        project_id, clip_id, working_video_id = project_with_overlay_and_framing

        from app.services.project_archive import archive_project, restore_project
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled")

        archive_project(project_id, TEST_USER_ID)
        restore_project(project_id, TEST_USER_ID)

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT highlights_data FROM working_videos
                WHERE project_id = ? ORDER BY version DESC LIMIT 1
            """, (project_id,))
            row = cursor.fetchone()

        assert row is not None, "Working video should exist after restore"
        raw = row[0]
        assert raw is not None, "highlights_data should not be None after restore"
        assert isinstance(raw, bytes), \
            f"highlights_data should be bytes after restore, got {type(raw).__name__}: {repr(raw)[:100]}"

        highlights = decode_data(raw)
        assert isinstance(highlights, list)
        assert len(highlights) == 2
        assert highlights[0]["id"] == "region-test001"


class TestKeyframesAfterRestore:
    """Bug: Keyframes missing when reopening reel draft from My Reels."""

    def test_crop_keyframes_via_clips_endpoint_after_restore(self, project_with_overlay_and_framing):
        """GET /api/clips/projects/{id}/clips should return crop_data after restore."""
        project_id, clip_id, working_video_id = project_with_overlay_and_framing

        from app.services.project_archive import archive_project, restore_project
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled")

        # Snapshot before
        response_before = client.get(f"/api/clips/projects/{project_id}/clips")
        assert response_before.status_code == 200
        clip_before = next(c for c in response_before.json() if c["id"] == clip_id)
        assert isinstance(clip_before["crop_data"], list)
        assert len(clip_before["crop_data"]) == 2

        # Archive + restore
        assert archive_project(project_id, TEST_USER_ID) is True
        assert restore_project(project_id, TEST_USER_ID) is True

        # Verify after
        response_after = client.get(f"/api/clips/projects/{project_id}/clips")
        assert response_after.status_code == 200
        clips_after = response_after.json()
        assert len(clips_after) >= 1, "Should have at least one clip after restore"

        clip_after = clips_after[0]
        assert isinstance(clip_after["crop_data"], list), \
            f"crop_data should be list after restore, got {type(clip_after['crop_data']).__name__}: {repr(clip_after['crop_data'])[:100]}"
        assert len(clip_after["crop_data"]) == 2, \
            f"Expected 2 crop keyframes, got {len(clip_after['crop_data'])}"
        assert clip_after["crop_data"][0]["frame"] == 0
        assert clip_after["crop_data"][0]["x"] == 100
        assert clip_after["crop_data"][1]["frame"] == 60

    def test_segments_data_via_clips_endpoint_after_restore(self, project_with_overlay_and_framing):
        """GET /api/clips/projects/{id}/clips should return segments_data after restore."""
        project_id, clip_id, working_video_id = project_with_overlay_and_framing

        from app.services.project_archive import archive_project, restore_project
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled")

        # Archive + restore
        archive_project(project_id, TEST_USER_ID)
        restore_project(project_id, TEST_USER_ID)

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()
        clip = clips[0]

        assert isinstance(clip["segments_data"], dict), \
            f"segments_data should be dict after restore, got {type(clip['segments_data']).__name__}"
        assert clip["segments_data"]["trimRange"]["start"] == 1.5
        assert clip["segments_data"]["trimRange"]["end"] == 8.0
        assert clip["segments_data"]["segmentSpeeds"]["0"] == 0.5

    def test_working_video_id_fk_restored(self, project_with_overlay_and_framing):
        """Project.working_video_id FK should point to a valid working_video after restore."""
        project_id, clip_id, working_video_id = project_with_overlay_and_framing

        from app.services.project_archive import archive_project, restore_project
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled")

        archive_project(project_id, TEST_USER_ID)
        restore_project(project_id, TEST_USER_ID)

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT working_video_id, archived_at FROM projects WHERE id = ?", (project_id,))
            project = cursor.fetchone()

        assert project["archived_at"] is None, "archived_at should be cleared after restore"
        assert project["working_video_id"] is not None, "working_video_id should be set after restore"

        # Verify the FK points to an actual working_video
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM working_videos WHERE id = ?", (project["working_video_id"],))
            wv = cursor.fetchone()

        assert wv is not None, \
            f"working_video_id={project['working_video_id']} points to non-existent row"


class TestRestoreEndpointIntegration:
    """Test the full restore-project endpoint (same path as frontend)."""

    def test_restore_endpoint_returns_project_with_data(self, project_with_overlay_and_framing):
        """POST /api/downloads/{id}/restore-project should restore all data."""
        project_id, clip_id, working_video_id = project_with_overlay_and_framing

        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled")

        # Create a final_video (required for the downloads restore endpoint)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO final_videos (project_id, filename, version, published_at)
                VALUES (?, 'final_test.mp4', 1, CURRENT_TIMESTAMP)
            """, (project_id,))
            final_video_id = cursor.lastrowid
            cursor.execute(
                "UPDATE projects SET final_video_id = ? WHERE id = ?",
                (final_video_id, project_id)
            )
            conn.commit()

        # Publish (archives the project)
        response = client.post(f"/api/downloads/publish/{project_id}")
        assert response.status_code == 200

        # Verify archived
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT archived_at FROM projects WHERE id = ?", (project_id,))
            assert cursor.fetchone()["archived_at"] is not None

        # Restore via the downloads endpoint (same as frontend)
        response = client.post(f"/api/downloads/{final_video_id}/restore-project")
        assert response.status_code == 200
        result = response.json()
        assert result["project_id"] == project_id

        # Now check both overlay and framing data exist
        overlay_response = client.get(f"/api/export/projects/{project_id}/overlay-data")
        assert overlay_response.status_code == 200
        overlay = overlay_response.json()
        assert overlay["has_data"] is True, \
            f"Overlay data missing after restore via endpoint. Response: {overlay}"
        assert len(overlay["highlights_data"]) == 2

        clips_response = client.get(f"/api/clips/projects/{project_id}/clips")
        assert clips_response.status_code == 200
        clips = clips_response.json()
        assert len(clips) >= 1
        assert isinstance(clips[0]["crop_data"], list)
        assert len(clips[0]["crop_data"]) == 2
