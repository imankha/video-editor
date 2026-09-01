"""
Tbug49p -- Modal cloud export ignored source fps, producing slow/fast-motion
output. `process_clips_ai` samples every SOURCE frame into a PNG sequence but
the ffmpeg command declared that sequence at the hard-coded TARGET fps with no
output -r, so output duration became `source_duration * (source_fps /
target_fps)` -- a 50fps source played back 1.667x slow. Root cause + exact
arithmetic proof against a real prod row (bug 49p, reporter bknoto@gmail.com)
in docs/plans/tasks/Tbug49p-*.md.

Scope notes (from review):
- `_build_framing_snapshot`'s per-clip "fps" is DELIBERATELY left at the fixed
  SNAPSHOT_FRAMERATE, not threaded from clip.source_fps -- a reviewer caught
  that `transform_all_regions_to_working` (highlight_transform.py) uses this
  value for BOTH a source-fps conversion and a working-video-frame conversion
  (working video is always 30fps), so threading source_fps through would
  persist highlight keyframes in the wrong unit. That's a separate follow-up
  requiring the transform to take distinct source/working rate params.
- The DB-resolve fps lookup itself (`framerate = wc.fps or gv.fps or 30`) is a
  one-line fallback mirroring framing.py's existing (also untested) ffprobe
  fallback -- not unit tested here (would need mocking the whole background
  task). The `game_videos` JOIN it depends on for legacy (NULL video_sequence)
  rows IS tested below, since that's where review found the real gap.
"""

import sqlite3

from app.modal_functions.video_processing import (
    _build_simple_ffmpeg_cmd,
    _build_speed_change_ffmpeg_cmd,
)
from app.routers.export.multi_clip import ClipExportData, _build_framing_snapshot
from app.services.highlight_carry import SNAPSHOT_FRAMERATE


def _last_input_index(cmd):
    """Index of the LAST -i flag's value -- output-only flags (-r, output path)
    must appear after this."""
    return max(i for i, arg in enumerate(cmd) if arg == "-i")


class TestBuildSimpleFfmpegCmd:
    def test_no_audio_uses_input_fps_for_framerate_and_forces_output_r(self):
        cmd = _build_simple_ffmpeg_cmd(
            "frame_%06d.png", "source.mp4", "out.mp4",
            fps=30, has_audio=False, audio_start_time=0, frame_count=863,
            input_fps=50,
        )
        assert cmd[cmd.index("-framerate") + 1] == "50"
        assert cmd[cmd.index("-r") + 1] == "30"
        assert cmd.index("-r") > _last_input_index(cmd), "-r must be an OUTPUT option, after every -i"

    def test_audio_branch_uses_input_fps_for_both_framerate_and_duration(self):
        cmd = _build_simple_ffmpeg_cmd(
            "frame_%06d.png", "source.mp4", "out.mp4",
            fps=30, has_audio=True, audio_start_time=2.5, frame_count=863,
            input_fps=50,
        )
        assert cmd[cmd.index("-framerate") + 1] == "50"
        assert cmd[cmd.index("-r") + 1] == "30"
        assert cmd.index("-r") > _last_input_index(cmd)
        # -t must be the frame sequence's REAL elapsed time (863/50 = 17.26s),
        # not the pre-fix bug's 863/30 = 28.77s (the exact slow-motion bug).
        t_value = float(cmd[cmd.index("-t") + 1])
        assert abs(t_value - (863 / 50)) < 1e-9

    def test_defaults_input_fps_to_target_when_frames_already_sampled_at_target(self):
        """When the caller doesn't pass input_fps (frames already 1:1 with the
        target rate), behavior must be unchanged from before this fix except
        for the now-always-present -r (harmless when input == output rate)."""
        cmd = _build_simple_ffmpeg_cmd(
            "frame_%06d.png", "source.mp4", "out.mp4",
            fps=30, has_audio=False, audio_start_time=0, frame_count=300,
        )
        assert cmd[cmd.index("-framerate") + 1] == "30"
        assert cmd[cmd.index("-r") + 1] == "30"

    def test_60fps_source_produces_half_speed_correction(self):
        """Second real prod case from the bug's blast-radius scan: a 60fps
        source was playing back 2x slow before this fix."""
        cmd = _build_simple_ffmpeg_cmd(
            "frame_%06d.png", "source.mp4", "out.mp4",
            fps=30, has_audio=False, audio_start_time=0, frame_count=1200,
            input_fps=60,
        )
        assert cmd[cmd.index("-framerate") + 1] == "60"
        assert cmd[cmd.index("-r") + 1] == "30"


