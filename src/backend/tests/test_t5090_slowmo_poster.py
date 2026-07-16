"""T5090: Slow-mo-first reel poster (clearest frame in first half of slow-mo).

Covers:
- first_slowmo_section window math: single clip, multi-clip offset, trimRange,
  splits-only boundary canonicalization, no-slow-mo -> None
- generate_and_store_poster policy plumbing: slow-mo -> clearest frame in the
  FIRST HALF window; no slow-mo / missing data -> plain first frame
- extract_clearest_frame_jpeg window actually restricts sampling (real ffmpeg)
- read_clip_segments_for_project / load_project_clip_segments read the project's
  latest working clips in sort order (real DB)
- backfill reconstructs segments per final video (SAME policy as live publish)
- poster failure never fails the export (finalize best-effort preserved)
"""

import shutil
import sqlite3
import subprocess
from unittest.mock import patch

import pytest

from app.services import poster as poster_mod
from app.services.poster import (
    first_slowmo_section,
    generate_and_store_poster,
    load_project_clip_segments,
    read_clip_segments_for_project,
)
from app.utils.encoding import encode_data

USER_ID = "test-user-t5090"
PROFILE_ID = "t5090prof"

_HAS_FFMPEG = shutil.which("ffmpeg") is not None


# ---------------------------------------------------------------------------
# first_slowmo_section: window math (pure, no I/O)
# ---------------------------------------------------------------------------

def test_single_clip_midreel_slowmo():
    # boundaries [0,2,4,6]; seg1 is 0.5x. seg0 = 2s@1.0 -> 2s output; seg1 =
    # 2s@0.5 -> 4s output starting at final offset 2.0 -> section [2, 6].
    sd = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    assert first_slowmo_section([(sd, 6.0)]) == (2.0, 6.0)


def test_first_of_two_slowmo_sections_wins():
    # Two slow-mo segments; only the FIRST is returned.
    sd = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"0": 0.5, "2": 0.5}}
    # seg0 = 2s@0.5 -> 4s output at offset 0 -> section [0, 4].
    assert first_slowmo_section([(sd, 6.0)]) == (0.0, 4.0)


def test_no_slowmo_returns_none():
    sd = {"boundaries": [0, 2, 4], "segmentSpeeds": {"1": 2.0}}  # speed-up only
    assert first_slowmo_section([(sd, 4.0)]) is None
    assert first_slowmo_section([({"boundaries": [0, 4], "segmentSpeeds": {}}, 4.0)]) is None


def test_multi_clip_offset():
    # clip0: 3s, no slow-mo. clip1: seg0 0.5x (1s src -> 2s out at local offset 0).
    clip0 = {"boundaries": [0, 3], "segmentSpeeds": {}}
    clip1 = {"boundaries": [0, 1, 3], "segmentSpeeds": {"0": 0.5}}
    # first slow-mo is clip1.seg0 at global offset 3.0 -> section [3, 5].
    assert first_slowmo_section([(clip0, 3.0), (clip1, 3.0)]) == (3.0, 5.0)


def test_trimrange_skips_trimmed_slowmo():
    # seg0 (0-2) is 0.5x but FULLY trimmed away; seg2 (4-6) is the first VISIBLE
    # slow-mo. trim [2,6]: seg1 (2-4)@1.0 -> 2s output; seg2 (4-6)@0.5 -> 4s output
    # at offset 2.0 -> section [2, 6].
    sd = {
        "boundaries": [0, 2, 4, 6],
        "segmentSpeeds": {"0": 0.5, "2": 0.5},
        "trimRange": {"start": 2.0, "end": 6.0},
    }
    assert first_slowmo_section([(sd, 6.0)]) == (2.0, 6.0)


def test_splits_only_boundaries_canonicalized():
    # boundaries [2] is splits-only (first > 0.01): canonicalize -> [0, 2, 6].
    # seg0 (0-2)@1.0 -> 2s; seg1 (2-6)@0.5 -> 8s output at offset 2 -> [2, 10].
    sd = {"boundaries": [2], "segmentSpeeds": {"1": 0.5}}
    assert first_slowmo_section([(sd, 6.0)]) == (2.0, 10.0)


def test_empty_and_none_inputs():
    assert first_slowmo_section([]) is None
    assert first_slowmo_section(None) is None
    assert first_slowmo_section([(None, 5.0)]) is None


# ---------------------------------------------------------------------------
# generate_and_store_poster: slow-mo -> first-half window; else first frame
# ---------------------------------------------------------------------------

