"""
Test restore using Andrew's actual archive data from staging R2.

Loads the real archive JSONs, runs restore_project's DB insertion logic,
then hits the same API endpoints the frontend calls to verify crop_data,
segments_data, and highlights_data come back as proper types.
"""

import json
import pytest
import uuid
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.utils.encoding import encode_data, decode_data
from app.session_init import _init_cache

TEST_USER_ID = f"test_andrew_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}
client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})

FIXTURES = Path(__file__).parent / "fixtures" / "andrew_archives.json"
BINARY_COLUMNS = {'crop_data', 'timing_data', 'segments_data', 'highlights_data', 'input_data'}


@pytest.fixture(scope="module")
def archives():
    with open(FIXTURES) as f:
        return json.load(f)


@pytest.fixture
def restored_project(archives, request):
    """Insert one archive's data into the test DB using the same logic as restore_project."""
    project_id_str = request.param
    archive = archives[project_id_str]
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)

    with get_db_connection() as conn:
        cursor = conn.cursor()

        project = archive["project"]
        proj_data = {k: v for k, v in project.items() if k not in ("id", "working_video_id", "final_video_id")}
        columns = list(proj_data.keys())
        placeholders = ", ".join(["?" for _ in columns])
        column_names = ", ".join(columns)
        values = [proj_data[col] for col in columns]
        cursor.execute(f"INSERT INTO projects ({column_names}) VALUES ({placeholders})", values)
        new_project_id = cursor.lastrowid

        FK_SKIP = {"id", "raw_clip_id", "raw_clip_version"}
        clip_id_map = {}
        for clip in archive.get("working_clips", []):
            old_id = clip["id"]
            clip_copy = {k: v for k, v in clip.items() if k not in FK_SKIP}
            clip_copy["project_id"] = new_project_id
            columns = list(clip_copy.keys())
            placeholders = ", ".join(["?" for _ in columns])
            column_names = ", ".join(columns)
            values = [encode_data(clip_copy[col]) if col in BINARY_COLUMNS and clip_copy[col] is not None else clip_copy[col] for col in columns]
            cursor.execute(f"INSERT INTO working_clips ({column_names}) VALUES ({placeholders})", values)
            clip_id_map[old_id] = cursor.lastrowid

        new_working_video_id = None
        for video in archive.get("working_videos", []):
            vid_copy = {k: v for k, v in video.items() if k != "id"}
            vid_copy["project_id"] = new_project_id
            columns = list(vid_copy.keys())
            placeholders = ", ".join(["?" for _ in columns])
            column_names = ", ".join(columns)
            values = [encode_data(vid_copy[col]) if col in BINARY_COLUMNS and vid_copy[col] is not None else vid_copy[col] for col in columns]
            cursor.execute(f"INSERT INTO working_videos ({column_names}) VALUES ({placeholders})", values)
            new_working_video_id = cursor.lastrowid

        cursor.execute(
            "UPDATE projects SET working_video_id = ?, archived_at = NULL WHERE id = ?",
            (new_working_video_id, new_project_id)
        )
        conn.commit()

    yield {
        "project_id": new_project_id,
        "archive": archive,
        "clip_id_map": clip_id_map,
        "working_video_id": new_working_video_id,
    }

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (new_project_id,))
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (new_project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (new_project_id,))
        conn.commit()


