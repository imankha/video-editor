"""
T1180: End-to-end roundtrip tests for msgpack binary encoding.

Tests the full data lifecycle:
1. Write via gesture actions → verify DB has msgpack bytes
2. Read via GET API → verify response has parsed objects (not strings)
3. PUT full state save → verify DB updated correctly
4. Archive → verify JSON has objects (not byte reprs)
5. Restore → verify DB has msgpack bytes again
6. GET after restore → verify response still correct
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

TEST_USER_ID = f"test_t1180_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def project_with_framed_clip():
    """Create a project with a clip that has crop keyframes, segments, and trim."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('T1180 Roundtrip Test', '9:16')
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

        # Set trim range via action API
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "set_trim_range", "data": {"start": 1.5, "end": 8.0}}
        )

        # Set segment speed via action API
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "set_segment_speed", "target": {"segment_index": 0}, "data": {"speed": 0.5}}
        )

        yield project_id, clip_id

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


class TestDBStorage:
    """Verify data is stored as msgpack bytes in DB, not JSON strings."""

    def test_crop_data_stored_as_bytes(self, project_with_framed_clip):
        project_id, clip_id = project_with_framed_clip

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            raw = cursor.fetchone()[0]

        assert isinstance(raw, bytes), f"crop_data should be bytes, got {type(raw).__name__}"
        assert raw[0:1] not in (b'{', b'['), "crop_data starts with JSON marker, should be msgpack"

    def test_segments_data_stored_as_bytes(self, project_with_framed_clip):
        project_id, clip_id = project_with_framed_clip

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT segments_data FROM working_clips WHERE id = ?", (clip_id,))
            raw = cursor.fetchone()[0]

        assert isinstance(raw, bytes), f"segments_data should be bytes, got {type(raw).__name__}"
        assert raw[0:1] not in (b'{', b'['), "segments_data starts with JSON marker, should be msgpack"

    def test_crop_data_decodes_correctly(self, project_with_framed_clip):
        project_id, clip_id = project_with_framed_clip

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,))
            raw = cursor.fetchone()[0]

        keyframes = decode_data(raw)
        assert isinstance(keyframes, list)
        assert len(keyframes) == 2
        assert keyframes[0]["frame"] == 0
        assert keyframes[0]["x"] == 100
        assert keyframes[1]["frame"] == 60

    def test_segments_data_decodes_with_trim(self, project_with_framed_clip):
        project_id, clip_id = project_with_framed_clip

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT segments_data FROM working_clips WHERE id = ?", (clip_id,))
            raw = cursor.fetchone()[0]

        segments = decode_data(raw)
        assert isinstance(segments, dict)
        assert segments["trimRange"]["start"] == 1.5
        assert segments["trimRange"]["end"] == 8.0
        assert segments["segmentSpeeds"]["0"] == 0.5


class TestAPIResponse:
    """Verify GET API returns parsed objects, not JSON strings."""

    def test_get_clips_returns_parsed_crop_data(self, project_with_framed_clip):
        project_id, clip_id = project_with_framed_clip

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        assert response.status_code == 200

        clips = response.json()
        assert len(clips) >= 1

        clip = next(c for c in clips if c["id"] == clip_id)

        # crop_data should be a list of keyframe objects, not a JSON string
        assert isinstance(clip["crop_data"], list), \
            f"crop_data should be list, got {type(clip['crop_data']).__name__}: {repr(clip['crop_data'])[:100]}"
        assert len(clip["crop_data"]) == 2
        assert clip["crop_data"][0]["frame"] == 0
        assert clip["crop_data"][0]["x"] == 100

    def test_get_clips_returns_parsed_segments_data(self, project_with_framed_clip):
        project_id, clip_id = project_with_framed_clip

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()
        clip = next(c for c in clips if c["id"] == clip_id)

        # segments_data should be a dict, not a JSON string
        assert isinstance(clip["segments_data"], dict), \
            f"segments_data should be dict, got {type(clip['segments_data']).__name__}: {repr(clip['segments_data'])[:100]}"
        assert clip["segments_data"]["trimRange"]["start"] == 1.5
        assert clip["segments_data"]["trimRange"]["end"] == 8.0
        assert clip["segments_data"]["segmentSpeeds"]["0"] == 0.5


