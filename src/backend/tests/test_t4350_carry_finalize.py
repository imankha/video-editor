"""T4350 — integration tests for highlight carry-forward through the shared
`upsert_working_video` finalize transaction (services/export_finalize.py).

These exercise the REAL profile DB (mirroring the T5630 harness) to pin the
finalize seam the expert flagged as load-bearing:
- carry/transform the prior version's user-edited highlights onto the NEW version
  instead of seeding the freshly-detected regions,
- the verbatim fast-path when framing is unchanged,
- first-export seeding (no prior highlights),
- legacy rows (no prior framing snapshot) carry verbatim + loud note,
- IDEMPOTENCY: the resume/UPDATE branch must PRESERVE the carried highlights
  (never re-seed detected regions over them).
"""

import uuid

import pytest

from app.database import get_db_connection
from app.highlight_transform import (
    canonicalize_segments_data,
    source_time_to_working_time,
    working_time_to_source_time,
)
from app.profile_context import set_current_profile_id
from app.services.export_finalize import upsert_working_video
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.utils.encoding import decode_data, encode_data

TEST_USER_ID = f"test_t4350_carry_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

CROP = [
    {"frame": 0, "x": 100, "y": 50, "width": 200, "height": 360},
    {"frame": 450, "x": 100, "y": 50, "width": 200, "height": 360},
]
DIMS = {"width": 1080, "height": 1920}
DETECTED = [
    {"id": "detected-x", "start_time": 99.0, "end_time": 100.0, "enabled": True,
     "keyframes": [{"time": 99.0, "x": 1, "y": 1, "radiusX": 1, "radiusY": 1, "opacity": 0.15, "color": "#FFFF00"}]},
]


def _clip_entry(segments):
    return {"crop_keyframes": CROP, "segments_data": segments, "fps": 30.0, "raw_duration": 15.0}


def _snapshot(clip_count, clips):
    return {"clip_count": clip_count, "video_dims": DIMS, "clips": clips}


def _region(rid, start, end):
    return {"id": rid, "start_time": start, "end_time": end, "enabled": True,
            "keyframes": [{"time": start, "x": 540, "y": 960, "radiusX": 50, "radiusY": 100,
                           "opacity": 0.15, "color": "#FFFF00"}]}


NO_MODS = {"boundaries": [0.0, 15.0], "segmentSpeeds": {}, "trimRange": None}
TRIM_2 = {"boundaries": [0.0, 15.0], "segmentSpeeds": {}, "trimRange": {"start": 2.0, "end": 15.0}}