class TestAndrewRestoreFraming:
    """Verify crop_data and segments_data return as proper types via the clips API."""

    @pytest.mark.parametrize("restored_project", ["2", "4", "5", "6", "7", "8"], indirect=True)
    def test_crop_data_is_list(self, restored_project):
        pid = restored_project["project_id"]
        response = client.get(f"/api/clips/projects/{pid}/clips")
        assert response.status_code == 200
        clips = response.json()
        assert len(clips) >= 1, f"No clips returned for project {pid}"

        clip = clips[0]
        assert isinstance(clip["crop_data"], list), \
            f"crop_data should be list, got {type(clip['crop_data']).__name__}: {repr(clip['crop_data'])[:100]}"
        assert len(clip["crop_data"]) > 0, "crop_data should not be empty"
        assert "frame" in clip["crop_data"][0], "crop keyframe should have 'frame' field"
        assert "x" in clip["crop_data"][0], "crop keyframe should have 'x' field"

    @pytest.mark.parametrize("restored_project", ["2", "4", "5", "6", "7", "8"], indirect=True)
    def test_segments_data_is_dict(self, restored_project):
        pid = restored_project["project_id"]
        response = client.get(f"/api/clips/projects/{pid}/clips")
        assert response.status_code == 200
        clip = response.json()[0]

        assert isinstance(clip["segments_data"], dict), \
            f"segments_data should be dict, got {type(clip['segments_data']).__name__}: {repr(clip['segments_data'])[:100]}"


class TestAndrewRestoreOverlay:
    """Verify highlights_data returns as proper types via the overlay API."""

    @pytest.mark.parametrize("restored_project", ["2", "4", "5", "6", "7", "8"], indirect=True)
    def test_overlay_data_present(self, restored_project):
        pid = restored_project["project_id"]
        response = client.get(f"/api/export/projects/{pid}/overlay-data")
        assert response.status_code == 200
        data = response.json()

        assert data["has_data"] is True, \
            f"Overlay should have data. Response: {data}"
        assert isinstance(data["highlights_data"], list), \
            f"highlights_data should be list, got {type(data['highlights_data']).__name__}"
        assert len(data["highlights_data"]) > 0, "Should have at least one highlight region"

    @pytest.mark.parametrize("restored_project", ["2", "4", "5", "6", "7", "8"], indirect=True)
    def test_overlay_regions_have_keyframes(self, restored_project):
        pid = restored_project["project_id"]
        response = client.get(f"/api/export/projects/{pid}/overlay-data")
        regions = response.json()["highlights_data"]

        for region in regions:
            assert "id" in region, "Region should have 'id'"
            assert "keyframes" in region, f"Region {region.get('id')} should have 'keyframes'"
            assert isinstance(region["keyframes"], list), \
                f"Region {region.get('id')} keyframes should be list, got {type(region['keyframes']).__name__}"

    @pytest.mark.parametrize("restored_project", ["2", "4", "5", "6", "7", "8"], indirect=True)
    def test_overlay_regions_have_detections(self, restored_project):
        pid = restored_project["project_id"]
        response = client.get(f"/api/export/projects/{pid}/overlay-data")
        regions = response.json()["highlights_data"]

        for region in regions:
            assert "detections" in region, f"Region {region.get('id')} should have 'detections'"
            assert isinstance(region["detections"], list), \
                f"Region {region.get('id')} detections should be list"


class TestAndrewRestoreDbTypes:
    """Verify the raw DB values are msgpack bytes after restore."""

    @pytest.mark.parametrize("restored_project", ["2", "4", "5", "6", "7", "8"], indirect=True)
    def test_crop_data_stored_as_bytes(self, restored_project):
        pid = restored_project["project_id"]
        set_current_user_id(TEST_USER_ID)
        set_current_profile_id(TEST_PROFILE_ID)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE project_id = ?", (pid,))
            row = cursor.fetchone()
        assert row is not None
        assert isinstance(row["crop_data"], bytes), \
            f"crop_data should be bytes in DB, got {type(row['crop_data']).__name__}"

    @pytest.mark.parametrize("restored_project", ["2", "4", "5", "6", "7", "8"], indirect=True)
    def test_highlights_data_stored_as_bytes(self, restored_project):
        pid = restored_project["project_id"]
        set_current_user_id(TEST_USER_ID)
        set_current_profile_id(TEST_PROFILE_ID)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT highlights_data FROM working_videos WHERE project_id = ?", (pid,))
            row = cursor.fetchone()
        assert row is not None
        assert isinstance(row["highlights_data"], bytes), \
            f"highlights_data should be bytes in DB, got {type(row['highlights_data']).__name__}"
