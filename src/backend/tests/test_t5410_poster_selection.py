"""T5410: open-play window gate poster selection (NO detection of any kind).

Covers:
- open_play_window: slow-mo / no-slow-mo / too-short-after-skip / end-margin /
  section past duration. Pure arithmetic, the whole algorithm.
- select_poster_frame: marker honoured verbatim (including outside the
  window); unset -> the window's own start when `section` is set (T6630
  round 8; was always +2s into the window, which stacked with
  SPOTLIGHT_SKIP_SECONDS and landed the default ~4s past the section's
  start), else 2s into the window clamped to its end (no-section case,
  unchanged from round 7).
- generate_poster_at_export: sets poster_filename/poster_frame_time/
  poster_source ('auto' vs 'overlay'); poster failure never fails export
  (T4110 barrier explicitly asserted); NO detection call anywhere.
- get_project_poster_marker_time / set_project_poster_marker_time: persists,
  clears on None, column-guarded for the deploy->migrate window.
- poster-time endpoint (gesture-scoped). (The poster/upload endpoint +
  store_override_poster were removed in T6510 -- see note where their tests were.)
- backfill `force` skips poster_source in ('overlay', 'upload') -- the 'upload'
  value still READS for grandfathered reels.
- publish no longer generates a poster (see test_t5280_poster_at_publish.py).
- v032 migration: adds all three columns, idempotent.
"""

import shutil
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.routers.export.overlay import PosterTimeRequest
from app.services import poster as poster_mod
from app.services.poster import (
    END_MARGIN_SECONDS,
    MIN_WINDOW_SECONDS,
    SPOTLIGHT_SKIP_SECONDS,
    get_project_poster_marker_time,
    open_play_window,
    select_poster_frame,
    set_project_poster_marker_time,
)
from app.utils.encoding import encode_data

USER_ID = "test-user-t5410"
PROFILE_ID = "t5410prof"


# ---------------------------------------------------------------------------
# open_play_window: pure arithmetic, no I/O -- the whole algorithm
# ---------------------------------------------------------------------------

def test_window_no_slowmo_is_whole_clip_minus_margin():
    assert open_play_window(None, 10.0) == (0.0, 10.0 - END_MARGIN_SECONDS)


def test_window_no_slowmo_zero_duration_clamps_at_zero():
    assert open_play_window(None, 0.0) == (0.0, 0.0)


def test_window_slowmo_skips_spotlight_and_clamps_end_margin():
    # section [1.0, 8.0], final_duration=10.0
    # cand_start = 1.0 + 2.0 = 3.0; cand_end = min(8.0, 10.0 - 0.3) = 8.0
    assert open_play_window((1.0, 8.0), 10.0) == (3.0, 8.0)


def test_window_end_margin_binds_when_section_runs_to_duration():
    # section end == final_duration -> end margin clamps below it.
    assert open_play_window((1.0, 10.0), 10.0) == (3.0, 9.7)


def test_window_too_short_after_skip_degrades_to_whole_section():
    # section [0.0, 2.2]: cand_start = 2.0, cand_end = min(2.2, final-0.3).
    # cand_end - cand_start = 0.2 < MIN_WINDOW_SECONDS (0.5) -> degrade.
    section = (0.0, 2.2)
    assert open_play_window(section, 10.0) == section


def test_window_section_past_duration_degrades_to_whole_section():
    # A section start/end beyond final_duration (stale/corrupt data): cand_end
    # goes negative relative to cand_start -> degrade to the whole section
    # rather than emit an inverted/negative window.
    section = (12.0, 14.0)
    assert open_play_window(section, 10.0) == section


def test_window_exact_min_window_boundary_not_degraded():
    # cand_end - cand_start == MIN_WINDOW_SECONDS exactly -> NOT degraded
    # (strict < in the guard).
    start = 0.0
    end = SPOTLIGHT_SKIP_SECONDS + MIN_WINDOW_SECONDS  # cand window is exactly MIN_WINDOW wide
    section = (start, end)
    window = open_play_window(section, end + 100.0)  # duration way past end margin concern
    assert window == (SPOTLIGHT_SKIP_SECONDS, end)


