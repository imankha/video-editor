"""
Regression tests for T4220: remove_segment_split must re-index segment speeds,
not clear them.

Old bug: removing ANY split ran `segments_data['segmentSpeeds'] = {}`, wiping every
slow-motion speed on the clip. Now the handler re-indexes:
  - i < k     -> keep speeds[i]
  - merged k  -> keep only if speeds[k] == speeds[k+1], else omit (plays 1x)
  - i > k + 1 -> speeds[i] moves to key (i-1)
where k is the sorted index of the removed split (splits-only boundaries list).
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.utils.encoding import decode_data, encode_data
from app.session_init import _init_cache

TEST_USER_ID = f"test_t4220_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def clip_with_segments():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T4220', '9:16')"
        )
        project_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO working_clips (project_id, uploaded_filename, version, crop_data, segments_data)
            VALUES (?, 'wc.mp4', 1, NULL, NULL)
            """,
            (project_id,),
        )
        clip_id = cursor.lastrowid
        conn.commit()
        yield project_id, clip_id
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _seed_segments(clip_id, boundaries, speeds):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE working_clips SET segments_data = ? WHERE id = ?",
            (encode_data({"boundaries": list(boundaries), "segmentSpeeds": dict(speeds)}), clip_id),
        )
        conn.commit()


def _remove_split(project_id, clip_id, time):
    return client.post(
        f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
        json={"action": "remove_segment_split", "data": {"time": time}},
    )


def _read_speeds(clip_id):
    # Read the LATEST working_clip version for this clip's slot (saving may bump version).
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT segments_data FROM working_clips
            WHERE id = (SELECT id FROM working_clips WHERE id = ?)
            """,
            (clip_id,),
        )
        row = cursor.fetchone()
        seg = decode_data(row["segments_data"])
        return seg.get("segmentSpeeds", {})


def test_remove_middle_split_different_speeds_omits_merged(clip_with_segments):
    """splits [10,20,30], speeds seg0=1x seg1=0.5x seg3=0.25x; remove split 20 (k=1).
    Merges seg1 (0.5) with seg2 (1x default) -> different -> merged omitted (1x).
    seg3's 0.25 shifts from index 3 to index 2.
    Expected: {"0": 1, "2": 0.25}."""
    project_id, clip_id = clip_with_segments
    _seed_segments(clip_id, [10.0, 20.0, 30.0], {"0": 1, "1": 0.5, "3": 0.25})
    resp = _remove_split(project_id, clip_id, 20.0)
    assert resp.status_code == 200, resp.text
    assert _read_speeds(clip_id) == {"0": 1, "2": 0.25}


def test_remove_split_between_same_speeds_keeps_merged(clip_with_segments):
    """splits [10,20], speeds seg1=0.5x seg2=0.5x; remove split 20 (k=1).
    Merges seg1 and seg2, both 0.5x -> merged keeps 0.5x at index 1.
    Expected: {"1": 0.5}."""
    project_id, clip_id = clip_with_segments
    _seed_segments(clip_id, [10.0, 20.0], {"1": 0.5, "2": 0.5})
    resp = _remove_split(project_id, clip_id, 20.0)
    assert resp.status_code == 200, resp.text
    assert _read_speeds(clip_id) == {"1": 0.5}


def test_remove_first_split_shifts_and_omits_merged(clip_with_segments):
    """splits [10,20], speeds seg0=0.5x seg1=1x seg2=0.25x; remove split 10 (k=0).
    Merges seg0 (0.5) with seg1 (1x default in map) -> different -> omit.
    seg2's 0.25 shifts from index 2 to index 1.
    Expected: {"1": 0.25}."""
    project_id, clip_id = clip_with_segments
    _seed_segments(clip_id, [10.0, 20.0], {"0": 0.5, "1": 1, "2": 0.25})
    resp = _remove_split(project_id, clip_id, 10.0)
    assert resp.status_code == 200, resp.text
    assert _read_speeds(clip_id) == {"1": 0.25}


def test_remove_last_split_keeps_earlier_speeds(clip_with_segments):
    """splits [10,20], speeds seg0=0.5x seg2=0.25x; remove split 20 (k=1).
    Merges seg1 (default) with seg2 (0.25) -> different -> merged omitted.
    seg0's 0.5x (index 0 < k) is untouched.
    Expected: {"0": 0.5}."""
    project_id, clip_id = clip_with_segments
    _seed_segments(clip_id, [10.0, 20.0], {"0": 0.5, "2": 0.25})
    resp = _remove_split(project_id, clip_id, 20.0)
    assert resp.status_code == 200, resp.text
    assert _read_speeds(clip_id) == {"0": 0.5}
