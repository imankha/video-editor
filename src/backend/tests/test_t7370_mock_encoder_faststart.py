"""Regression test for T7370: the CPU/no-GPU fallback encoders in
local_processors.py (MockVideoUpscaler, used when Modal is disabled and no CUDA
is available -- every /dotask container and any local dev-without-GPU session)
wrote their output with the moov atom at the END of the file. Every other
encoder in this codebase passes -movflags +faststart; these two did not, so a
rendered working video could never be parsed by the frontend
(videoMetadata.js's tail-range fallback also fails on a large enough moov),
permanently stuck loading in Overlay.

Mirrors the byte-level assertion pattern already used in
test_t6360_download_metadata.py (moov must precede mdat).
"""

import subprocess

import pytest

from app.services.local_processors import MockVideoUpscaler


def _make_source(path, w=320, h=240, duration=0.5):
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"testsrc=size={w}x{h}:rate=30:duration={duration}",
            "-c:v", "libx264", "-crf", "30", "-pix_fmt", "yuv420p",
            str(path),
        ],
        capture_output=True, check=True,
    )


def _assert_faststart(path):
    data = path.read_bytes()
    moov_idx = data.find(b"moov")
    mdat_idx = data.find(b"mdat")
    assert moov_idx != -1 and mdat_idx != -1, "moov/mdat atoms not found in output"
    assert moov_idx < mdat_idx, "faststart (+movflags) not applied -- moov is after mdat"


@pytest.mark.skipif(
    subprocess.run(["ffmpeg", "-version"], capture_output=True).returncode != 0,
    reason="ffmpeg not available",
)
def test_mock_video_upscaler_output_is_faststart(tmp_path):
    """MockVideoUpscaler.process_video_with_upscale (the multi-clip CPU fallback)
    must write a faststart MP4."""
    source = tmp_path / "src.mp4"
    _make_source(source)
    output = tmp_path / "out.mp4"

    up = MockVideoUpscaler()
    result = up.process_video_with_upscale(
        input_path=str(source),
        output_path=str(output),
        keyframes=[{"x": 0, "y": 0, "width": 1, "height": 1}],
    )

    assert result["status"] == "success"
    _assert_faststart(output)


def test_local_framing_mock_encode_call_includes_faststart():
    """local_framing_mock (the single-clip framing CPU fallback -- this is the
    exact path T4330's manual container testing hit) does its own R2
    download/upload around the ffmpeg call, so exercising it behaviorally needs
    mocking `download_from_r2`/`generate_presigned_url_global`/`upload_to_r2` --
    real setup for a one-kwarg fix. This pins the fix at the source level
    instead: the ffmpeg output call must literally include the faststart flag,
    so a future edit that touches this call site and drops it fails loudly."""
    import inspect

    from app.services import local_processors

    source = inspect.getsource(local_processors.local_framing_mock)
    assert "movflags" in source and "+faststart" in source, (
        "local_framing_mock's ffmpeg output call must set movflags=+faststart "
        "(T7370) -- every other encoder in this codebase does, and dropping it "
        "leaves the frontend unable to parse the rendered working video."
    )