# ---------------------------------------------------------------------------
# select_poster_frame: marker verbatim (even outside window); unset ->
# window.start when `section` is set (T6630 round 8), else 2s into the
# window clamped to its end (no-section case, unchanged from round 7)
# ---------------------------------------------------------------------------

def test_select_frame_unset_marker_no_section_is_two_seconds_into_window():
    # No slow-mo section -> window.start is the clip's literal frame 0 (never
    # skip-adjusted), so the +2.0 "don't pick frame 0" push still applies.
    # Window width 8.0 -- start+2.0 (4.0) and the midpoint (6.0) DIFFER here,
    # so this discriminates the two rules (a window where they coincided
    # would pass either way and not actually verify the change).
    assert select_poster_frame((2.0, 10.0), None, None) == 4.0


def test_select_frame_unset_marker_no_section_clamps_to_window_end_when_shorter_than_two_seconds():
    # Windows can be as short as MIN_WINDOW_SECONDS (0.5) -- start+2.0 must
    # not return a time outside the window.
    assert select_poster_frame((2.0, 2.3), None, None) == 2.3


def test_select_frame_unset_marker_with_section_is_window_start():
    # A slow-mo section is present -> window.start already IS
    # section.start + SPOTLIGHT_SKIP_SECONDS (past the contested/occluded
    # opening frames). Round 7 also added +2.0 here, which stacked to ~4s
    # past the section's start; round 8 (live user report: "6s instead of
    # ~2s") drops the second push -- window.start is the settled point
    # already, use it directly.
    section = (1.5, 20.0)
    window = (3.5, 10.0)  # open_play_window(section, ...) would yield this
    assert select_poster_frame(window, None, section) == 3.5


def test_select_frame_marker_honoured_verbatim_inside_window():
    assert select_poster_frame((2.0, 6.0), 3.3, None) == 3.3


def test_select_frame_marker_honoured_verbatim_outside_window():
    # A deliberate spotlight-frame pick is a decision, not an error -- NOT
    # clamped into the window.
    assert select_poster_frame((2.0, 6.0), 0.1, None) == 0.1
    assert select_poster_frame((2.0, 6.0), 99.0, None) == 99.0


def test_select_frame_marker_zero_is_honoured_not_treated_as_falsy():
    # 0.0 is a valid marker time -- must not be treated as "unset" (falsy trap).
    assert select_poster_frame((2.0, 6.0), 0.0, None) == 0.0


# ---------------------------------------------------------------------------
# generate_poster_at_export: fields set, barrier intact, no detection
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


def _seed_final_video(db_path, filename="f.mp4"):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO final_videos (filename, version) VALUES (?, 1)", (filename,)
    )
    fv_id = cur.lastrowid
    conn.commit()
    conn.close()
    return fv_id


@pytest.mark.asyncio
async def test_generate_poster_at_export_auto_source_no_marker(db):
    fv_id = _seed_final_video(db, "auto.mp4")

    with patch.object(poster_mod, "_grab_and_store_poster_frame", return_value="auto.mp4.jpg") as grab:
        result = await poster_mod.generate_poster_at_export(
            USER_ID, fv_id, "auto.mp4", (2.0, 6.0), 10.0, None,
        )

    assert result == "auto.mp4.jpg"
    # window = open_play_window((2,6), 10.0) = (4.0, 6.0) -> section is set,
    # so the default is the window's own start, 4.0 (T6630 round 8; round 7
    # had this at start+2.0=6.0, which stacked with the slow-mo skip already
    # baked into window.start).
    grab.assert_called_once_with(USER_ID, "auto.mp4", 4.0)

    row = _connect(db).execute(
        "SELECT poster_filename, poster_frame_time, poster_source FROM final_videos WHERE id = ?",
        (fv_id,),
    ).fetchone()
    assert row["poster_filename"] == "auto.mp4.jpg"
    assert row["poster_frame_time"] == pytest.approx(4.0)
    assert row["poster_source"] == "auto"


