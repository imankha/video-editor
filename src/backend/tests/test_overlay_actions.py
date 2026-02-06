"""
Tests for gesture-based overlay actions API.

These tests verify the atomic action endpoints work correctly
for overlay modifications.
"""

import pytest
import json
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db_connection


client = TestClient(app)


@pytest.fixture
def test_project_with_working_video():
    """Create a test project with working video for overlay testing."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('Test Overlay Project', '9:16')
        """)
        project_id = cursor.lastrowid

        # Create working video with empty highlights
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename, version, highlights_data, effect_type, overlay_version)
            VALUES (?, 'test_working.mp4', 1, '[]', 'original', 0)
        """, (project_id,))
        working_video_id = cursor.lastrowid

        # Link project to working video
        cursor.execute("""
            UPDATE projects SET working_video_id = ? WHERE id = ?
        """, (working_video_id, project_id))

        conn.commit()

        yield project_id

        # Cleanup
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


class TestOverlayActions:
    """Test overlay action endpoints."""

    def test_create_region(self, test_project_with_working_video):
        """Test creating a highlight region."""
        project_id = test_project_with_working_video

        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {
                    "start_time": 0.0,
                    "end_time": 2.0,
                    "region_id": "test-region-123"
                }
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["version"] == 1
        assert data["region_id"] == "test-region-123"

    def test_create_region_and_delete(self, test_project_with_working_video):
        """Test creating and then deleting a region."""
        project_id = test_project_with_working_video

        # Create
        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {
                    "start_time": 0.0,
                    "end_time": 2.0,
                    "region_id": "region-to-delete"
                }
            }
        )
        assert response.status_code == 200
        assert response.json()["version"] == 1

        # Delete
        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "delete_region",
                "target": {"region_id": "region-to-delete"}
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["version"] == 2

    def test_add_keyframe_to_region(self, test_project_with_working_video):
        """Test adding a keyframe to a region."""
        project_id = test_project_with_working_video

        # First create a region
        client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {
                    "start_time": 0.0,
                    "end_time": 2.0,
                    "region_id": "region-for-keyframes"
                }
            }
        )

        # Add keyframe
        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "add_keyframe",
                "target": {"region_id": "region-for-keyframes"},
                "data": {
                    "time": 1.0,
                    "x": 0.5,
                    "y": 0.5,
                    "radiusX": 0.1,
                    "radiusY": 0.15,
                    "opacity": 0.3,
                    "color": "#FFFF00"
                }
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["version"] == 2

    def test_toggle_region(self, test_project_with_working_video):
        """Test toggling a region enabled/disabled."""
        project_id = test_project_with_working_video

        # Create a region
        client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {
                    "start_time": 0.0,
                    "end_time": 2.0,
                    "region_id": "region-to-toggle"
                }
            }
        )

        # Toggle off
        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "toggle_region",
                "target": {"region_id": "region-to-toggle"},
                "data": {"enabled": False}
            }
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_set_effect_type(self, test_project_with_working_video):
        """Test setting the effect type."""
        project_id = test_project_with_working_video

        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "set_effect_type",
                "data": {"effect_type": "dark_overlay"}
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        # Verify it was saved
        response = client.get(f"/api/export/projects/{project_id}/overlay-data")
        assert response.status_code == 200
        assert response.json()["effect_type"] == "dark_overlay"

    def test_delete_nonexistent_region_fails(self, test_project_with_working_video):
        """Test that deleting a non-existent region returns error."""
        project_id = test_project_with_working_video

        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "delete_region",
                "target": {"region_id": "nonexistent-region"}
            }
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "not found" in data["error"]

    def test_version_increments_correctly(self, test_project_with_working_video):
        """Test that version increments with each action."""
        project_id = test_project_with_working_video

        # Action 1
        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r1"}
            }
        )
        assert response.json()["version"] == 1

        # Action 2
        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 3.0, "end_time": 5.0, "region_id": "r2"}
            }
        )
        assert response.json()["version"] == 2

        # Action 3
        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "delete_region",
                "target": {"region_id": "r1"}
            }
        )
        assert response.json()["version"] == 3
