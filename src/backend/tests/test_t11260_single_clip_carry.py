"""T11260: multi-clip highlight carry, clip boundaries and their Spotlight gates
are removed; single-clip carry is unchanged.

- C1 characterization: a single-clip Framing re-export carries highlights through
  the real finalize seam (`upsert_working_video`) to EXACTLY the regions/notes the
  pre-T11260 code produced (GOLDEN was captured on the base revision).
- C2 a legacy multi-clip draft (several working clips, one concatenated working
  video) still opens in Spotlight: /overlay-data serves its highlights, and no
  longer computes per-clip `clip_boundaries`.
- C3 zero references to the removed multi-clip symbols in src/ + scripts/.
"""

import json
import re
import subprocess
import uuid
from pathlib import Path

import pytest

from app.database import get_db_connection
from app.profile_context import set_current_profile_id
from app.services.export_finalize import upsert_working_video
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.utils.encoding import decode_data, encode_data

TEST_USER_ID = f"test_t11260_carry_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

REPO_ROOT = Path(__file__).resolve().parents[3]

CROP_A = [
    {"frame": 0, "x": 100, "y": 50, "width": 200, "height": 360},
    {"frame": 450, "x": 100, "y": 50, "width": 200, "height": 360},
]
CROP_B = [
    {"frame": 0, "x": 160, "y": 80, "width": 240, "height": 432},
    {"frame": 300, "x": 220, "y": 90, "width": 240, "height": 432},
]
DIMS = {"width": 1080, "height": 1920}
DETECTED = [
    {"id": "detected-x", "start_time": 9.0, "end_time": 10.0, "enabled": True,
     "keyframes": [{"time": 9.0, "x": 1, "y": 1, "radiusX": 1, "radiusY": 1, "opacity": 0.15, "color": "#FFFF00"}]},
]
NO_MODS = {"boundaries": [0.0, 15.0], "segmentSpeeds": {}, "trimRange": None}
TRIM = {"boundaries": [0.0, 15.0], "segmentSpeeds": {}, "trimRange": {"start": 2.0, "end": 12.0}}
SLOW = {"boundaries": [0.0, 5.0, 10.0, 15.0], "segmentSpeeds": {"1": 0.5}, "trimRange": None}


def _clip(segments, crop=CROP_A):
    return {"crop_keyframes": crop, "segments_data": segments, "fps": 30.0, "raw_duration": 15.0}


def _snap(clips):
    return {"clip_count": len(clips), "video_dims": DIMS, "clips": clips,
            "transition": {"type": "cut", "duration": 0.0}}


def _region(rid, start, end, *, enabled=True, label=None, kf_offsets=(0.0,)):
    r = {"id": rid, "start_time": start, "end_time": end, "enabled": enabled,
         "keyframes": [{"time": start + o, "x": 540 + 10 * i, "y": 960 - 5 * i, "radiusX": 50, "radiusY": 100,
                        "opacity": 0.15, "color": "#FFFF00"} for i, o in enumerate(kf_offsets)]}
    if label:
        r["label"] = label
    return r


PRIOR = [
    _region("a", 1.0, 2.5, label="early"),            # trimmed out by TRIM
    _region("b", 4.0, 6.0, kf_offsets=(0.0, 1.0)),
    _region("c", 7.0, 9.0, kf_offsets=(0.0, 0.5, 1.5)),
    _region("d", 11.0, 13.0, enabled=False),
]

# name -> (old framing, new framing)
SCENARIOS = {
    "trim": (_snap([_clip(NO_MODS)]), _snap([_clip(TRIM)])),
    "slowmo": (_snap([_clip(NO_MODS)]), _snap([_clip(SLOW)])),
    "crop": (_snap([_clip(NO_MODS)]), _snap([_clip(NO_MODS, CROP_B)])),
    "untrim_and_crop": (_snap([_clip(TRIM)]), _snap([_clip(SLOW, CROP_B)])),
    "unchanged": (_snap([_clip(TRIM)]), _snap([_clip(dict(TRIM))])),
}

GOLDEN_PATH = Path(__file__).parent / "fixtures" / "t11260_single_clip_carry_golden.json"


@pytest.fixture
def project():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T11260 Carry', '9:16')")
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


