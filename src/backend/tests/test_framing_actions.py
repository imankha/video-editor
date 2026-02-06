"""
Tests for gesture-based framing actions API.

These tests verify the atomic action endpoints work correctly
for framing modifications (crop keyframes, segments, trim).
"""

import pytest
import json
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db_connection


client = TestClient(app)


@pytest.fixture
def test_project_with_clip():
    """Create a test project with a working clip for framing testing."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('Test Framing Project', '9:16')
        """)
        project_id = cursor.lastrowid

        # Create working clip with empty framing data
        # Schema uses: crop_data, segments_data (not crop_keyframes, segments)
        cursor.execute("""
            INSERT INTO working_clips (
                project_id, uploaded_filename, version,
                crop_data, segments_data
            )
            VALUES (?, 'test_clip.mp4', 1, '[]', '{}')
        """, (project_id,))
        clip_id = cursor.lastrowid

        conn.commit()

        yield project_id, clip_id

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


class TestFramingActions:
    """Test framing action endpoints."""

    def test_add_crop_keyframe(self, test_project_with_clip):
        """Test adding a crop keyframe."""
        project_id, clip_id = test_project_with_clip

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "add_crop_keyframe",
                "data": {
                    "frame": 0,
                    "x": 100,
                    "y": 50,
                    "width": 1080,
                    "height": 1920,
                    "origin": "user"
                }
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        # Verify keyframe was added
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            row = cursor.fetchone()
            keyframes = json.loads(row[0])
            assert len(keyframes) == 1
            assert keyframes[0]["frame"] == 0
            assert keyframes[0]["x"] == 100

    def test_update_crop_keyframe(self, test_project_with_clip):
        """Test updating an existing crop keyframe."""
        project_id, clip_id = test_project_with_clip

        # First add a keyframe
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "add_crop_keyframe",
                "data": {"frame": 30, "x": 100, "y": 50, "width": 1080, "height": 1920, "origin": "user"}
            }
        )

        # Update it
        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "update_crop_keyframe",
                "target": {"frame": 30},
                "data": {"x": 200, "y": 100}
            }
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify update
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            keyframes = json.loads(cursor.fetchone()[0])
            assert keyframes[0]["x"] == 200
            assert keyframes[0]["y"] == 100

    def test_delete_crop_keyframe(self, test_project_with_clip):
        """Test deleting a crop keyframe."""
        project_id, clip_id = test_project_with_clip

        # Add two keyframes
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 0, "x": 100, "y": 50, "width": 1080, "height": 1920, "origin": "user"}}
        )
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 60, "x": 200, "y": 100, "width": 1080, "height": 1920, "origin": "user"}}
        )

        # Delete the first
        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "delete_crop_keyframe",
                "target": {"frame": 0}
            }
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify deletion
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            keyframes = json.loads(cursor.fetchone()[0])
            assert len(keyframes) == 1
            assert keyframes[0]["frame"] == 60

    def test_move_crop_keyframe(self, test_project_with_clip):
        """Test moving a crop keyframe to a new frame."""
        project_id, clip_id = test_project_with_clip

        # Add keyframe
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 30, "x": 100, "y": 50, "width": 1080, "height": 1920, "origin": "user"}}
        )

        # Move it
        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "move_crop_keyframe",
                "target": {"frame": 30},
                "data": {"frame": 45}
            }
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify move
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            keyframes = json.loads(cursor.fetchone()[0])
            assert keyframes[0]["frame"] == 45

    def test_split_segment(self, test_project_with_clip):
        """Test splitting a segment at a specific time."""
        project_id, clip_id = test_project_with_clip

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "split_segment",
                "data": {"time": 2.5}
            }
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify segment data
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT segments_data FROM working_clips WHERE id = ?", (clip_id,))
            segments = json.loads(cursor.fetchone()[0])
            assert "boundaries" in segments
            assert 2.5 in segments["boundaries"]

    def test_remove_segment_split(self, test_project_with_clip):
        """Test removing a segment split."""
        project_id, clip_id = test_project_with_clip

        # First create a split
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "split_segment", "data": {"time": 2.5}}
        )

        # Remove it
        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "remove_segment_split",
                "data": {"time": 2.5}
            }
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify removal
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT segments_data FROM working_clips WHERE id = ?", (clip_id,))
            segments = json.loads(cursor.fetchone()[0])
            assert 2.5 not in segments.get("boundaries", [])

    def test_set_segment_speed(self, test_project_with_clip):
        """Test setting segment speed."""
        project_id, clip_id = test_project_with_clip

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "set_segment_speed",
                "target": {"segment_index": 0},
                "data": {"speed": 0.5}
            }
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify speed was set
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT segments_data FROM working_clips WHERE id = ?", (clip_id,))
            segments = json.loads(cursor.fetchone()[0])
            assert segments["segmentSpeeds"]["0"] == 0.5

    def test_set_trim_range(self, test_project_with_clip):
        """Test setting the trim range."""
        project_id, clip_id = test_project_with_clip

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "set_trim_range",
                "data": {"start": 1.0, "end": 5.0}
            }
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify trim range
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT segments_data FROM working_clips WHERE id = ?", (clip_id,))
            segments = json.loads(cursor.fetchone()[0])
            assert segments["trimRange"]["start"] == 1.0
            assert segments["trimRange"]["end"] == 5.0

    def test_clear_trim_range(self, test_project_with_clip):
        """Test clearing the trim range."""
        project_id, clip_id = test_project_with_clip

        # First set a trim range
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "set_trim_range", "data": {"start": 1.0, "end": 5.0}}
        )

        # Clear it
        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "clear_trim_range"}
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify cleared
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT segments_data FROM working_clips WHERE id = ?", (clip_id,))
            segments = json.loads(cursor.fetchone()[0])
            assert segments.get("trimRange") is None

    def test_invalid_action_fails(self, test_project_with_clip):
        """Test that invalid action returns error."""
        project_id, clip_id = test_project_with_clip

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "invalid_action"}
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Unknown action" in data["error"]

    def test_update_nonexistent_keyframe_fails(self, test_project_with_clip):
        """Test that updating non-existent keyframe returns error."""
        project_id, clip_id = test_project_with_clip

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "update_crop_keyframe",
                "target": {"frame": 999},
                "data": {"x": 100}
            }
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "not found" in data["error"]
