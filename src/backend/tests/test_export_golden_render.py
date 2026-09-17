"""T4370 render-golden layer: the LOCAL render path
(`local_processors.MockVideoUpscaler.process_video_with_upscale` -- the same
production fallback the D1(c)/T4120 local single-clip and multi-clip branches
call when CUDA is unavailable, exercised directly here rather than through the
full DB-effects pipeline already covered by test_export_golden_local_render.py)
against 2 tiny real fixture videos with fixed keyframes.

Asserts:
- ffprobe properties (exact-match golden): resolution, video codec/pix_fmt,
  presence/absence of an audio stream -- these are structural, not
  pixel-dependent, so exact match is appropriate and NOT flaky across ffmpeg
  builds.
- duration, +/-1 frame (tolerance, not exact-match: encoder frame boundaries
  can shift the last frame by a fraction of 1/fps).
- perceptual similarity via average-hash with a documented Hamming-distance
  tolerance (see export_golden/render_hash.py for the rationale) -- pixel-exact
  comparison is explicitly rejected per the task file.
"""

import pytest

from app.services.local_processors import MockVideoUpscaler

from tests.export_golden.fixtures import write_tiny_mp4
from tests.export_golden.render_hash import (
    assert_hash_within_tolerance,
    audio_streams,
    average_hash,
    ffprobe_json,
    video_stream,
)
from tests.export_golden.snapshot import load_or_bless

# MockVideoUpscaler hardcodes the output target (810x1440) and a 10s cap --
# see local_processors.py's process_video_with_upscale. Golden fixtures are
# kept under that cap so duration == source duration (no truncation edge case
# muddying the tolerance check).
SAMPLE_TIMESTAMPS = (0.5, 1.5)
FRAME_TOLERANCE_SECONDS = 1 / 15  # source fixtures are generated at 15fps


def _render(tmp_path, *, name: str, duration: int, include_audio: bool, with_audio_source: bool):
    src = tmp_path / f"{name}_src.mp4"
    if with_audio_source:
        import subprocess
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "lavfi", "-i", f"testsrc=size=640x360:rate=15:duration={duration}",
                "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                "-shortest", "-movflags", "+faststart", str(src),
            ],
            check=True, capture_output=True, timeout=30,
        )
    else:
        write_tiny_mp4(src, duration=duration, size="640x360", fps=15)

    out = tmp_path / f"{name}_out.mp4"
    MockVideoUpscaler().process_video_with_upscale(
        input_path=str(src),
        output_path=str(out),
        keyframes=[{"time": 0.0, "x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8}],
        target_fps=30,
        export_mode="quality",
        include_audio=include_audio,
    )
    return out


def _check_golden(name: str, output_path, expected_duration: float):
    probe = ffprobe_json(output_path)
    vstream = video_stream(probe)
    actual = {
        "width": int(vstream["width"]),
        "height": int(vstream["height"]),
        "video_codec": vstream["codec_name"],
        "pix_fmt": vstream["pix_fmt"],
        "has_audio": len(audio_streams(probe)) > 0,
        "duration": round(float(probe["format"]["duration"]), 3),
        "frame_hashes": {
            str(ts): average_hash(output_path, ts) for ts in SAMPLE_TIMESTAMPS if ts < expected_duration
        },
    }

    golden = load_or_bless(name, actual)

    # Structural facts: exact match (not pixel-dependent, not flaky).
    assert actual["width"] == golden["width"], name
    assert actual["height"] == golden["height"], name
    assert actual["video_codec"] == golden["video_codec"], name
    assert actual["pix_fmt"] == golden["pix_fmt"], name
    assert actual["has_audio"] == golden["has_audio"], name

    # Duration: tolerance, not exact (encoder frame-boundary drift).
    assert abs(actual["duration"] - golden["duration"]) <= FRAME_TOLERANCE_SECONDS, (
        f"{name}: duration {actual['duration']}s vs golden {golden['duration']}s "
        f"(tolerance +/-{FRAME_TOLERANCE_SECONDS:.3f}s = 1 frame @ 15fps source)"
    )

    # Perceptual similarity: Hamming-distance tolerance (see render_hash.py).
    for ts, hex_hash in actual["frame_hashes"].items():
        assert_hash_within_tolerance(hex_hash, golden["frame_hashes"][ts], label=f"{name}@{ts}s")


def test_render_golden_with_audio(tmp_path):
    """2s testsrc+sine fixture, include_audio=True.

    Characterization finding (not a harness bug -- verified the source fixture
    genuinely has an audio stream): MockVideoUpscaler's crop+scale filter chain
    rebinds `stream` to the FILTERED VIDEO-ONLY ffmpeg-python node before
    `.output(stream, ..., acodec='aac')` -- with only one stream object passed
    to `.output()`, the original input's audio track is never mapped in,
    regardless of `include_audio`. So `has_audio` is `False` here too. This is
    real current behavior of the CPU-fallback path (T4120 D1(b)/(c), not the
    GPU/Modal path prod actually serves) -- pinned verbatim per this task's
    charter, not fixed. See .claude/knowledge/export-pipeline.md.
    """
    out = _render(tmp_path, name="with_audio", duration=2, include_audio=True, with_audio_source=True)
    _check_golden("render_with_audio", out, expected_duration=2.0)


def test_render_golden_no_audio(tmp_path):
    """3s solid-pattern fixture (no audio source track), include_audio=False."""
    out = _render(tmp_path, name="no_audio", duration=3, include_audio=False, with_audio_source=False)
    _check_golden("render_no_audio", out, expected_duration=3.0)
