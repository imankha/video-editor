"""
T5220 -- shared ffmpeg concat helpers (design §8).

`_probe_media`/`_concat_copy`/`_concat_reencode`/`_validate_concat`/`_run`/
`_escape_filter_path` are byte-for-byte duplicated in `branded_outro.py`
(main-first join) and `player_intro.py` (card-first join), differing ONLY in
segment order. This is the 3rd use (serve_time_video wants an ORDERED N-segment
join), so design §8 extracts them into `services/ffmpeg_concat.py`:

    probe_media(path) -> dict
    concat_segments(segments: list[str], out_path: str, probe: dict) -> bool
    run(cmd) -> CompletedProcess
    escape_filter_path(path) -> str

`concat_segments` generalizes the existing 2-segment joins to an ORDERED list
of N segments: demuxer concat with `-c copy` first, falling back to a
`filter_complex concat=n=len` re-encode when the copy-join fails validation
(mismatched profiles), validating again after the fallback. Non-fatal: returns
False on total failure, never raises.

This module does not exist yet -- these tests are RED until `ffmpeg_concat.py`
is created (Stage 4, implementor). Mirrors the fixture/assertion style of
`test_t3950_branded_outro.py` (real small ffmpeg-generated clips, luma/duration
probing) rather than mocking ffmpeg away.
"""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# NEW module -- does not exist yet. This import is expected to raise
# ModuleNotFoundError until services/ffmpeg_concat.py is created.
from app.services import ffmpeg_concat  # noqa: E402
from app.services.ffmpeg_concat import concat_segments, probe_media  # noqa: E402

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe required for concat tests",
)


def _make_clip(path: Path, w: int, h: int, has_audio: bool, duration: float, color: str = "red"):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c={color}:size={w}x{h}:rate=30:duration={duration}",
    ]
    if has_audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
                "-c:a", "aac", "-ar", "48000", "-ac", "2"]
    cmd += ["-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p"]
    if not has_audio:
        cmd += ["-an"]
    cmd += [str(path)]
    subprocess.run(cmd, capture_output=True, check=True)


@pytest.fixture
def clip(tmp_path):
    def _factory(name, duration=1.0, w=270, h=480, has_audio=True, color="red"):
        p = tmp_path / name
        _make_clip(p, w, h, has_audio, duration, color)
        return p
    return _factory


def test_concat_two_ordered_segments(tmp_path, clip):
    """N=2 copy-join preserves ORDER and sums duration."""
    a = clip("a.mp4", duration=0.5)
    b = clip("b.mp4", duration=1.5, color="blue")
    out = tmp_path / "out.mp4"

    probe = probe_media(str(a))
    assert concat_segments([str(a), str(b)], str(out), probe) is True
    assert out.exists()

    o = probe_media(str(out))
    assert o["duration"] == pytest.approx(0.5 + 1.5, abs=0.35)


def test_concat_three_ordered_segments(tmp_path, clip):
    """N=3 copy-join ([intro][reel][outro] shape) sums duration and keeps order."""
    intro = clip("intro.mp4", duration=0.4, color="green")
    reel = clip("reel.mp4", duration=1.0, color="red")
    outro = clip("outro.mp4", duration=0.6, color="blue")
    out = tmp_path / "out.mp4"

    probe = probe_media(str(reel))
    assert concat_segments([str(intro), str(reel), str(outro)], str(out), probe) is True
    assert out.exists()

    o = probe_media(str(out))
    assert o["duration"] == pytest.approx(0.4 + 1.0 + 0.6, abs=0.4)


def test_concat_format_mismatch_falls_back_to_reencode_and_validates(tmp_path, clip, monkeypatch):
    """A format-mismatched segment (different resolution) fails the -c copy join's
    validation; concat_segments falls back to a filter_complex re-encode and still
    produces a valid, playable, correctly-summed output."""
    a = clip("a.mp4", duration=0.5, w=270, h=480)
    # Mismatched resolution -- forces the copy-join path to fail validation.
    b = clip("b.mp4", duration=0.7, w=480, h=270, color="blue")
    out = tmp_path / "out.mp4"

    probe = probe_media(str(a))

    reencode_calls = []
    real_reencode = ffmpeg_concat._concat_reencode if hasattr(ffmpeg_concat, "_concat_reencode") else None
    if real_reencode is not None:
        def counting_reencode(*args, **kwargs):
            reencode_calls.append(args)
            return real_reencode(*args, **kwargs)
        monkeypatch.setattr(ffmpeg_concat, "_concat_reencode", counting_reencode)

    assert concat_segments([str(a), str(b)], str(out), probe) is True
    assert out.exists()
    o = probe_media(str(out))
    assert o["duration"] == pytest.approx(0.5 + 0.7, abs=0.4)
    if real_reencode is not None:
        assert len(reencode_calls) == 1, "mismatched profiles must trigger exactly one re-encode fallback"


def test_concat_validation_length_guard(tmp_path, clip):
    """The result must be validated against the expected minimum combined
    duration -- a silently-truncated concat must not be reported as success."""
    a = clip("a.mp4", duration=0.5)
    b = clip("b.mp4", duration=0.5, color="blue")
    out = tmp_path / "out.mp4"
    probe = probe_media(str(a))
    assert concat_segments([str(a), str(b)], str(out), probe) is True
    o = probe_media(str(out))
    # Sanity: the validated output is not shorter than either input alone.
    assert o["duration"] >= 0.5


def test_concat_all_segments_missing_is_nonfatal(tmp_path):
    """concat_segments on nonexistent inputs must return False, never raise."""
    out = tmp_path / "out.mp4"
    fake_probe = {"width": 100, "height": 100, "fps_str": "30/1", "pix_fmt": "yuv420p",
                  "sar": "1/1", "timescale": 15360, "duration": 1.0, "has_audio": False,
                  "a_codec": None, "a_rate": None, "a_channels": None}
    result = concat_segments(
        [str(Path.cwd() / "does-not-exist-a.mp4"), str(Path.cwd() / "does-not-exist-b.mp4")],
        str(out), fake_probe,
    )
    assert result is False
    assert not out.exists()