def test_generate_poster_slowmo_samples_first_half(monkeypatch):
    captured = {}

    def fake_clearest(source, output_path, window=None):
        captured["window"] = window
        from pathlib import Path
        Path(output_path).write_bytes(b"\xff\xd8jpeg")
        return True

    def boom_first(source, output_path):
        raise AssertionError("first-frame path must NOT run when slow-mo exists")

    monkeypatch.setattr(poster_mod, "generate_presigned_url", lambda *a, **k: "http://x/v.mp4")
    monkeypatch.setattr(poster_mod, "extract_clearest_frame_jpeg", fake_clearest)
    monkeypatch.setattr(poster_mod, "extract_first_frame_jpeg", boom_first)
    monkeypatch.setattr(poster_mod, "_jpeg_dimensions", lambda p: (100, 200))
    monkeypatch.setattr(poster_mod, "upload_bytes_to_r2", lambda *a, **k: True)

    clips = [({"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}, 6.0)]
    res = generate_and_store_poster(USER_ID, "reel.mp4", clips)
    assert res == "reel.mp4.jpg"
    # Section is [2, 6]; poster samples the FIRST HALF only -> (2.0, 4.0).
    assert captured["window"] == (2.0, 4.0)


def test_generate_poster_no_slowmo_uses_first_frame(monkeypatch):
    called = {}

    def fake_first(source, output_path):
        called["yes"] = True
        from pathlib import Path
        Path(output_path).write_bytes(b"\xff\xd8jpeg")
        return True

    def boom_clearest(source, output_path, window=None):
        raise AssertionError("clearest path must NOT run without slow-mo")

    monkeypatch.setattr(poster_mod, "generate_presigned_url", lambda *a, **k: "http://x/v.mp4")
    monkeypatch.setattr(poster_mod, "extract_first_frame_jpeg", fake_first)
    monkeypatch.setattr(poster_mod, "extract_clearest_frame_jpeg", boom_clearest)
    monkeypatch.setattr(poster_mod, "_jpeg_dimensions", lambda p: (100, 200))
    monkeypatch.setattr(poster_mod, "upload_bytes_to_r2", lambda *a, **k: True)

    clips = [({"boundaries": [0, 2, 4], "segmentSpeeds": {}}, 4.0)]
    assert generate_and_store_poster(USER_ID, "reel.mp4", clips) == "reel.mp4.jpg"
    assert called.get("yes")


def test_generate_poster_missing_segments_uses_first_frame(monkeypatch):
    called = {}

    def fake_first(source, output_path):
        called["yes"] = True
        from pathlib import Path
        Path(output_path).write_bytes(b"\xff\xd8jpeg")
        return True

    monkeypatch.setattr(poster_mod, "generate_presigned_url", lambda *a, **k: "http://x/v.mp4")
    monkeypatch.setattr(poster_mod, "extract_first_frame_jpeg", fake_first)
    monkeypatch.setattr(
        poster_mod, "extract_clearest_frame_jpeg",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no window without data")),
    )
    monkeypatch.setattr(poster_mod, "_jpeg_dimensions", lambda p: None)
    monkeypatch.setattr(poster_mod, "upload_bytes_to_r2", lambda *a, **k: True)

    # Unreconstructable ([]) AND default None both -> first frame.
    assert generate_and_store_poster(USER_ID, "reel.mp4", []) == "reel.mp4.jpg"
    assert generate_and_store_poster(USER_ID, "reel.mp4") == "reel.mp4.jpg"
    assert called.get("yes")


# ---------------------------------------------------------------------------
# extract_clearest_frame_jpeg: the window really restricts sampling (real ffmpeg)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _HAS_FFMPEG, reason="ffmpeg not available")
def test_window_restricts_sampling(tmp_path):
    from pathlib import Path

    # 2s detailed test pattern, then 2s of black.
    src = str(tmp_path / "clip.mp4")
    subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2",
         "-f", "lavfi", "-i", "color=black:s=320x240:d=2",
         "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]",
         "-map", "[v]", src],
        capture_output=True, check=True, timeout=60,
    )
    detailed = str(tmp_path / "detail.jpg")
    black = str(tmp_path / "black.jpg")
    assert poster_mod.extract_clearest_frame_jpeg(src, detailed, window=(0.0, 2.0))
    assert poster_mod.extract_clearest_frame_jpeg(src, black, window=(2.0, 4.0))
    # A frame sampled inside the detailed window is much richer than one from the
    # black window -> the window bounds where we sample.
    assert Path(detailed).stat().st_size > Path(black).stat().st_size * 2


@pytest.mark.skipif(not _HAS_FFMPEG, reason="ffmpeg not available")
def test_degenerate_window_falls_back_to_first_frame(tmp_path, monkeypatch):
    called = {}
    monkeypatch.setattr(
        poster_mod, "extract_first_frame_jpeg",
        lambda s, o: called.setdefault("yes", True) or True,
    )
    assert poster_mod.extract_clearest_frame_jpeg("x.mp4", str(tmp_path / "o.jpg"), window=(3.0, 3.0))
    assert called.get("yes")


# ---------------------------------------------------------------------------
# DB reads: read_clip_segments_for_project / load_project_clip_segments
# ---------------------------------------------------------------------------

@pytest.fixture()
def db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_slowmo_project(db_path, segments, raw_start=0.0, raw_end=6.0):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('R', '9:16')")
    pid = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time) VALUES ('c.mp4', 5, ?, ?)",
        (raw_start, raw_end),
    )
    rc = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, segments_data) "
        "VALUES (?, ?, 1, 0, ?)",
        (pid, rc, encode_data(segments)),
    )
    conn.commit()
    conn.close()
    return pid