class TestBuildSpeedChangeFfmpegCmd:
    """The speed-change filtergraph path received the same input/output fps
    split fix (5 hand-edits) but had zero prior test coverage -- extracted
    into its own function (sibling of _build_simple_ffmpeg_cmd) specifically
    so this was testable."""

    FILTER_COMPLEX_NO_AUDIO = "[0:v]trim=start=0:end=5,setpts=(PTS-STARTPTS)/2.0[v0];[v0]concat=n=1:v=1:a=0[outv]"
    FILTER_COMPLEX_WITH_AUDIO = (
        "[0:v]trim=start=0:end=5,setpts=(PTS-STARTPTS)/2.0[v0];"
        "[1:a]atrim=start=0:end=5,asetpts=PTS-STARTPTS,atempo=2.0[a0];"
        "[v0]concat=n=1:v=1:a=0[outv];[a0]concat=n=1:v=0:a=1[outa]"
    )

    def test_no_audio_output_uses_original_fps_for_input_and_forces_output_r(self):
        cmd = _build_speed_change_ffmpeg_cmd(
            "frame_%06d.png", "scratch.mp4", "clip_out.mp4",
            self.FILTER_COMPLEX_NO_AUDIO, has_audio_output=False,
            original_fps=50, fps=30,
        )
        assert "-i" in cmd and cmd.count("-i") == 1, "no-audio path takes only the PNG sequence as input"
        assert cmd[cmd.index("-framerate") + 1] == "50"
        assert cmd[cmd.index("-r") + 1] == "30"
        assert cmd.index("-r") > _last_input_index(cmd)
        assert "-map" in cmd and "[outa]" not in cmd

    def test_audio_output_uses_original_fps_for_input_and_forces_output_r(self):
        cmd = _build_speed_change_ffmpeg_cmd(
            "frame_%06d.png", "scratch.mp4", "clip_out.mp4",
            self.FILTER_COMPLEX_WITH_AUDIO, has_audio_output=True,
            original_fps=50, fps=30,
        )
        assert cmd.count("-i") == 2, "audio path takes the PNG sequence AND the scratch file as inputs"
        assert cmd[cmd.index("-i") + 1] == "frame_%06d.png"
        assert cmd[cmd.index("-framerate") + 1] == "50"
        assert cmd[cmd.index("-r") + 1] == "30"
        assert cmd.index("-r") > _last_input_index(cmd)
        assert "[outv]" in cmd and "[outa]" in cmd

    def test_60fps_source_matches_simple_encode_fps_handling(self):
        cmd = _build_speed_change_ffmpeg_cmd(
            "frame_%06d.png", "scratch.mp4", "clip_out.mp4",
            self.FILTER_COMPLEX_NO_AUDIO, has_audio_output=False,
            original_fps=60, fps=30,
        )
        assert cmd[cmd.index("-framerate") + 1] == "60"
        assert cmd[cmd.index("-r") + 1] == "30"


class TestBuildFramingSnapshotFpsDeliberatelyUnchanged:
    """Reviewer caught that threading clip.source_fps into the snapshot's
    "fps" would make transform_all_regions_to_working persist highlight
    keyframes in the wrong unit (source-fps space where working-fps space,
    always 30, is required). Pin the deliberate revert: snapshot fps stays
    SNAPSHOT_FRAMERATE regardless of the clip's real source fps."""

    def _clip(self, source_fps=None):
        return ClipExportData(
            clip_index=0,
            crop_keyframes=[],
            segments=None,
            duration=17.26,
            source_fps=source_fps,
        )

    def test_snapshot_fps_ignores_a_non_30_source_fps(self):
        snapshot = _build_framing_snapshot([self._clip(source_fps=50.0)], (810, 1440))
        assert snapshot["clips"][0]["fps"] == SNAPSHOT_FRAMERATE

    def test_snapshot_fps_is_unaffected_by_missing_source_fps(self):
        snapshot = _build_framing_snapshot([self._clip(source_fps=None)], (810, 1440))
        assert snapshot["clips"][0]["fps"] == SNAPSHOT_FRAMERATE


