"""
T4340 (Tester Phase 1, FAILING by design) -- write-time canonicalization of
working_clips.segments_data.boundaries.

Design: docs/plans/tasks/T4340-design.md (APPROVED). Central contract (Sec 2.4):

    gesture read:  DB blob (full-list OR splits-only) -> strip -> splits-only  (handler invariant)
    handlers:      operate on splits-only  (UNCHANGED: split_segment, remove_segment_split)
    gesture save:  splits-only -> canonicalize_segments_data(_, raw_duration) -> full-list -> UPDATE

None of the implementation exists yet (Stage 4 not started):
  - `_get_clip_framing_data` does not join raw_clips / does not strip boundaries
  - `_save_clip_framing_data` does not canonicalize before encode
  - `highlight_transform.to_splits_only` does not exist

These tests are written to FAIL for those reasons -- not because of fixture bugs.
Test #1/2/3/5 exercise the gesture HTTP path end-to-end and read the RAW stored
blob (never re-canonicalized by the test) to assert the on-disk shape directly.
Test #4 characterizes the PUT path, which the design says needs NO change --
this one should PASS today and stay passing after implementation (regression
guard, not a new-behavior test).
"""

import logging
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.utils.encoding import decode_data, encode_data
from app.session_init import _init_cache

TEST_USER_ID = f"test_t4340_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def clip_with_raw_duration():
    """A working_clip backed by a raw_clips row with a KNOWN duration (10.0s:
    start_time=5.0, end_time=15.0). This is the Option-B join source (design
    Sec 2.2) -- no `raw_duration` column anywhere, it's always derived live."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T4340', '9:16')"
        )
        project_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO raw_clips (filename, rating, start_time, end_time)
            VALUES ('raw.mp4', 5, 5.0, 15.0)
            """
        )
        raw_clip_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO working_clips (project_id, raw_clip_id, uploaded_filename, version, crop_data, segments_data)
            VALUES (?, ?, 'wc.mp4', 1, NULL, NULL)
            """,
            (project_id, raw_clip_id),
        )
        clip_id = cursor.lastrowid
        conn.commit()
        yield project_id, clip_id, raw_clip_id
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


@pytest.fixture
def orphan_clip():
    """A working_clip with NO raw_clip_id (uploaded/orphan) -- no raw_duration
    is derivable. Design Sec 2.2 guard: must skip + log, never fabricate."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T4340-orphan', '9:16')"
        )
        project_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO working_clips (project_id, raw_clip_id, uploaded_filename, version, crop_data, segments_data)
            VALUES (?, NULL, 'uploaded.mp4', 1, NULL, NULL)
            """,
            (project_id,),
        )
        clip_id = cursor.lastrowid
        conn.commit()
        yield project_id, clip_id
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _seed_segments(clip_id, boundaries, speeds=None):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE working_clips SET segments_data = ? WHERE id = ?",
            (encode_data({"boundaries": list(boundaries), "segmentSpeeds": dict(speeds or {})}), clip_id),
        )
        conn.commit()


def _action(project_id, clip_id, action, data=None, target=None):
    payload = {"action": action}
    if data is not None:
        payload["data"] = data
    if target is not None:
        payload["target"] = target
    return client.post(
        f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
        json=payload,
    )


def _read_raw_stored_boundaries(clip_id):
    """Read the RAW stored blob (no canonicalize call in the test itself) --
    this is what asserts the ON-DISK format, per design's test #1 intent."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT segments_data FROM working_clips WHERE id = ?", (clip_id,))
        row = cursor.fetchone()
        seg = decode_data(row["segments_data"])
        return seg


def _put_clip(project_id, clip_id, segments_data):
    return client.put(
        f"/api/clips/projects/{project_id}/clips/{clip_id}",
        json={"segments_data": segments_data},
    )


# ---------------------------------------------------------------------------
# Test 1 -- gesture split_segment writes full-list boundaries to the DB
# ---------------------------------------------------------------------------