@pytest.mark.asyncio
async def test_generate_poster_at_export_overlay_source_with_marker(db):
    fv_id = _seed_final_video(db, "marked.mp4")

    with patch.object(poster_mod, "_grab_and_store_poster_frame", return_value="marked.mp4.jpg") as grab:
        result = await poster_mod.generate_poster_at_export(
            USER_ID, fv_id, "marked.mp4", (2.0, 6.0), 10.0, 0.5,  # marker OUTSIDE the window
        )

    assert result == "marked.mp4.jpg"
    grab.assert_called_once_with(USER_ID, "marked.mp4", 0.5)  # honoured verbatim

    row = _connect(db).execute(
        "SELECT poster_frame_time, poster_source FROM final_videos WHERE id = ?", (fv_id,)
    ).fetchone()
    assert row["poster_frame_time"] == pytest.approx(0.5)
    assert row["poster_source"] == "overlay"


@pytest.mark.asyncio
async def test_generate_poster_at_export_never_raises_on_grab_failure(db):
    # T4110 barrier: poster failure must NEVER fail export. Assert explicitly
    # that the export-completing caller's contract holds even when the frame
    # grab raises internally.
    fv_id = _seed_final_video(db, "boom.mp4")

    def boom(*a, **k):
        raise RuntimeError("ffmpeg exploded")

    with patch.object(poster_mod, "_grab_and_store_poster_frame", side_effect=boom):
        result = await poster_mod.generate_poster_at_export(
            USER_ID, fv_id, "boom.mp4", None, 10.0, None,
        )

    assert result is None  # never raises -- caller (finalize) is unaffected
    row = _connect(db).execute(
        "SELECT poster_filename FROM final_videos WHERE id = ?", (fv_id,)
    ).fetchone()
    assert row["poster_filename"] is None


@pytest.mark.asyncio
async def test_generate_poster_at_export_grab_returns_none_is_not_fatal(db):
    fv_id = _seed_final_video(db, "nograb.mp4")

    with patch.object(poster_mod, "_grab_and_store_poster_frame", return_value=None):
        result = await poster_mod.generate_poster_at_export(
            USER_ID, fv_id, "nograb.mp4", None, 10.0, None,
        )

    assert result is None
    row = _connect(db).execute(
        "SELECT poster_filename FROM final_videos WHERE id = ?", (fv_id,)
    ).fetchone()
    assert row["poster_filename"] is None


@pytest.mark.asyncio
async def test_generate_poster_at_export_makes_no_detection_call(db):
    """Verify by inspection-equivalent: no Modal / CPU inference call anywhere
    on the export path. modal_client and video_detections must never be
    imported or called from the poster module."""
    fv_id = _seed_final_video(db, "nodetect.mp4")

    assert not hasattr(poster_mod, "call_modal_detect_players_batch")
    assert not hasattr(poster_mod, "pick_subject")
    assert not hasattr(poster_mod, "score_candidate")
    assert not hasattr(poster_mod, "modal_detect_cached")

    with patch.object(poster_mod, "_grab_and_store_poster_frame", return_value="x.jpg"):
        await poster_mod.generate_poster_at_export(
            USER_ID, fv_id, "nodetect.mp4", (2.0, 6.0), 10.0, None,
        )
    # (no modal/detection mocks needed to satisfy this -- if any were called
    # unmocked, real network/GPU calls would raise/hang in this sandboxed test.)


# ---------------------------------------------------------------------------
# projects.poster_marker_time getter/setter (pre-export marker persistence)
# ---------------------------------------------------------------------------

def _seed_project(db_path):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('R', '9:16')")
    pid = cur.lastrowid
    conn.commit()
    conn.close()
    return pid


def test_marker_time_none_by_default(db):
    pid = _seed_project(db)
    assert get_project_poster_marker_time(pid) is None


def test_marker_time_set_and_read_back(db):
    pid = _seed_project(db)
    # T6550: the setter now returns True when the write lands (was the stored
    # value); the persisted time is asserted via the getter read-back.
    wrote = set_project_poster_marker_time(pid, 3.25)
    assert wrote is True
    assert get_project_poster_marker_time(pid) == pytest.approx(3.25)


