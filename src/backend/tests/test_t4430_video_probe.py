"""T4430: one video probe.

Every app-side caller that asks a video for its frame rate or size goes through
`app.services.video_probe.probe_video`, which raises `VideoProbeError` when the
file cannot be read -- no caller substitutes 30 fps. No `eval()` of ffprobe
output remains. The local (non-Modal) Spotlight renderer keeps the input's
length (no `-shortest` truncating video to a shorter audio track).

Real ffmpeg/ffprobe; no mocks of the probe under test.
"""
import ast
import json
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="needs ffmpeg"
)

APP_ROOT = Path(__file__).resolve().parent.parent / "app"
# The Modal file keeps its own probe copy by policy (T4430 task file).
POLICY_EXEMPT = {APP_ROOT / "modal_functions", APP_ROOT / "services" / "video_probe.py"}


def _make_video(path: Path, *, seconds: float, audio_seconds: float | None, fps: str = "25"):
    cmd = ["ffmpeg", "-y", "-v", "error",
           "-f", "lavfi", "-i", f"testsrc=size=64x48:rate={fps}:duration={seconds}"]
    if audio_seconds is not None:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={audio_seconds}"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if audio_seconds is not None:
        cmd += ["-c:a", "aac"]
    cmd += [str(path)]
    subprocess.run(cmd, check=True)
    return path


def _video_stream_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=nb_read_frames,r_frame_rate", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    stream = json.loads(out)["streams"][0]
    num, den = stream["r_frame_rate"].split("/")
    return int(stream["nb_read_frames"]) / (int(num) / int(den))


# --- C1: one probe that raises -------------------------------------------------

def test_probe_video_reads_size_and_rate(tmp_path):
    from app.services.video_probe import probe_video

    info = probe_video(str(_make_video(tmp_path / "a.mp4", seconds=1, audio_seconds=1, fps="30000/1001")))
    assert (info["width"], info["height"]) == (64, 48)
    assert info["fps_str"] == "30000/1001"
    assert info["fps"] == pytest.approx(29.97, abs=0.01)
    assert info["duration"] == pytest.approx(1.0, abs=0.1)
    assert info["audio_stream"] is not None


def test_probe_video_reads_bytes(tmp_path):
    from app.services.video_probe import probe_video

    data = _make_video(tmp_path / "b.mp4", seconds=1, audio_seconds=None).read_bytes()
    info = probe_video(data)
    assert (info["width"], info["height"], info["fps"]) == (64, 48, 25.0)
    assert info["audio_stream"] is None


def test_probe_video_raises_on_unreadable_file(tmp_path):
    from app.services.video_probe import VideoProbeError, probe_video

    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video at all")
    with pytest.raises(VideoProbeError):
        probe_video(str(bad))
    with pytest.raises(VideoProbeError):
        probe_video(str(tmp_path / "missing.mp4"))


@pytest.mark.parametrize("rate", [None, "", "0/0", "N/A", "30/0"])
def test_unknown_frame_rate_raises_instead_of_30(rate):
    from app.services.video_probe import VideoProbeError, parse_frame_rate

    with pytest.raises(VideoProbeError):
        parse_frame_rate(rate)


def _app_files():
    for path in APP_ROOT.rglob("*.py"):
        if any(path == ex or ex in path.parents for ex in POLICY_EXEMPT):
            continue
        yield path


def test_no_app_side_caller_probes_rate_or_size_itself():
    """Every rate/size probe goes through probe_video: no other ffprobe stream
    query, ffmpeg-python/OpenCV metadata read, or '30/1' default in app code."""
    banned = ("r_frame_rate", "CAP_PROP_FPS", "CAP_PROP_FRAME_WIDTH", "CAP_PROP_FRAME_HEIGHT",
              "ffmpeg.probe(", "ffmpeg_lib.probe(", "ffprobe_bytes", "probe_dimensions_via_url",
              "get_video_info", "get_video_metadata_ffprobe")
    offenders = []
    for path in _app_files():
        src = path.read_text(encoding="utf-8")
        for token in banned:
            if token in src:
                offenders.append(f"{path.relative_to(APP_ROOT)}: {token}")
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Constant) and node.value == "30/1":
                offenders.append(f"{path.relative_to(APP_ROOT)}:{node.lineno}: '30/1' default")
    assert offenders == []


# --- C2: no eval() of ffprobe output ---------------------------------------------

def test_no_eval_in_app():
    offenders = []
    for path in APP_ROOT.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "eval":
                offenders.append(f"{path.relative_to(APP_ROOT)}:{node.lineno}")
    assert offenders == []


# --- C3: local Spotlight render keeps the input length ---------------------------

def test_local_spotlight_render_keeps_input_length(tmp_path):
    """Golden-output check: a 2 s clip whose audio track is only 0.5 s long must
    render to a 2 s Spotlight video (`-shortest` cut it to the audio length)."""
    from app.routers.export.overlay import _process_frames_to_ffmpeg

    src = _make_video(tmp_path / "in.mp4", seconds=2, audio_seconds=0.5)
    out = tmp_path / "out.mp4"
    frames = _process_frames_to_ffmpeg(str(src), str(out), [], "dark_overlay", lambda *a: None)
    assert frames == 50
    assert _video_stream_duration(out) == pytest.approx(_video_stream_duration(src), abs=0.05)