def _reexport(project_id, old_snap, new_snap):
    """Seed a prior version carrying PRIOR authored against old_snap, then finalize
    a re-export with new_snap; return (carried regions, carry note)."""
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO working_videos (project_id, filename, version, highlights_data, framing_snapshot) "
            "VALUES (?, 'v1.mp4', 1, ?, ?)",
            (project_id, encode_data(PRIOR), encode_data(old_snap)),
        )
        prior_wv = cur.lastrowid
        cur.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (prior_wv, project_id))
        export_id = f"exp_{uuid.uuid4().hex[:10]}"
        cur.execute(
            "INSERT INTO export_jobs (id, project_id, type, status, input_data) "
            "VALUES (?, ?, 'framing', 'processing', ?)",
            (export_id, project_id, encode_data({})),
        )
        conn.commit()
    upsert_working_video(
        {"id": export_id, "project_id": project_id, "output_video_id": None},
        filename="v2.mp4", duration=15.0,
        highlights_data=encode_data(DETECTED), detections_data=None,
        new_framing_snapshot=new_snap,
    )
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT highlights_data, highlight_carry_note FROM working_videos "
            "WHERE project_id = ? AND id != ? ORDER BY id DESC LIMIT 1",
            (project_id, prior_wv),
        )
        row = cur.fetchone()
    return decode_data(row["highlights_data"]), row["highlight_carry_note"]


def _rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, list):
        return [_rounded(v) for v in value]
    if isinstance(value, dict):
        return {k: _rounded(v) for k, v in value.items()}
    return value


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_single_clip_reexport_carry_matches_pre_t11260_golden(project, name):
    old_snap, new_snap = SCENARIOS[name]
    regions, note = _reexport(project, old_snap, new_snap)
    golden = json.loads(GOLDEN_PATH.read_text())[name]
    assert {"regions": _rounded(regions), "note": note} == golden


def test_legacy_multiclip_prior_snapshot_is_refused_not_transformed(project):
    """A legacy multi-clip working video can never be re-framed (T11220/T11250
    refuse it), so a carry against a multi-clip OLD snapshot is an impossible
    state: fail loudly instead of running per-clip offset math."""
    old_snap = _snap([_clip(NO_MODS), _clip(NO_MODS)])
    new_snap = _snap([_clip(TRIM)])
    with pytest.raises(ValueError, match="single-clip"):
        _reexport(project, old_snap, new_snap)


class TestLegacyMulticlipDraftOpensInSpotlight:
    @pytest.fixture(autouse=True)
    def _client(self, project):
        from fastapi.testclient import TestClient

        from app.main import app

        self.client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})
        self.project_id = project

    def test_overlay_data_serves_highlights_without_clip_boundaries(self):
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO working_clips (project_id, uploaded_filename, version, sort_order, segments_data) "
                "VALUES (?, 'wc2.mp4', 1, 1, ?)",
                (self.project_id, encode_data(NO_MODS)),
            )
            cur.execute(
                "INSERT INTO working_videos (project_id, filename, version, duration, highlights_data) "
                "VALUES (?, 'concat.mp4', 1, 30.0, ?)",
                (self.project_id, encode_data(PRIOR)),
            )
            cur.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (cur.lastrowid, self.project_id))
            conn.commit()
        resp = self.client.get(f"/api/export/projects/{self.project_id}/overlay-data")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [r["id"] for r in body["highlights_data"]] == ["a", "b", "c", "d"]
        assert "clip_boundaries" not in body


REMOVED_SYMBOLS = [
    "_attribute_clip_index",
    "_transform_multi_clip",
    "_dissolve_offsets_unavailable",
    "NOTE_MULTICLIP_RESET",
    "multiclip_reset",
    "concat_offsets",
    "clip_boundary_offsets",
    "_accumulate_clip_boundary_offsets",
    "clip_boundaries",
    "clipBoundaries",
    "hasMultipleClips",
    "NEEDS_SHARPEN_MANY",
]


def test_zero_references_to_removed_multiclip_symbols():
    pattern = "|".join(re.escape(s) for s in REMOVED_SYMBOLS)
    proc = subprocess.run(
        ["git", "grep", "-nwE", pattern, "--", "src", "scripts",
         ":!src/backend/app/migrations", ":!src/backend/tests/test_t11260_single_clip_carry.py",
         ":!src/backend/tests/.test_durations.json", ":!src/frontend/test-output.txt"],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    assert proc.returncode == 1, f"removed symbols still referenced:\n{proc.stdout}"
