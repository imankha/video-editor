"""
Tests for gesture-based framing actions API.

These tests verify the atomic action endpoints work correctly
for framing modifications (crop keyframes, segments, trim).
"""

import pytest
import json
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.utils.encoding import decode_data, encode_data
from app.session_init import _init_cache

TEST_USER_ID = f"test_framing_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

# Pre-populate init cache so middleware uses the same profile as fixtures
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def test_project_with_clip():
    """Create a test project with a working clip for framing testing."""
    # Ensure user+profile context is set (may have been changed by other tests' teardowns)
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
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
            VALUES (?, 'test_clip.mp4', 1, NULL, NULL)
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
            keyframes = decode_data(row[0])
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
            keyframes = decode_data(cursor.fetchone()[0])
            assert keyframes[0]["x"] == 200
            assert keyframes[0]["y"] == 100

    def test_delete_crop_keyframe(self, test_project_with_clip):
        """Test deleting a non-boundary crop keyframe."""
        project_id, clip_id = test_project_with_clip

        # Add three keyframes so we can delete the middle one (frame 0 is a boundary)
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 0, "x": 100, "y": 50, "width": 1080, "height": 1920, "origin": "user"}}
        )
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 30, "x": 150, "y": 75, "width": 1080, "height": 1920, "origin": "user"}}
        )
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 60, "x": 200, "y": 100, "width": 1080, "height": 1920, "origin": "user"}}
        )

        # Delete the middle keyframe (frame 30 is not a boundary)
        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "delete_crop_keyframe",
                "target": {"frame": 30}
            }
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify deletion — frame 30 is gone, frame 0 and 60 remain
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            keyframes = decode_data(cursor.fetchone()[0])
            assert len(keyframes) == 2
            frames = [kf["frame"] for kf in keyframes]
            assert 30 not in frames
            assert 0 in frames
            assert 60 in frames

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
            keyframes = decode_data(cursor.fetchone()[0])
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
            segments = decode_data(cursor.fetchone()[0])
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
            segments = decode_data(cursor.fetchone()[0])
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
            segments = decode_data(cursor.fetchone()[0])
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
            segments = decode_data(cursor.fetchone()[0])
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
            segments = decode_data(cursor.fetchone()[0])
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

    def test_delete_keyframe_down_to_one(self, test_project_with_clip):
        """Flat-list model: deleting succeeds regardless of how many keyframes remain.
        This is the regression for the original "minimum 2 keyframes required" bug,
        which no longer applies — there is no count floor on the backend."""
        project_id, clip_id = test_project_with_clip

        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 0, "x": 100, "y": 50, "width": 1080, "height": 1920, "origin": "user"}}
        )
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 40, "x": 150, "y": 75, "width": 1080, "height": 1920, "origin": "user"}}
        )

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "delete_crop_keyframe", "target": {"frame": 40}}
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            keyframes = decode_data(cursor.fetchone()[0])
            frames = [kf["frame"] for kf in keyframes]
            assert 40 not in frames
            assert 0 in frames

    def test_any_keyframe_is_deletable(self, test_project_with_clip):
        """Flat-list model: there are no protected boundary keyframes — any crop
        keyframe (including frame 0 and the last) can be deleted."""
        project_id, clip_id = test_project_with_clip

        for frame, x in ((0, 100), (30, 150), (90, 200)):
            client.post(
                f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
                json={"action": "add_crop_keyframe", "data": {"frame": frame, "x": x, "y": 50, "width": 1080, "height": 1920, "origin": "user"}}
            )

        # frame 0 (start) is deletable
        resp_start = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "delete_crop_keyframe", "target": {"frame": 0}}
        )
        assert resp_start.status_code == 200
        assert resp_start.json()["success"] is True

        # the last keyframe is deletable too
        resp_end = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "delete_crop_keyframe", "target": {"frame": 90}}
        )
        assert resp_end.status_code == 200
        assert resp_end.json()["success"] is True

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            frames = [kf["frame"] for kf in decode_data(cursor.fetchone()[0])]
            assert frames == [30]

    def test_add_user_keyframe_too_close_rejected(self, test_project_with_clip):
        """New user keyframes within MIN_KEYFRAME_SPACING of an existing one are rejected."""
        project_id, clip_id = test_project_with_clip

        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 0, "x": 100, "y": 50, "width": 1080, "height": 1920, "origin": "user"}}
        )
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 50, "x": 150, "y": 75, "width": 1080, "height": 1920, "origin": "user"}}
        )

        # 5 frames from the keyframe at 50 -> within MIN_KEYFRAME_SPACING (10) -> rejected
        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 55, "x": 160, "y": 80, "width": 1080, "height": 1920, "origin": "user"}}
        )
        assert response.status_code == 400
        assert "too close" in response.json()["error"].lower()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            frames = [kf["frame"] for kf in decode_data(cursor.fetchone()[0])]
            assert 55 not in frames