def test_poster_time_request_rejects_clear_and_invalid():
    """T6560: the poster-time write is MOVE-only -- a null/missing/non-finite/
    negative time is refused at the request boundary (Pydantic), so no UI path
    can silently clear the reel's poster to 'none'. Reset-to-auto is /poster/
    revert. A legacy stored NULL still reads as 'no override -> midpoint'
    (test_marker_time_none_by_default), but nothing WRITES one anymore."""
    # A concrete frame time is accepted (including 0.0 -- the first frame).
    assert PosterTimeRequest(time=3.25).time == pytest.approx(3.25)
    assert PosterTimeRequest(time=0.0).time == 0.0

    # The clear path (null / missing) and nonsensical times are rejected.
    for bad in ({"time": None}, {}, {"time": -1.0},
                {"time": float("nan")}, {"time": float("inf")}):
        with pytest.raises(ValidationError):
            PosterTimeRequest(**bad)


def test_marker_time_none_project_id_returns_none():
    assert get_project_poster_marker_time(None) is None


def test_marker_time_column_guarded_pre_migration(db):
    # Simulate the deploy->migrate window: drop the column entirely.
    conn = sqlite3.connect(str(db))
    conn.execute("ALTER TABLE projects DROP COLUMN poster_marker_time")
    conn.commit()
    conn.close()

    pid = _seed_project(db)
    # Must not raise "no such column" -- treated as no override (auto).
    assert get_project_poster_marker_time(pid) is None
    # T6550: the WRITE must be guarded symmetrically. On a below-v032 profile it
    # must NOT raise "no such column" and must NOT lie about success -- it reports
    # False (nothing written) so the caller can surface a distinct 503.
    assert set_project_poster_marker_time(pid, 4.5) is False
    # And the column really is still absent (no self-repair / silent create).
    assert get_project_poster_marker_time(pid) is None


# T6510: `store_override_poster` (the custom-cover upload write helper) was
# deleted with the upload endpoint, so its two tests were removed here. The
# 'upload' poster_source still READS for grandfathered reels; that read + the
# one-way revert off it are covered by test_t6380_poster_revert.py and the
# backfill-skips-'upload' test just below (unchanged).


# ---------------------------------------------------------------------------
# backfill: force skips overrides
# ---------------------------------------------------------------------------

def test_backfill_force_skips_override_sources(db):
    conn = _connect(db)
    conn.executemany(
        "INSERT INTO final_videos (id, filename, published_at, duration, poster_filename, poster_source) "
        "VALUES (?, ?, '2026-01-01', 10.0, ?, ?)",
        [
            (1, "auto.mp4", "auto.mp4.jpg", "auto"),
            (2, "overlay.mp4", "overlay.mp4.jpg", "overlay"),
            (3, "upload.mp4", "upload.mp4.jpg", "upload"),
        ],
    )
    conn.commit()
    conn.close()

    with patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}]), \
         patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]), \
         patch("app.migrations.migrate_local_profile_db_at_seam") as mig, \
         patch("app.storage.file_exists_in_r2", return_value=True), \
         patch.object(poster_mod, "_grab_and_store_poster_frame", return_value="regen.jpg") as grab, \
         patch("app.database.sync_db_to_r2_explicit", return_value=True):
        mig.return_value = type("R", (), {"status": "ok"})()
        res = poster_mod.backfill_posters(limit=25, dry_run=False, force=True)

    assert set(res["skipped_override"]) == {2, 3}
    # Only the 'auto' row is a candidate for force-regen; force bypasses the
    # skip-if-exists heal path, so it is genuinely regenerated (never
    # 'overlay'/'upload' -- those are skipped above regardless of `force`).
    assert set(res["generated"]) == {1}
    # No slow-mo section -> window = (0.0, 9.7); start+2.0 (2.0), clamped to
    # end (9.7) -> 2.0 (T6630 round 7; was the midpoint, 4.85).
    grab.assert_called_once_with(USER_ID, "auto.mp4", pytest.approx(2.0))