class TestMultiClipDbResolveFpsJoin:
    """Reviewer finding: raw_clips.video_sequence is NULL on legacy
    single-video-game clips (bug 49p's reporter is a legacy account). Without
    COALESCE(rc.video_sequence, 1) in the join predicate, gv.fps silently
    drops for exactly those rows, no-oping the crop-keyframe fps fix for the
    cohort it targets. This pins the actual SELECT used by
    _run_multi_clip_background's DB-resolve path against an in-memory sqlite
    db, without mocking the surrounding async pipeline.
    """

    def _db(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript("""
            CREATE TABLE working_clips (id INTEGER PRIMARY KEY, raw_clip_id INTEGER, fps REAL);
            CREATE TABLE raw_clips (id INTEGER PRIMARY KEY, game_id INTEGER, video_sequence INTEGER);
            CREATE TABLE game_videos (game_id INTEGER, sequence INTEGER, fps REAL);
        """)
        return conn

    def _select_fps(self, conn):
        cur = conn.cursor()
        cur.execute("""
            SELECT wc.id, wc.fps as wc_fps, gv.fps as gv_fps
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            LEFT JOIN game_videos gv ON rc.game_id = gv.game_id AND COALESCE(rc.video_sequence, 1) = gv.sequence
        """)
        return dict(cur.fetchone())

    def test_legacy_null_video_sequence_still_resolves_game_video_fps(self):
        """The exact case that no-op'd before the COALESCE: a legacy clip with
        NULL video_sequence, NULL working_clips.fps, and the game's fps only
        available on game_videos (sequence=1, the legacy single-video default)."""
        conn = self._db()
        conn.execute("INSERT INTO raw_clips (id, game_id, video_sequence) VALUES (1, 16, NULL)")
        conn.execute("INSERT INTO working_clips (id, raw_clip_id, fps) VALUES (1, 1, NULL)")
        conn.execute("INSERT INTO game_videos (game_id, sequence, fps) VALUES (16, 1, 50.0)")

        row = self._select_fps(conn)
        framerate = row["wc_fps"] or row["gv_fps"] or 30
        assert framerate == 50.0

    def test_non_legacy_video_sequence_still_matches_exactly(self):
        """A multi-video game with an explicit, non-1 video_sequence must still
        match its own game_videos row, not fall through to sequence=1."""
        conn = self._db()
        conn.execute("INSERT INTO raw_clips (id, game_id, video_sequence) VALUES (1, 16, 2)")
        conn.execute("INSERT INTO working_clips (id, raw_clip_id, fps) VALUES (1, 1, NULL)")
        conn.execute("INSERT INTO game_videos (game_id, sequence, fps) VALUES (16, 1, 30.0)")
        conn.execute("INSERT INTO game_videos (game_id, sequence, fps) VALUES (16, 2, 60.0)")

        row = self._select_fps(conn)
        framerate = row["wc_fps"] or row["gv_fps"] or 30
        assert framerate == 60.0

    def test_working_clips_fps_takes_priority_over_game_videos_fps(self):
        conn = self._db()
        conn.execute("INSERT INTO raw_clips (id, game_id, video_sequence) VALUES (1, 16, NULL)")
        conn.execute("INSERT INTO working_clips (id, raw_clip_id, fps) VALUES (1, 1, 50.0)")
        conn.execute("INSERT INTO game_videos (game_id, sequence, fps) VALUES (16, 1, 30.0)")

        row = self._select_fps(conn)
        framerate = row["wc_fps"] or row["gv_fps"] or 30
        assert framerate == 50.0
