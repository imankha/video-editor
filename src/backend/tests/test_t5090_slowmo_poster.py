"""T5090: Slow-mo section location (multi-clip, final-timeline offset math).

Covers:
- first_slowmo_section window math: single clip, multi-clip offset, trimRange,
  splits-only boundary canonicalization, no-slow-mo -> None
- extract_clearest_frame_jpeg window actually restricts sampling (real ffmpeg;
  still used by recap/draft posters, T5410 dropped it from the reel path)
- read_clip_segments_for_project / load_project_clip_segments read the project's
  latest working clips in sort order (real DB)
- backfill reconstructs segments per final video (SAME policy as live export,
  T5410: open_play_window, no ranking; T6630 round 7: 2s into the window
  rather than the midpoint)
- poster failure never fails the export (finalize best-effort preserved)

T5410 note: the byte-size "clearest frame in the first half" reel policy this
file originally covered was REPLACED by the open-play window gate
(open_play_window/select_poster_frame, tests in test_t5410_poster_selection.py)
-- generate_and_store_poster was CUT. This file keeps the still-true
first_slowmo_section/DB-read/backfill coverage and drops the retired plumbing
tests.
"""

import shutil
import sqlite3
import subprocess
from unittest.mock import patch

import pytest

from app.services import poster as poster_mod
from app.services.poster import (
    first_slowmo_section,
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


def test_leading_segmentless_clip_with_unknown_duration_bails():
    # A leading uploaded clip (no segments_data, no raw_clips row -> source_duration
    # None) has an UNKNOWN output length. We must NOT accumulate a 0.0 offset that
    # would mis-place clip 1's slow-mo at the start; bail to first frame (None).
    clip1 = {"boundaries": [0, 1, 3], "segmentSpeeds": {"0": 0.5}}
    assert first_slowmo_section([(None, None), (clip1, 3.0)]) is None
    # Sanity: with a KNOWN leading duration the offset is correct.
    assert first_slowmo_section([(None, 3.0), (clip1, 3.0)]) == (3.0, 5.0)


# ---------------------------------------------------------------------------
# extract_clearest_frame_jpeg: the window really restricts sampling (real ffmpeg)
# -- still used by recap (T5180) and draft (T5671) posters; T5410 dropped it
# from the reel path (see test_t5410_poster_selection.py).
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


# ---------------------------------------------------------------------------
# Archive reconstruction: segments_from_archive / resolve_slowmo_section
# ---------------------------------------------------------------------------

def test_segments_from_archive_latest_version_and_order():
    from app.services.poster import segments_from_archive

    s_old = {"boundaries": [0, 3], "segmentSpeeds": {}}
    s_new = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    s_first = {"boundaries": [0, 3], "segmentSpeeds": {}}
    archive = {"working_clips": [
        {"raw_clip_id": 9, "version": 1, "sort_order": 1, "segments_data": encode_data(s_old)},
        {"raw_clip_id": 9, "version": 2, "sort_order": 1, "segments_data": encode_data(s_new)},
        {"raw_clip_id": 5, "version": 1, "sort_order": 0, "segments_data": encode_data(s_first)},
    ]}
    # Latest version per identity (clip 9 -> v2), ordered by sort_order (clip 5 first).
    assert segments_from_archive(archive) == [(s_first, None), (s_new, None)]


def test_segments_from_archive_empty():
    from app.services.poster import segments_from_archive
    assert segments_from_archive(None) == []
    assert segments_from_archive({"working_clips": []}) == []


def test_resolve_slowmo_section_prefers_working_clips(db):
    segments = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    pid = _seed_slowmo_project(db, segments)
    with patch("app.services.project_archive.load_archive") as la:
        section, src = poster_mod.resolve_slowmo_section(USER_ID, pid)
    assert section == (2.0, 6.0)
    assert src == "working_clips"
    la.assert_not_called()  # live clips present -> never touch the archive


def test_resolve_slowmo_section_falls_back_to_archive(db):
    # No live working clips (pruned at publish) -> reconstruct from the R2 archive.
    segments = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    archive = {"working_clips": [
        {"raw_clip_id": 9, "version": 1, "sort_order": 0, "segments_data": encode_data(segments)},
    ]}
    with patch("app.services.project_archive.load_archive", return_value=archive):
        section, src = poster_mod.resolve_slowmo_section(USER_ID, 123456)
    assert section == (2.0, 6.0)
    assert src == "archive"


def test_resolve_slowmo_section_unreconstructable(db):
    with patch("app.services.project_archive.load_archive", return_value=None):
        section, src = poster_mod.resolve_slowmo_section(USER_ID, 999999)
    assert section is None
    assert src == "unreconstructable"


# ---------------------------------------------------------------------------
# v025 migration: adds columns + backfills from the R2 archive (tuple rows)
# ---------------------------------------------------------------------------

def test_v025_adds_columns_and_backfills_from_archive(tmp_path):
    from app.migrations.profile_db import RUNNER
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    path = tmp_path / "profile.sqlite"
    # Raw sqlite3.connect -> TUPLE row factory, exactly like the migration runner.
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE final_videos (id INTEGER PRIMARY KEY, project_id INTEGER, "
        "filename TEXT, published_at TIMESTAMP, poster_filename TEXT)"
    )
    # id=1: has a slow-mo archive; id=2: no archive; id=3: unpublished (never a candidate).
    conn.execute("INSERT INTO final_videos VALUES (1, 500, 'r.mp4', '2026-01-01', NULL)")
    conn.execute("INSERT INTO final_videos VALUES (2, 501, 'n.mp4', '2026-01-01', NULL)")
    conn.execute("INSERT INTO final_videos VALUES (3, 502, 'd.mp4', NULL, NULL)")
    conn.execute("PRAGMA user_version = 24")
    conn.commit()

    set_current_user_id("u-v025")
    set_current_profile_id("p-v025")

    slowmo = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    archives = {
        500: {"working_clips": [
            {"raw_clip_id": 9, "version": 1, "sort_order": 0, "segments_data": encode_data(slowmo)},
        ]},
    }

    def fake_load_archive(project_id, user_id=None):
        return archives.get(project_id)

    with patch("app.services.project_archive.load_archive", side_effect=fake_load_archive):
        applied = RUNNER.run(conn, "sqlite")

    assert 25 in [m.version for m in applied]
    cols = {r[1] for r in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
    assert {"slowmo_section_start", "slowmo_section_end"} <= cols
    # id=1 backfilled from archive; id=2 (no archive) + id=3 (unpublished) stay NULL.
    assert conn.execute(
        "SELECT slowmo_section_start, slowmo_section_end FROM final_videos WHERE id=1"
    ).fetchone() == (2.0, 6.0)
    assert conn.execute(
        "SELECT slowmo_section_start, slowmo_section_end FROM final_videos WHERE id=2"
    ).fetchone() == (None, None)
    assert conn.execute(
        "SELECT slowmo_section_start, slowmo_section_end FROM final_videos WHERE id=3"
    ).fetchone() == (None, None)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == RUNNER.latest_version

    # Idempotent: re-running finds nothing pending, columns intact.
    assert RUNNER.run(conn, "sqlite") == []
    conn.close()


def test_v025_backfill_survives_archive_error(tmp_path):
    # An archive load that RAISES must not abort the migration (best-effort per row).
    from app.migrations.profile_db import RUNNER
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    path = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE final_videos (id INTEGER PRIMARY KEY, project_id INTEGER, "
        "filename TEXT, published_at TIMESTAMP, poster_filename TEXT)"
    )
    conn.execute("INSERT INTO final_videos VALUES (1, 500, 'r.mp4', '2026-01-01', NULL)")
    conn.execute("PRAGMA user_version = 24")
    conn.commit()
    set_current_user_id("u-v025b")
    set_current_profile_id("p-v025b")

    with patch("app.services.project_archive.load_archive", side_effect=RuntimeError("R2 down")):
        applied = RUNNER.run(conn, "sqlite")

    assert 25 in [m.version for m in applied]  # migration still completed
    assert conn.execute("PRAGMA user_version").fetchone()[0] == RUNNER.latest_version
    assert conn.execute(
        "SELECT slowmo_section_start FROM final_videos WHERE id=1"
    ).fetchone() == (None,)  # left NULL, no crash
    conn.close()


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


def test_finalize_freezes_slowmo_section(db):
    # T5280: render still FREEZES the section (cheap, no ffmpeg) but no longer
    # extracts a poster -- poster_filename stays NULL until publish fills it.
    from app.routers.export import overlay

    segments = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    pid = _seed_full_project(db, segments)

    with patch("app.analytics.record_milestone"):
        fv_id, _slowmo_section, _duration, _poster_marker_time = overlay._finalize_overlay_export(
            pid, "out.mp4", "expP", USER_ID
        )

    row = _connect(db).execute(
        "SELECT poster_filename, slowmo_section_start, slowmo_section_end "
        "FROM final_videos WHERE id = ?", (fv_id,)).fetchone()
    assert row["poster_filename"] is None  # T5280: no poster at render
    assert (row["slowmo_section_start"], row["slowmo_section_end"]) == (2.0, 6.0)


def test_finalize_freezes_null_when_no_slowmo(db):
    from app.routers.export import overlay

    pid = _seed_full_project(db, {"boundaries": [0, 6], "segmentSpeeds": {}})
    with patch("app.analytics.record_milestone"):
        fv_id, _slowmo_section, _duration, _poster_marker_time = overlay._finalize_overlay_export(
            pid, "out.mp4", "expP", USER_ID
        )
    row = _connect(db).execute(
        "SELECT slowmo_section_start, slowmo_section_end FROM final_videos WHERE id = ?",
        (fv_id,)).fetchone()
    assert (row["slowmo_section_start"], row["slowmo_section_end"]) == (None, None)


# ---------------------------------------------------------------------------
# Backfill reconstructs segments per final video (same policy as live)
# ---------------------------------------------------------------------------

def test_backfill_prefers_frozen_section(db):
    # A published reel with a FROZEN section -> backfill uses it directly (no
    # reconstruction), passes the resulting window to the frame grab (T5410:
    # open_play_window + midpoint, no ranking).
    conn = _connect(db)
    conn.execute(
        "INSERT INTO final_videos (id, filename, published_at, duration, "
        "slowmo_section_start, slowmo_section_end) VALUES (88, 'f.mp4', '2026-01-01', 10.0, 1.5, 5.5)"
    )
    conn.commit()
    conn.close()

    seen = {}

    def capture(user_id, filename, t):
        seen["t"] = t
        return "f.mp4.jpg"

    def fake_exists(user_id, rel_path):
        return rel_path == "final_videos/f.mp4"

    with patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}]), \
         patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]), \
         patch("app.migrations.migrate_local_profile_db_at_seam") as mig, \
         patch("app.storage.file_exists_in_r2", side_effect=fake_exists), \
         patch.object(poster_mod, "_grab_and_store_poster_frame", side_effect=capture), \
         patch.object(poster_mod, "resolve_slowmo_section") as reconstruct, \
         patch("app.database.sync_db_to_r2_explicit", return_value=True):
        mig.return_value = type("R", (), {"status": "ok"})()
        res = poster_mod.backfill_posters(limit=25, dry_run=False)

    assert set(res["generated"]) == {88}
    # window = open_play_window((1.5, 5.5), 10.0) = (3.5, min(5.5, 9.7)) = (3.5, 5.5)
    # -> section is set, so the default is the window's own start, 3.5
    # (T6630 round 8; round 7 had this at start+2.0=5.5, clamped, which
    # stacked with the slow-mo skip already baked into window.start).
    assert seen["t"] == pytest.approx(3.5)
    reconstruct.assert_not_called()  # frozen columns win; no reconstruction

    row = _connect(db).execute(
        "SELECT poster_filename, poster_frame_time, poster_source FROM final_videos WHERE id = 88"
    ).fetchone()
    assert row["poster_filename"] == "f.mp4.jpg"
    assert row["poster_frame_time"] == pytest.approx(3.5)
    assert row["poster_source"] == "auto"