@pytest.fixture
def multi_clip_project():
    """Project with TWO 1920x1080 clips, each holding an off-center 9:16 crop keyframe.

    Yields (project_id, [clip_a_id, clip_b_id]). Clips start at aspect_ratio '9:16'.
    """
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Multi Reel', '9:16')")
        project_id = cursor.lastrowid

        # Centered 9:16 box: width=608, height=1080 in a 1920x1080 frame -> x=656, y=0.
        # center = (960, 540). Re-fit to 16:9 (640x360) -> x=640, y=360 (no clamp).
        clip_a_crop = [{"frame": 0, "x": 656, "y": 0, "width": 608, "height": 1080, "origin": "permanent"}]
        # Off-center box pushed to top-left: center=(235, 340). Re-fit to 16:9 (640x360) ->
        # x = round(235-320) = -85 -> clamp 0 ; y = round(340-180) = 160.
        clip_b_crop = [
            {"frame": 0, "x": 100, "y": 100, "width": 270, "height": 480, "origin": "permanent"},
            {"frame": 90, "x": 100, "y": 100, "width": 270, "height": 480, "origin": "user"},
        ]

        clip_ids = []
        for crop in (clip_a_crop, clip_b_crop):
            cursor.execute("""
                INSERT INTO working_clips (
                    project_id, uploaded_filename, version, crop_data, segments_data, width, height, fps
                ) VALUES (?, ?, 1, ?, NULL, 1920, 1080, 30)
            """, (project_id, f"clip_{len(clip_ids)}.mp4", encode_data(crop)))
            clip_ids.append(cursor.lastrowid)

        conn.commit()
        yield project_id, clip_ids

        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