def test_gesture_split_segment_writes_full_list_boundaries(clip_with_raw_duration):
    """Design Sec 2.6 worked flow: split at 7 on a clip with raw_duration=10.0
    (no prior splits) must persist [0.0, 7.0, 10.0] on disk -- NOT [7.0]
    (today's non-canonical splits-only shape)."""
    project_id, clip_id, _raw_id = clip_with_raw_duration

    resp = _action(project_id, clip_id, "split_segment", data={"time": 7.0})
    assert resp.status_code == 200, resp.text

    stored = _read_raw_stored_boundaries(clip_id)
    assert stored is not None, "no segments_data persisted"
    assert stored["boundaries"] == [0.0, 7.0, 10.0], (
        f"expected canonical full-list [0.0, 7.0, 10.0] stored on disk, got "
        f"{stored['boundaries']} -- write-time canonicalization not implemented yet"
    )


# ---------------------------------------------------------------------------
# Test 2 -- second-gesture RMW correctness (THE regression guard, design Sec 2.4)
# ---------------------------------------------------------------------------

def test_split_then_remove_split_on_full_list_stored_row_reindexes_correctly(clip_with_raw_duration):
    """Split at 3, then split at 7 (both gesture actions) -> stored full-list
    should be [0,3,7,10]. Then remove_segment_split(3) must reindex speeds
    EXACTLY as the T4220 splits-only contract expects (k=0 -- the FIRST user
    split, not the leading 0.0). If the read side does not strip the stored
    full-list back to splits-only before the handler runs, `boundaries.index(3)`
    on [0,3,7,10] returns k=1 instead of k=0 and every speed reindexes wrong --
    this is the exact corruption design Sec 1.4/2.4 calls out."""
    project_id, clip_id, _raw_id = clip_with_raw_duration

    resp = _action(project_id, clip_id, "split_segment", data={"time": 3.0})
    assert resp.status_code == 200, resp.text
    resp = _action(project_id, clip_id, "split_segment", data={"time": 7.0})
    assert resp.status_code == 200, resp.text

    stored = _read_raw_stored_boundaries(clip_id)
    assert stored["boundaries"] == [0.0, 3.0, 7.0, 10.0], (
        f"precondition failed -- expected full-list [0,3,7,10] after two splits, "
        f"got {stored.get('boundaries')}"
    )

    # Seed T4220-style speeds keyed over the 3 physical intervals implied by the
    # 2 user splits (segmentSpeeds is ALWAYS keyed over the full-list intervals):
    #   interval 0 [0,3]=2.0   interval 1 [3,7]=1.0   interval 2 [7,10]=0.5
    with get_db_connection() as conn:
        cursor = conn.cursor()
        seg = dict(stored)
        seg["segmentSpeeds"] = {"0": 2.0, "1": 1.0, "2": 0.5}
        cursor.execute(
            "UPDATE working_clips SET segments_data = ? WHERE id = ?",
            (encode_data(seg), clip_id),
        )
        conn.commit()

    # Remove the split at 3.0 -- this is user split index k=0 (the FIRST split,
    # not the leading 0.0). Per T4220: i<k keep, k/k+1 merge (2.0 vs 1.0 differ
    # -> omitted), i>k+1 shift down by 1. So speeds "2":0.5 shifts to "1":0.5,
    # and the merged interval (was 0 and 1) has differing speeds -> omitted.
    resp = _action(project_id, clip_id, "remove_segment_split", data={"time": 3.0})
    assert resp.status_code == 200, resp.text

    stored_after = _read_raw_stored_boundaries(clip_id)
    speeds_after = stored_after.get("segmentSpeeds", {})
    assert speeds_after == {"1": 0.5}, (
        f"T4220 reindex corrupted by RMW format mismatch: expected {{'1': 0.5}} "
        f"(k=0 removal semantics on splits-only data), got {speeds_after}. "
        f"If the read side isn't stripping full-list boundaries back to "
        f"splits-only before the handler runs, k shifts by one and this fails."
    )


# ---------------------------------------------------------------------------
# Test 3 -- set_segment_speed after split lands on the correct interval
# ---------------------------------------------------------------------------