def test_read_clip_segments_for_project(db):
    segments = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    pid = _seed_slowmo_project(db, segments)
    conn = _connect(db)
    rows = read_clip_segments_for_project(conn.cursor(), pid)
    conn.close()
    assert rows == [(segments, 6.0)]
    # And the policy locates the section end-to-end from the DB read.
    assert first_slowmo_section(rows) == (2.0, 6.0)


def test_load_project_clip_segments_none_and_missing(db):
    assert load_project_clip_segments(None) == []
    assert load_project_clip_segments(999999) == []  # no such project -> [] (first frame)


def test_read_clip_segments_null_segments(db):
    # A working clip with no segments_data -> (None, source_duration); no crash.
    conn = _connect(db)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('R', '9:16')")
    pid = cur.lastrowid
    cur.execute("INSERT INTO raw_clips (filename, rating, start_time, end_time) VALUES ('c.mp4', 5, 0.0, 4.0)")
    rc = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) VALUES (?, ?, 1, 0)",
        (pid, rc),
    )
    conn.commit()
    rows = read_clip_segments_for_project(cur, pid)
    conn.close()
    assert rows == [(None, 4.0)]
    assert first_slowmo_section(rows) is None


# ---------------------------------------------------------------------------
# Finalize threads segments; best-effort preserved (poster never fails export)
# ---------------------------------------------------------------------------

def _seed_full_project(db_path, segments):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('R', '9:16')")
    pid = cur.lastrowid
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) VALUES (?, 'wv.mp4', 1, 6.0)",
        (pid,),
    )
    cur.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (cur.lastrowid, pid))
    cur.execute("INSERT INTO raw_clips (filename, rating, start_time, end_time) VALUES ('c.mp4', 5, 0.0, 6.0)")
    rc = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, segments_data) "
        "VALUES (?, ?, 1, 0, ?)",
        (pid, rc, encode_data(segments)),
    )
    cur.execute(
        "INSERT INTO export_jobs (id, project_id, type, input_data) VALUES ('expP', ?, 'overlay', x'00')",
        (pid,),
    )
    conn.commit()
    conn.close()
    return pid


def test_finalize_threads_slowmo_segments(db):
    from app.routers.export import overlay

    segments = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    pid = _seed_full_project(db, segments)
    seen = {}

    def capture(user_id, filename, clip_segments=None):
        seen["clip_segments"] = clip_segments
        return "out.mp4.jpg"

    with patch("app.analytics.record_milestone"), \
         patch.object(overlay, "generate_and_store_poster", side_effect=capture):
        fv_id = overlay._finalize_overlay_export(pid, "out.mp4", "expP", USER_ID)

    # The project's ordered slow-mo segments reached the poster generator.
    assert seen["clip_segments"] == [(segments, 6.0)]
    row = _connect(db).execute(
        "SELECT poster_filename FROM final_videos WHERE id = ?", (fv_id,)).fetchone()
    assert row["poster_filename"] == "out.mp4.jpg"


def test_finalize_best_effort_when_poster_fails(db):
    from app.routers.export import overlay

    pid = _seed_full_project(db, {"boundaries": [0, 6], "segmentSpeeds": {}})
    with patch("app.analytics.record_milestone"), \
         patch.object(overlay, "generate_and_store_poster", return_value=None):
        fv_id = overlay._finalize_overlay_export(pid, "out.mp4", "expP", USER_ID)
    row = _connect(db).execute(
        "SELECT poster_filename FROM final_videos WHERE id = ?", (fv_id,)).fetchone()
    assert row["poster_filename"] is None  # export still succeeded


# ---------------------------------------------------------------------------
# Backfill reconstructs segments per final video (same policy as live)
# ---------------------------------------------------------------------------

def test_backfill_reconstructs_segments(db):
    # A published reel whose project still has its slow-mo working clip.
    segments = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    pid = _seed_full_project(db, segments)
    conn = _connect(db)
    conn.execute(
        "INSERT INTO final_videos (id, project_id, filename, published_at) VALUES (77, ?, 'r.mp4', '2026-01-01')",
        (pid,),
    )
    conn.commit()
    conn.close()

    seen = {}

    def capture(user_id, filename, clip_segments=None):
        seen["clip_segments"] = clip_segments
        return "r.mp4.jpg"

    def fake_exists(user_id, rel_path):
        return rel_path == "final_videos/r.mp4"  # video present, poster absent

    with patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}]), \
         patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]), \
         patch("app.migrations._migrate_profile_db") as mig, \
         patch("app.storage.file_exists_in_r2", side_effect=fake_exists), \
         patch.object(poster_mod, "generate_and_store_poster", side_effect=capture), \
         patch("app.database.sync_db_to_r2_explicit", return_value=True):
        mig.return_value = type("R", (), {"status": "ok"})()
        res = poster_mod.backfill_posters(limit=25, dry_run=False)

    assert set(res["generated"]) == {77}
    # Backfill reconstructed the SAME ordered segments live publish would use.
    assert seen["clip_segments"] == [(segments, 6.0)]