def test_backfill_reconstructs_and_heals_when_unfrozen(db):
    # A published reel with NULL section but live working_clips still present ->
    # backfill reconstructs the section, applies the SAME window-gate policy, AND
    # heals the frozen columns so a future regen skips reconstruction.
    segments = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    pid = _seed_full_project(db, segments)
    conn = _connect(db)
    conn.execute(
        "INSERT INTO final_videos (id, project_id, filename, published_at, duration) "
        "VALUES (77, ?, 'r.mp4', '2026-01-01', 10.0)",
        (pid,),
    )
    conn.commit()
    conn.close()

    seen = {}

    def capture(user_id, filename, t):
        seen["t"] = t
        return "r.mp4.jpg"

    def fake_exists(user_id, rel_path):
        return rel_path == "final_videos/r.mp4"  # video present, poster absent

    with patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}]), \
         patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]), \
         patch("app.migrations.migrate_local_profile_db_at_seam") as mig, \
         patch("app.storage.file_exists_in_r2", side_effect=fake_exists), \
         patch.object(poster_mod, "_grab_and_store_poster_frame", side_effect=capture), \
         patch("app.database.sync_db_to_r2_explicit", return_value=True):
        mig.return_value = type("R", (), {"status": "ok"})()
        res = poster_mod.backfill_posters(limit=25, dry_run=False)

    assert set(res["generated"]) == {77}
    # Reconstructed section (2.0, 6.0) -> window = (4.0, min(6.0, 9.7)) = (4.0, 6.0)
    # -> section is set, so the default is the window's own start, 4.0
    # (T6630 round 8; round 7 had this at start+2.0=6.0, clamped, which
    # stacked with the slow-mo skip already baked into window.start).
    assert seen["t"] == pytest.approx(4.0)
    # ...and healed the frozen columns on the row.
    row = _connect(db).execute(
        "SELECT slowmo_section_start, slowmo_section_end, poster_frame_time, poster_source "
        "FROM final_videos WHERE id = 77"
    ).fetchone()
    assert (row["slowmo_section_start"], row["slowmo_section_end"]) == (2.0, 6.0)
    assert row["poster_frame_time"] == pytest.approx(4.0)
    assert row["poster_source"] == "auto"