def test_set_segment_speed_after_split_lands_on_correct_interval(clip_with_raw_duration):
    """Split at 5.0 (raw_duration=10.0) -> two intervals [0,5] idx0, [5,10] idx1.
    set_segment_speed(target.segment_index=1, speed=0.5) must set the SECOND
    interval's speed. This must hold against the canonical full-list stored
    boundaries -- verifies canonicalization doesn't disturb segment-index
    semantics that set_segment_speed relies on."""
    project_id, clip_id, _raw_id = clip_with_raw_duration

    resp = _action(project_id, clip_id, "split_segment", data={"time": 5.0})
    assert resp.status_code == 200, resp.text

    resp = _action(
        project_id, clip_id, "set_segment_speed",
        data={"speed": 0.5}, target={"segment_index": 1},
    )
    assert resp.status_code == 200, resp.text

    stored = _read_raw_stored_boundaries(clip_id)
    assert stored["boundaries"] == [0.0, 5.0, 10.0], (
        f"expected canonical full-list [0,5,10], got {stored.get('boundaries')}"
    )
    assert stored.get("segmentSpeeds", {}).get("1") == 0.5, (
        f"speed did not land on interval index 1 ([5.0,10.0]) -- got "
        f"{stored.get('segmentSpeeds')}"
    )


# ---------------------------------------------------------------------------
# Test 4 -- PUT (update_working_clip) characterization: already full-list,
# UNCHANGED by this branch (design Sec 2.3). Should PASS today and after.
# ---------------------------------------------------------------------------

def test_put_update_working_clip_still_writes_full_list_unchanged(clip_with_raw_duration):
    """Characterization guard, not new behavior: the PUT path already writes
    whatever boundaries the frontend sends (full-list from saveCurrentClipState).
    Design Sec 2.3 says PUT needs NO code change. This must be true BEFORE and
    AFTER Stage 4 -- if it starts failing post-implementation, PUT was touched
    when it shouldn't have been."""
    project_id, clip_id, _raw_id = clip_with_raw_duration

    full_list_payload = {
        "boundaries": [0.0, 4.0, 10.0],
        "segmentSpeeds": {"0": 1.0, "1": 0.5},
        "trimRange": {"start": 0.0, "end": 10.0},
    }
    resp = _put_clip(project_id, clip_id, full_list_payload)
    assert resp.status_code == 200, resp.text

    stored = _read_raw_stored_boundaries(clip_id)
    assert stored["boundaries"] == [0.0, 4.0, 10.0]
    assert stored["segmentSpeeds"] == {"0": 1.0, "1": 0.5}


# ---------------------------------------------------------------------------
# Test 5 -- uploaded/orphan clip (no raw_clip_id / no raw_duration): no crash,
# no fabricated duration, splits-only stored unchanged, warning logged.
# ---------------------------------------------------------------------------

def test_orphan_clip_gesture_save_logs_warning_no_fabricated_duration(orphan_clip, caplog):
    """Design Sec 2.2 guard: raw_clip_id NULL -> no raw_duration derivable.
    canonicalize_segments_data(_, None) must log a warning and leave the blob
    splits-only (never fabricate a trailing boundary)."""
    project_id, clip_id = orphan_clip

    with caplog.at_level(logging.WARNING):
        resp = _action(project_id, clip_id, "split_segment", data={"time": 4.0})
    assert resp.status_code == 200, resp.text

    stored = _read_raw_stored_boundaries(clip_id)
    assert stored is not None
    assert stored["boundaries"] == [4.0], (
        f"orphan clip (no raw_duration) must NOT get a fabricated full-list "
        f"boundary -- expected splits-only [4.0] unchanged, got {stored['boundaries']}"
    )
    assert any(
        "source_duration" in rec.message or "raw_duration" in rec.message or "canonicalize" in rec.message.lower()
        for rec in caplog.records
    ), (
        "expected a warning to be logged when duration is unavailable for "
        "canonicalization (no-silent-fallback per CLAUDE.md); no matching log record found"
    )


# ---------------------------------------------------------------------------
# App import sanity (kickoff-required check, not a new test file)
# ---------------------------------------------------------------------------

class TestAppImportSanity:
    def test_app_main_imports_clean(self):
        from app.main import app as _app  # noqa: F401
        assert _app is not None