class TestSetProjectAspectRatio:
    """T3910: reel-level aspect-ratio change re-fits all clips."""

    def _crop(self, clip_id):
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            return decode_data(cursor.fetchone()[0])

    def _project_ratio(self, project_id):
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT aspect_ratio FROM projects WHERE id = ?", (project_id,))
            return cursor.fetchone()[0]

    def test_updates_project_ratio_and_refits_all_clips(self, multi_clip_project):
        project_id, (clip_a, clip_b) = multi_clip_project

        response = client.post(
            f"/api/clips/projects/{project_id}/aspect-ratio",
            json={"aspect_ratio": "16:9"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["aspect_ratio"] == "16:9"
        assert body["updated_clip_count"] == 2

        # Reel ratio persisted.
        assert self._project_ratio(project_id) == "16:9"

        # Every clip's boxes are now the 16:9 default size.
        for clip_id in (clip_a, clip_b):
            for kf in self._crop(clip_id):
                assert kf["width"] == 640
                assert kf["height"] == 360

    def test_refit_preserves_center_when_unclamped(self, multi_clip_project):
        project_id, (clip_a, _clip_b) = multi_clip_project
        client.post(f"/api/clips/projects/{project_id}/aspect-ratio", json={"aspect_ratio": "16:9"})

        kf = self._crop(clip_a)[0]
        # center stays (960, 540): 640+640/2 == 960, 360+360/2 == 540
        assert kf["x"] == 640 and kf["y"] == 360

    def test_refit_clamps_to_frame_bounds(self, multi_clip_project):
        project_id, (_clip_a, clip_b) = multi_clip_project
        client.post(f"/api/clips/projects/{project_id}/aspect-ratio", json={"aspect_ratio": "16:9"})

        kf = self._crop(clip_b)[0]
        # x would be negative (-85) so clamped to 0; y = 160 within bounds.
        assert kf["x"] == 0 and kf["y"] == 160

    def test_refit_preserves_frame_and_origin(self, multi_clip_project):
        project_id, (_clip_a, clip_b) = multi_clip_project
        client.post(f"/api/clips/projects/{project_id}/aspect-ratio", json={"aspect_ratio": "16:9"})

        kfs = self._crop(clip_b)
        assert [kf["frame"] for kf in kfs] == [0, 90]
        assert [kf["origin"] for kf in kfs] == ["permanent", "user"]

    def test_empty_crop_clip_left_untouched(self, multi_clip_project):
        project_id, _clips = multi_clip_project
        # Add a third clip with no crop data.
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO working_clips (project_id, uploaded_filename, version, crop_data, width, height, fps)
                VALUES (?, 'empty.mp4', 1, NULL, 1920, 1080, 30)
            """, (project_id,))
            empty_id = cursor.lastrowid
            conn.commit()

        response = client.post(
            f"/api/clips/projects/{project_id}/aspect-ratio", json={"aspect_ratio": "16:9"}
        )
        # Only the two clips WITH crop data are counted as updated.
        assert response.json()["updated_clip_count"] == 2
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (empty_id,))
            assert cursor.fetchone()[0] is None

    def test_clip_missing_dimensions_skipped(self):
        """A clip with crop data but no stored width/height is skipped (can't re-center)."""
        set_current_user_id(TEST_USER_ID)
        set_current_profile_id(TEST_PROFILE_ID)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('NoDims', '9:16')")
            project_id = cursor.lastrowid
            crop = [{"frame": 0, "x": 100, "y": 100, "width": 270, "height": 480, "origin": "permanent"}]
            cursor.execute("""
                INSERT INTO working_clips (project_id, uploaded_filename, version, crop_data, width, height, fps)
                VALUES (?, 'nodims.mp4', 1, ?, NULL, NULL, NULL)
            """, (project_id, encode_data(crop)))
            clip_id = cursor.lastrowid
            conn.commit()

        try:
            response = client.post(
                f"/api/clips/projects/{project_id}/aspect-ratio", json={"aspect_ratio": "16:9"}
            )
            assert response.status_code == 200
            assert response.json()["updated_clip_count"] == 0
            # Crop unchanged (still the original 270x480 box).
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT crop_data, aspect_ratio FROM working_clips wc "
                               "JOIN projects p ON p.id = wc.project_id WHERE wc.id = ?", (clip_id,))
                row = cursor.fetchone()
                assert decode_data(row[0])[0]["width"] == 270
                # Reel ratio still updated even though no clip was re-fit.
                assert row["aspect_ratio"] == "16:9"
        finally:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
                cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
                conn.commit()

    def test_single_clip_project_refits_one_clip(self, test_project_with_clip):
        """Single-clip behaviour: the one clip is re-fit, same path as multi-clip."""
        project_id, clip_id = test_project_with_clip
        # Give the single clip a crop + dimensions.
        with get_db_connection() as conn:
            cursor = conn.cursor()
            crop = [{"frame": 0, "x": 656, "y": 0, "width": 608, "height": 1080, "origin": "permanent"}]
            cursor.execute(
                "UPDATE working_clips SET crop_data = ?, width = 1920, height = 1080, fps = 30 WHERE id = ?",
                (encode_data(crop), clip_id),
            )
            conn.commit()

        response = client.post(
            f"/api/clips/projects/{project_id}/aspect-ratio", json={"aspect_ratio": "16:9"}
        )
        assert response.json()["updated_clip_count"] == 1
        kf = self._crop(clip_id)[0]
        assert (kf["width"], kf["height"]) == (640, 360)

    def test_invalid_aspect_ratio_rejected(self, multi_clip_project):
        project_id, _clips = multi_clip_project
        response = client.post(
            f"/api/clips/projects/{project_id}/aspect-ratio", json={"aspect_ratio": "banana"}
        )
        assert response.status_code == 400
        assert self._project_ratio(project_id) == "9:16"  # unchanged

    def test_unknown_project_404(self):
        response = client.post(
            "/api/clips/projects/99999999/aspect-ratio", json={"aspect_ratio": "16:9"}
        )
        assert response.status_code == 404