@pytest.fixture
def project():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T4350 Carry', '9:16')")
        project_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, uploaded_filename, version) VALUES (?, 'wc.mp4', 1)",
            (project_id,),
        )
        conn.commit()
    yield project_id
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,))
        cur.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cur.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cur.execute("DELETE FROM export_jobs WHERE project_id = ?", (project_id,))
        cur.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _seed_prior_version(project_id, highlights, snapshot):
    """Insert a prior working_videos version, point the project at it."""
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO working_videos (project_id, filename, version, highlights_data, framing_snapshot)
               VALUES (?, 'v1.mp4', 1, ?, ?)""",
            (project_id, encode_data(highlights) if highlights is not None else None,
             encode_data(snapshot) if snapshot is not None else None),
        )
        wv_id = cur.lastrowid
        cur.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (wv_id, project_id))
        conn.commit()
    return wv_id


def _make_job(project_id, output_video_id=None):
    export_id = f"exp_{uuid.uuid4().hex[:10]}"
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO export_jobs (id, project_id, type, status, input_data) VALUES (?, ?, 'framing', 'processing', ?)",
            (export_id, project_id, encode_data({})),
        )
        conn.commit()
    return {"id": export_id, "project_id": project_id, "output_video_id": output_video_id}


def _read_new_version(project_id, exclude_wv_id):
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, highlights_data, framing_snapshot, highlight_carry_note, version "
            "FROM working_videos WHERE project_id = ? AND id != ? ORDER BY id DESC LIMIT 1",
            (project_id, exclude_wv_id or -1),
        )
        return cur.fetchone()


def test_carry_transforms_on_trim_change(project):
    """Prior user highlight + a NEW trim -> the new version carries the TRANSFORMED
    region (shifted time), NOT the freshly-detected regions."""
    old_snap = _snapshot(1, [_clip_entry(NO_MODS)])
    new_snap = _snapshot(1, [_clip_entry(TRIM_2)])
    prior = _seed_prior_version(project, [_region("r1", 5.0, 7.0)], old_snap)

    job = _make_job(project)
    wv_id = upsert_working_video(
        job, filename="v2.mp4", duration=13.0,
        highlights_data=encode_data(DETECTED), detections_data=None,
        new_framing_snapshot=new_snap,
    )
    assert wv_id != prior
    row = _read_new_version(project, prior)
    carried = decode_data(row["highlights_data"])
    assert len(carried) == 1
    assert carried[0]["id"] == "r1"  # carried, not the "detected-x" seed
    old_canon = canonicalize_segments_data(NO_MODS, 15.0)
    new_canon = canonicalize_segments_data(TRIM_2, 15.0)
    expected = source_time_to_working_time(working_time_to_source_time(5.0, old_canon), new_canon)
    assert carried[0]["start_time"] == pytest.approx(expected, abs=0.05)
    assert row["highlight_carry_note"] is None
    assert row["framing_snapshot"] is not None  # NEW snapshot persisted for the next re-export


def test_fast_path_verbatim_when_framing_unchanged(project):
    snap = _snapshot(1, [_clip_entry(NO_MODS)])
    prior_regions = [_region("keep", 2.0, 5.0)]
    prior = _seed_prior_version(project, prior_regions, snap)

    job = _make_job(project)
    upsert_working_video(
        job, filename="v2.mp4", duration=15.0,
        highlights_data=encode_data(DETECTED), detections_data=None,
        new_framing_snapshot=_snapshot(1, [_clip_entry(dict(NO_MODS))]),
    )
    row = _read_new_version(project, prior)
    carried = decode_data(row["highlights_data"])
    assert [r["id"] for r in carried] == ["keep"]
    assert carried[0]["start_time"] == 2.0  # unchanged
    assert row["highlight_carry_note"] is None


def test_first_export_seeds_detected(project):
    """No prior highlights -> the detected regions seed the first version."""
    job = _make_job(project)
    upsert_working_video(
        job, filename="v1.mp4", duration=15.0,
        highlights_data=encode_data(DETECTED), detections_data=None,
        new_framing_snapshot=_snapshot(1, [_clip_entry(NO_MODS)]),
    )
    row = _read_new_version(project, None)
    seeded = decode_data(row["highlights_data"])
    assert [r["id"] for r in seeded] == ["detected-x"]
    assert row["highlight_carry_note"] is None


def test_legacy_no_snapshot_carries_verbatim_with_note(project):
    prior = _seed_prior_version(project, [_region("r1", 2.0, 5.0)], None)  # NULL framing_snapshot
    job = _make_job(project)
    upsert_working_video(
        job, filename="v2.mp4", duration=15.0,
        highlights_data=encode_data(DETECTED), detections_data=None,
        new_framing_snapshot=_snapshot(1, [_clip_entry(TRIM_2)]),
    )
    row = _read_new_version(project, prior)
    carried = decode_data(row["highlights_data"])
    assert [r["id"] for r in carried] == ["r1"]
    assert row["highlight_carry_note"] == "legacy_uncertain"


def test_resume_update_preserves_carried_highlights(project):
    """IDEMPOTENCY: a recovery re-run (output_video_id set -> UPDATE branch) must
    NOT re-seed the detected regions over the carried ones."""
    old_snap = _snapshot(1, [_clip_entry(NO_MODS)])
    new_snap = _snapshot(1, [_clip_entry(TRIM_2)])
    prior = _seed_prior_version(project, [_region("r1", 5.0, 7.0)], old_snap)

    # First finalize: INSERT + carry.
    job = _make_job(project)
    wv_id = upsert_working_video(
        job, filename="v2.mp4", duration=13.0,
        highlights_data=encode_data(DETECTED), detections_data=None,
        new_framing_snapshot=new_snap,
    )
    first = decode_data(_read_new_version(project, prior)["highlights_data"])

    # Recovery re-run: same job, output_video_id now set -> UPDATE branch, fresh
    # detection passed again. Highlights must be UNCHANGED.
    resume_job = {"id": job["id"], "project_id": project, "output_video_id": wv_id}
    wv_id2 = upsert_working_video(
        resume_job, filename="v2.mp4", duration=13.0,
        highlights_data=encode_data(DETECTED), detections_data=None,
        new_framing_snapshot=new_snap,
    )
    assert wv_id2 == wv_id  # same row, no new version
    row = _read_new_version(project, prior)
    after = decode_data(row["highlights_data"])
    assert after == first  # carried highlights preserved across the resume
    assert [r["id"] for r in after] == ["r1"]
