"""
Tests for gesture-based overlay actions API.

These tests verify the atomic action endpoints work correctly
for overlay modifications.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_USER_ID = f"test_overlay_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

# Pre-populate init cache so middleware uses the same profile as fixtures
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def test_project_with_working_video():
    """Create a test project with working video for overlay testing."""
    # Ensure user+profile context is set (may have been changed by other tests' teardowns)
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('Test Overlay Project', '9:16')
        """)
        project_id = cursor.lastrowid

        # Create working video with empty highlights. Empty is stored as NULL
        # (production representation); highlights_data is a BLOB always written via
        # encode_data(...) or None -- never a plain string. Storing the literal
        # string '[]' here would be invalid data that only "worked" under the old
        # silent decode fallback removed in T4210.
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename, version, highlights_data, effect_type, overlay_version)
            VALUES (?, 'test_working.mp4', 1, NULL, 'original', 0)
        """, (project_id,))
        working_video_id = cursor.lastrowid

        # Link project to working video
        cursor.execute("""
            UPDATE projects SET working_video_id = ? WHERE id = ?
        """, (working_video_id, project_id))

        conn.commit()

        yield project_id

        # Cleanup - unlink FK before deleting to avoid constraint violation
        cursor.execute("UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,))
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


class TestOverlayActionVersionConflict:
    """
    T4330 -- two-writer 409 `version_conflict` (design doc section 2.6).

    The `expected_version` field has existed on `OverlayAction` for a while, but
    the check in `overlay_action` (overlay.py ~645-652) is commented out --
    plumbing that protects nothing. These tests are written test-first (Stage 3)
    and are expected to FAIL until the scaffold is uncommented and wired.
    """

    def test_stale_expected_version_returns_409(self, test_project_with_working_video):
        """Writer A commits (version 0 -> 1); writer B's stale expected_version=0 conflicts."""
        project_id = test_project_with_working_video

        # Writer A: reads version 0 (implicitly, via the fixture's overlay_version=0),
        # then commits an action -- version goes 0 -> 1.
        response_a = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "writer-a-region"},
            },
        )
        assert response_a.status_code == 200
        assert response_a.json()["version"] == 1

        # Writer B: still holds the STALE version it read before writer A committed
        # (0), and posts with expected_version=0 -- must conflict against the NEW
        # current version (1).
        response_b = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 3.0, "end_time": 5.0, "region_id": "writer-b-region"},
                "expected_version": 0,
            },
        )

        assert response_b.status_code == 409
        body = response_b.json()
        assert body["success"] is False
        assert body["error"] == "version_conflict"
        assert body["current_version"] == 1

    def test_null_expected_version_still_succeeds_back_compat(self, test_project_with_working_video):
        """An action with no expected_version (today's/first-write behavior) must keep landing."""
        project_id = test_project_with_working_video

        # Bump the version once so current_version != 0, to prove the check is
        # genuinely being SKIPPED (not just coincidentally matching).
        client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "seed"},
            },
        )

        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 6.0, "end_time": 8.0, "region_id": "no-version-check"},
                # expected_version omitted entirely
            },
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_matching_expected_version_succeeds(self, test_project_with_working_video):
        """A writer that reads the CURRENT version and echoes it back is not conflicted."""
        project_id = test_project_with_working_video

        first = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r1"},
            },
        )
        current_version = first.json()["version"]

        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 3.0, "end_time": 5.0, "region_id": "r2"},
                "expected_version": current_version,
            },
        )

        assert response.status_code == 200
        assert response.json()["success"] is True
        assert response.json()["version"] == current_version + 1

    def test_overlay_data_get_seeds_overlay_version_not_export_row_version(
        self, test_project_with_working_video
    ):
        """Regression: GET /overlay-data must return `overlay_version` (the
        mutation counter `overlay_action`'s 409-check actually compares against)
        under its `version` key, never `working_videos.version` (the export
        row-counter, which bumps once per re-export regardless of overlay edits).

        Before this fix, the frontend seeded its conflict-check baseline from the
        WRONG counter -- so after any re-export advanced the row-counter past 0,
        the very FIRST overlay edit always 409'd as "edited elsewhere", with no
        concurrent writer involved at all.
        """
        project_id = test_project_with_working_video

        # Simulate a re-export: a NEW working_videos row lands with a HIGHER
        # export row-counter but a FRESH overlay_version (0) -- exactly what
        # `upsert_working_video`'s INSERT branch produces on every re-export.
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO working_videos (project_id, filename, version, highlights_data, effect_type, overlay_version)
                VALUES (?, 'test_working_v2.mp4', 5, NULL, 'original', 0)
            """, (project_id,))
            new_wv_id = cursor.lastrowid
            cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (new_wv_id, project_id))
            conn.commit()

        data = client.get(f"/api/export/projects/{project_id}/overlay-data").json()
        # Must be the mutation counter (0), never the export row-counter (5).
        assert data["version"] == 0

        # What GET returns must be exactly what the client can echo back as
        # expected_version on the FIRST post-re-export edit without a false 409.
        response = client.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "post-reexport-edit"},
                "expected_version": data["version"],
            },
        )
        assert response.status_code == 200
        assert response.json()["success"] is True