# ---------------------------------------------------------------------------
# v032 migration
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# REQUIRED evidence: multi-clip, slow-mo time-map proof.
#
# A single-clip check does not prove the offset math -- this builds a REAL
# ffmpeg-concatenated two-clip video (clip A: 3s RED @ 1x -> 3s output; clip B:
# 2s BLUE @ 0.5x slow-mo -> 4s output), seeds the DB rows a real multi-clip
# export would leave behind (working_clips.segments_data + raw_clips
# durations), and drives the REAL first_slowmo_section + generate_poster_at_export
# functions end-to-end. It then reads the ACTUAL PIXEL COLOR of the generated
# poster JPEG to confirm the DB-computed marker time (5.0s, inside the BLUE
# region per the offset math) produced a poster from the BLUE segment, not a
# stale/misaligned frame from the RED one. This is the DB-math-to-real-pixels
# proof the design doc requires -- not just an assertion on returned numbers.
# ---------------------------------------------------------------------------

_HAS_FFMPEG = shutil.which("ffmpeg") is not None


@pytest.mark.skipif(not _HAS_FFMPEG, reason="ffmpeg not available")
@pytest.mark.asyncio
async def test_multiclip_slowmo_marker_maps_to_correct_real_frame(db, tmp_path):
    import subprocess

    import cv2

    # 1. Build the REAL rendered "working video": 3s solid RED (clip A, no
    # slow-mo) concatenated with 2s solid BLUE stretched 2x by ffmpeg's setpts
    # to a 4s output (clip B, 0.5x slow-mo) -- exactly what a real multi-clip
    # export with a slow-mo segment produces. Final duration = 3 + 4 = 7s.
    red = str(tmp_path / "red.mp4")
    blue_src = str(tmp_path / "blue_src.mp4")
    blue_slow = str(tmp_path / "blue_slow.mp4")
    concat_list = str(tmp_path / "concat.txt")
    rendered = str(tmp_path / "rendered.mp4")

    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=25:d=3",
         "-pix_fmt", "yuv420p", red],
        capture_output=True, check=True, timeout=60,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=25:d=2",
         "-pix_fmt", "yuv420p", blue_src],
        capture_output=True, check=True, timeout=60,
    )
    # 0.5x slow-mo: setpts doubles duration (2s source -> 4s output), matching
    # the SAME "output = source / speed" rule highlight_transform/poster.py use.
    subprocess.run(
        ["ffmpeg", "-y", "-i", blue_src, "-vf", "setpts=2.0*PTS", "-r", "25", blue_slow],
        capture_output=True, check=True, timeout=60,
    )
    Path(concat_list).write_text(f"file '{red}'\nfile '{blue_slow}'\n")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list,
         "-c", "copy", rendered],
        capture_output=True, check=True, timeout=60,
    )
    # Sanity: the rendered video is really ~7s, red first half, blue second half.
    probed_duration = poster_mod._probe_duration(rendered)
    assert probed_duration is not None and 6.8 < probed_duration < 7.2, probed_duration

    # 2. Seed the DB rows a real multi-clip export leaves behind: a project
    # with two working_clips in concatenation order, each carrying the
    # segments_data + raw_clip duration first_slowmo_section actually reads.
    conn = _connect(db)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('MultiClip', '16:9')")
    pid = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time) VALUES ('a.mp4', 5, 0.0, 3.0)"
    )
    rc_a = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time) VALUES ('b.mp4', 5, 0.0, 2.0)"
    )
    rc_b = cur.lastrowid
    # Clip A: boundaries [0,3], no slow-mo (speed 1x implicit) -> 3s output.
    seg_a = {"boundaries": [0, 3], "segmentSpeeds": {}}
    # Clip B: boundaries [0,2] @ 0.5x -> 4s output (the first slow-mo segment).
    seg_b = {"boundaries": [0, 2], "segmentSpeeds": {"0": 0.5}}
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, segments_data) "
        "VALUES (?, ?, 1, 0, ?)", (pid, rc_a, encode_data(seg_a)),
    )
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, segments_data) "
        "VALUES (?, ?, 1, 1, ?)", (pid, rc_b, encode_data(seg_b)),
    )
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) "
        "VALUES (?, 'rendered.mp4', 1, ?)", (pid, probed_duration),
    )
    conn.commit()
    conn.close()

    # 3. Drive the REAL DB-side offset math (no mocking): confirm the first
    # slow-mo section is located at the BLUE clip's real final-timeline offset.
    clips = poster_mod.load_project_clip_segments(pid)
    section = poster_mod.first_slowmo_section(clips)
    assert section == (3.0, 7.0), (
        "multi-clip offset math must place the slow-mo section at clip A's "
        "REAL 3s output boundary, not clip 0 or a fabricated offset"
    )

    # 4. Set a marker at 5.0s -- inside the BLUE region per the real math
    # above -- and drive the REAL generate_poster_at_export end-to-end,
    # substituting only the R2 presign (no live R2 in this sandbox) with the
    # actual rendered local file so ffmpeg genuinely seeks real content.
    conn = _connect(db)
    fv_id = conn.execute(
        "INSERT INTO final_videos (project_id, filename, version) VALUES (?, 'rendered.mp4', 1)",
        (pid,),
    ).lastrowid
    conn.commit()
    conn.close()

    with patch.object(poster_mod, "generate_presigned_url", return_value=rendered), \
         patch.object(poster_mod, "upload_bytes_to_r2", return_value=True):
        stored = await poster_mod.generate_poster_at_export(
            USER_ID, fv_id, "rendered.mp4", section, probed_duration, 5.0,
        )
    assert stored == "rendered.mp4.jpg"

    row = _connect(db).execute(
        "SELECT poster_frame_time, poster_source FROM final_videos WHERE id = ?", (fv_id,)
    ).fetchone()
    assert row["poster_frame_time"] == pytest.approx(5.0)
    assert row["poster_source"] == "overlay"

    # 5. THE PROOF: independently re-extract the frame at the STORED
    # poster_frame_time and read its actual pixel color. 5.0s is deep in the
    # BLUE region (3.0-7.0s) -- if the offset math or the seek were off by a
    # clip boundary, this would read back RED instead.
    import tempfile as _tempfile

    with _tempfile.TemporaryDirectory() as tmp2:
        check_path = str(Path(tmp2) / "check.jpg")
        assert poster_mod.extract_first_frame_jpeg(rendered, check_path, seek=5.0)
        img = cv2.imread(check_path)
        b, g, r = [int(x) for x in img[img.shape[0] // 2, img.shape[1] // 2]]
        assert b > r and b > 150 and r < 100, (
            f"frame at 5.0s should be BLUE (clip B's slow-mo region) but read "
            f"back BGR=({b},{g},{r}) -- the multi-clip offset math or seek is "
            f"mapping to the wrong clip"
        )


def test_v032_adds_all_three_columns_and_is_idempotent(tmp_path):
    from app.migrations.profile_db import RUNNER

    path = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE final_videos (id INTEGER PRIMARY KEY, filename TEXT, "
        "slowmo_section_start REAL, slowmo_section_end REAL, poster_filename TEXT)"
    )
    conn.execute(
        "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, aspect_ratio TEXT)"
    )
    conn.execute("PRAGMA user_version = 31")
    conn.commit()

    applied = RUNNER.run(conn, "sqlite")
    assert 32 in [m.version for m in applied]

    fv_cols = {r[1] for r in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
    proj_cols = {r[1] for r in conn.execute("PRAGMA table_info(projects)").fetchall()}
    assert {"poster_frame_time", "poster_source"} <= fv_cols
    assert "poster_marker_time" in proj_cols
    assert conn.execute("PRAGMA user_version").fetchone()[0] == RUNNER.latest_version

    # Idempotent: re-running finds nothing pending, columns intact.
    assert RUNNER.run(conn, "sqlite") == []
    conn.close()