class TestPutRoundtrip:
    """Verify PUT (saveFramingEdits) correctly stores and returns data."""

    def test_put_json_string_stores_as_msgpack(self, project_with_framed_clip):
        """Frontend sends JSON strings in PUT body — backend should store as msgpack."""
        project_id, clip_id = project_with_framed_clip

        new_keyframes = [
            {"frame": 0, "x": 300, "y": 150, "width": 540, "height": 960, "origin": "user"},
            {"frame": 90, "x": 400, "y": 200, "width": 540, "height": 960, "origin": "user"},
        ]
        new_segments = {
            "boundaries": [0, 10],
            "segmentSpeeds": {"0": 0.75},
            "trimRange": {"start": 2.0, "end": 7.0},
        }

        response = client.put(
            f"/api/clips/projects/{project_id}/clips/{clip_id}",
            json={
                "crop_data": json.dumps(new_keyframes),
                "segments_data": json.dumps(new_segments),
            }
        )
        assert response.status_code == 200

        # Verify DB has msgpack bytes
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data, segments_data FROM working_clips WHERE id = ?", (clip_id,))
            row = cursor.fetchone()

        assert isinstance(row[0], bytes), f"crop_data should be bytes after PUT, got {type(row[0]).__name__}"
        assert isinstance(row[1], bytes), f"segments_data should be bytes after PUT, got {type(row[1]).__name__}"

        crop = decode_data(row[0])
        assert len(crop) == 2
        assert crop[0]["x"] == 300

        segs = decode_data(row[1])
        assert segs["trimRange"]["start"] == 2.0
        assert segs["trimRange"]["end"] == 7.0
        assert segs["segmentSpeeds"]["0"] == 0.75

    def test_put_then_get_roundtrip(self, project_with_framed_clip):
        """PUT data, then GET it back — should return parsed objects."""
        project_id, clip_id = project_with_framed_clip

        new_segments = {
            "boundaries": [0, 5, 10],
            "userSplits": [5.0],
            "segmentSpeeds": {"0": 1.0, "1": 2.0},
            "trimRange": {"start": 0.5, "end": 9.5},
        }

        client.put(
            f"/api/clips/projects/{project_id}/clips/{clip_id}",
            json={"segments_data": json.dumps(new_segments)}
        )

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clip = next(c for c in response.json() if c["id"] == clip_id)

        assert isinstance(clip["segments_data"], dict)
        assert clip["segments_data"]["trimRange"]["start"] == 0.5
        assert clip["segments_data"]["trimRange"]["end"] == 9.5
        assert clip["segments_data"]["userSplits"] == [5.0]
        assert clip["segments_data"]["segmentSpeeds"]["1"] == 2.0


class TestArchiveRestore:
    """Verify archive/restore preserves binary data correctly."""

    def test_archive_restore_roundtrip(self, project_with_framed_clip):
        """Archive a project, restore it, verify all data survived."""
        project_id, clip_id = project_with_framed_clip

        # Snapshot data before archive
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data, segments_data FROM working_clips WHERE id = ?", (clip_id,))
            row = cursor.fetchone()
            original_crop = decode_data(row[0])
            original_segments = decode_data(row[1])

        # Archive
        from app.services.project_archive import archive_project, restore_project
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled, skipping archive/restore test")

        result = archive_project(project_id, TEST_USER_ID)
        assert result is True, "Archive should succeed"

        # Verify data was deleted from DB
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM working_clips WHERE project_id = ?", (project_id,))
            assert cursor.fetchone()[0] == 0, "Working clips should be deleted after archive"

        # Restore
        result = restore_project(project_id, TEST_USER_ID)
        assert result is True, "Restore should succeed"

        # Verify restored data matches original
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data, segments_data FROM working_clips WHERE project_id = ?", (project_id,))
            row = cursor.fetchone()
            assert row is not None, "Working clip should exist after restore"

            restored_crop = decode_data(row[0])
            restored_segments = decode_data(row[1])

        assert restored_crop == original_crop, \
            f"crop_data mismatch after restore:\n  original: {original_crop}\n  restored: {restored_crop}"
        assert restored_segments == original_segments, \
            f"segments_data mismatch after restore:\n  original: {original_segments}\n  restored: {restored_segments}"

    def test_archive_json_has_objects_not_byte_reprs(self, project_with_framed_clip):
        """The archive JSON should contain proper objects, not Python byte string reprs."""
        project_id, clip_id = project_with_framed_clip

        from app.services.project_archive import _row_to_dict, _BINARY_COLUMNS
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM working_clips WHERE id = ?", (clip_id,))
            row = cursor.fetchone()

        row_dict = _row_to_dict(row)

        # crop_data should be a list (decoded from msgpack), not bytes or a string
        assert isinstance(row_dict["crop_data"], list), \
            f"_row_to_dict crop_data should be list, got {type(row_dict['crop_data']).__name__}"

        # segments_data should be a dict
        assert isinstance(row_dict["segments_data"], dict), \
            f"_row_to_dict segments_data should be dict, got {type(row_dict['segments_data']).__name__}"

        # Verify it JSON-serializes cleanly (no default=str needed for binary)
        archive_json = json.dumps({"clips": [row_dict]})
        parsed = json.loads(archive_json)

        clip_data = parsed["clips"][0]
        assert isinstance(clip_data["crop_data"], list)
        assert clip_data["crop_data"][0]["frame"] == 0
        assert clip_data["segments_data"]["trimRange"]["start"] == 1.5

    def test_restore_writes_msgpack_bytes(self, project_with_framed_clip):
        """After restore, DB columns should contain msgpack bytes, not JSON strings."""
        project_id, clip_id = project_with_framed_clip

        from app.services.project_archive import archive_project, restore_project
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled")

        archive_project(project_id, TEST_USER_ID)
        restore_project(project_id, TEST_USER_ID)

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT crop_data, segments_data FROM working_clips WHERE project_id = ?", (project_id,))
            row = cursor.fetchone()

        assert isinstance(row[0], bytes), f"crop_data after restore should be bytes, got {type(row[0]).__name__}"
        assert row[0][0:1] not in (b'{', b'['), "crop_data after restore looks like JSON, should be msgpack"

    def test_get_after_restore_returns_objects(self, project_with_framed_clip):
        """GET clips after restore should return parsed objects, same as before archive."""
        project_id, clip_id = project_with_framed_clip

        from app.services.project_archive import archive_project, restore_project
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            pytest.skip("R2 not enabled")

        # GET before archive
        response_before = client.get(f"/api/clips/projects/{project_id}/clips")
        clip_before = next(c for c in response_before.json() if c["id"] == clip_id)

        archive_project(project_id, TEST_USER_ID)
        restore_project(project_id, TEST_USER_ID)

        # GET after restore
        response_after = client.get(f"/api/clips/projects/{project_id}/clips")
        clips_after = response_after.json()
        # After restore the clip ID may differ, just check first clip
        clip_after = clips_after[0]

        assert clip_after["crop_data"] == clip_before["crop_data"], \
            f"crop_data changed after archive/restore"
        assert clip_after["segments_data"] == clip_before["segments_data"], \
            f"segments_data changed after archive/restore"


class TestExportJobInputData:
    """Verify export_jobs.input_data round-trips correctly."""

    def test_export_job_input_data_stored_as_bytes(self, project_with_framed_clip):
        project_id, clip_id = project_with_framed_clip

        config = {
            "keyframes": [{"time": 0, "x": 100, "y": 50, "width": 1080, "height": 1920}],
            "segment_data": {"trimRange": {"start": 1.5, "end": 8.0}, "segments": [{"start": 0, "end": 10, "speed": 0.5}]},
            "target_fps": 30,
        }

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO export_jobs (id, project_id, type, status, input_data)
                VALUES (?, ?, 'framing', 'pending', ?)
            """, (f"test_{uuid.uuid4().hex[:8]}", project_id, encode_data(config)))
            job_id = cursor.lastrowid
            conn.commit()

            cursor.execute("SELECT input_data FROM export_jobs WHERE rowid = ?", (job_id,))
            raw = cursor.fetchone()[0]

        assert isinstance(raw, bytes)
        decoded = decode_data(raw)
        assert decoded["segment_data"]["trimRange"]["start"] == 1.5
        assert decoded["segment_data"]["trimRange"]["end"] == 8.0
        assert decoded["keyframes"][0]["x"] == 100
