"""
T3950 — "Made with Reel Ballers" branded outro.

Architecture (post-pivot): playback composited on shared/public surfaces (edge function
+ React viewers); burned into the file ONLY at download time via GET /api/downloads/{id}/file.
Stored final_videos carry NO outro so every existing reel gets attribution for free on download.

These tests exercise the ffmpeg helper directly across every acceptance criterion that
does not need a live R2/DB round trip:

  - single-clip reels end with the outro, correct for the aspect ratio (9:16/1:1/16:9)
  - EXACTLY one outro is appended (out_duration == content + OUTRO_DURATION)
  - the card matches the reel resolution (no letterboxing/stretch): out WxH == in WxH
  - the card carries audio iff the reel does (clean audio concat, no stream drift)
  - the card is visible (non-black final frame with text)
  - the flag (BRANDED_OUTRO_ENABLED) gates the whole feature off -> original served
  - the card is cached per resolution/fps so repeat downloads do not rebuild it
  - card build failure is non-fatal: returns False without raising
  - the helper imports NO DB/persistence modules (render-time only)
"""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import branded_outro
from app.services.branded_outro import (
    OUTRO_DURATION,
    append_branded_outro,
    apply_branded_outro_to_bytes,
)

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe required for outro render tests",
)

# (label, width, height, has_audio) — the three shipped aspect ratios + an audio split.
RATIOS = [
    ("9x16", 810, 1440, True),
    ("1x1", 1080, 1080, True),
    ("16x9", 1920, 1080, False),
]

CONTENT_DURATION = 2.5


def _make_main(path: Path, w: int, h: int, has_audio: bool, duration: float = CONTENT_DURATION):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=size={w}x{h}:rate=30:duration={duration}",
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
def tmp_video(tmp_path):
    def _factory(w, h, has_audio, duration=CONTENT_DURATION, name="main.mp4"):
        p = tmp_path / name
        _make_main(p, w, h, has_audio, duration)
        return p
    return _factory


@pytest.mark.parametrize("label,w,h,has_audio", RATIOS, ids=[r[0] for r in RATIOS])
def test_outro_appended_each_ratio(tmp_path, tmp_video, monkeypatch, label, w, h, has_audio):
    """Outro is appended for every aspect ratio, exactly once, at native resolution."""
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    main = tmp_video(w, h, has_audio)
    out = tmp_path / "out.mp4"

    assert append_branded_outro(str(main), str(out)) is True
    assert out.exists()

    m = branded_outro._probe_media(str(main))
    o = branded_outro._probe_media(str(out))

    # No letterboxing/stretch: the output keeps the reel's exact dimensions.
    assert (o["width"], o["height"]) == (w, h)
    # EXACTLY one outro: output length == content + one card (tolerance for keyframe
    # rounding at the concat boundary).
    assert o["duration"] == pytest.approx(m["duration"] + OUTRO_DURATION, abs=0.35)
    # Audio parity: card carries audio iff the reel does.
    assert o["has_audio"] == has_audio


@pytest.mark.parametrize("label,w,h,has_audio", RATIOS, ids=[r[0] for r in RATIOS])
def test_final_frame_shows_card(tmp_path, tmp_video, monkeypatch, label, w, h, has_audio):
    """The reel ends ON the card: the final frame is non-black (dark bg + bright text)."""
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    main = tmp_video(w, h, has_audio)
    out = tmp_path / "out.mp4"
    assert append_branded_outro(str(main), str(out)) is True

    # Sample the last frame and read its average luma. The card background is very dark
    # (~8) but the wordmark + URL raise the mean well above pure black.
    r = subprocess.run(
        ["ffmpeg", "-sseof", "-0.4", "-i", str(out),
         "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
         "-frames:v", "1", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    yavg_lines = [ln for ln in r.stderr.splitlines() if "YAVG" in ln]
    assert yavg_lines, "could not read final-frame luma"
    yavg = float(yavg_lines[-1].split("YAVG=")[1].strip())
    assert yavg > 18.0, f"final frame looks black (YAVG={yavg}) — card/text missing"


def test_final_frame_shows_logo_emblem(tmp_path, tmp_video, monkeypatch):
    """The card carries the LOGO (purple play-emblem), not just text -- a regression
    to the old text-only card would have no meaningful purple, so this pins it."""
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    main = tmp_video(1080, 1920, True)
    out = tmp_path / "out.mp4"
    assert append_branded_outro(str(main), str(out)) is True

    frame = tmp_path / "last.png"
    subprocess.run(
        ["ffmpeg", "-y", "-sseof", "-0.1", "-i", str(out), "-frames:v", "1", str(frame)],
        capture_output=True, check=True,
    )
    import cv2
    img = cv2.imread(str(frame))  # BGR
    h = img.shape[0]
    # Emblem sits in the vertical middle band; count pixels near brand purple.
    band = img[int(h * 0.30):int(h * 0.70), :, :]
    b, g, r_ = band[:, :, 0].astype(int), band[:, :, 1].astype(int), band[:, :, 2].astype(int)
    # brand purple ~ #a855f7 (R168 G85 B247): high R & B, lower G.
    purple = ((r_ > 110) & (b > 160) & (g < 150) & (b > g + 40)).sum()
    assert purple > 500, f"no logo emblem in final frame (purple px={purple})"


def test_flag_off_skips_outro(tmp_path, tmp_video, monkeypatch):
    """BRANDED_OUTRO_ENABLED=false -> no outro, no output written (feature gated off)."""
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "false")
    main = tmp_video(810, 1440, True)
    out = tmp_path / "out.mp4"
    assert append_branded_outro(str(main), str(out)) is False
    assert not out.exists()


def test_bytes_helper_roundtrip(tmp_path, tmp_video, monkeypatch):
    """export_final's bytes path lengthens the video when on, and is a no-op when off."""
    main = tmp_video(1080, 1080, True)
    content = main.read_bytes()

    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    with_outro = apply_branded_outro_to_bytes(content)
    assert len(with_outro) != len(content)
    probe_path = tmp_path / "withoutro.mp4"
    probe_path.write_bytes(with_outro)
    o = branded_outro._probe_media(str(probe_path))
    assert o["duration"] == pytest.approx(CONTENT_DURATION + OUTRO_DURATION, abs=0.35)

    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "false")
    assert apply_branded_outro_to_bytes(content) == content


def test_render_time_only_no_persistence_imports():
    """The outro module must not import DB/persistence layers — it's pure render-time.

    Guards the CLAUDE.md invariant that no outro data leaks into working clip/keyframe
    state: the helper only ever touches ffmpeg + R2 storage, never a DB writer.
    """
    import ast

    tree = ast.parse(Path(branded_outro.__file__).read_text())
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported.add(node.module or "")
            imported.update(f"{node.module}.{a.name}" for a in node.names)

    banned = ("user_db", "database", "get_db_connection", "queries", ".pg")
    offenders = [m for m in imported for b in banned if b in m]
    assert not offenders, f"branded_outro must not import persistence layers: {offenders}"
    # The ONLY app dependency is R2 storage (render I/O). No DB/persistence anywhere.
    app_imports = {m for m in imported if m.startswith("app.")}
    assert app_imports <= {"app.storage", "app.storage.download_from_r2",
                           "app.storage.upload_to_r2"}, app_imports


def test_card_cache_is_reused(tmp_path, tmp_video, monkeypatch):
    """The card is built ONCE and cached per resolution/fps; a second call does not
    re-invoke _build_outro_card.  Verifies the _CARD_CACHE_DIR cache path is hit."""
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    # Point the card cache to the test's tmp_path so it is clean and isolated.
    monkeypatch.setattr(branded_outro, "_CARD_CACHE_DIR", tmp_path / "card_cache")

    build_calls = []
    real_build = branded_outro._build_outro_card

    def counting_build(card_path, info):
        build_calls.append(card_path)
        real_build(card_path, info)

    monkeypatch.setattr(branded_outro, "_build_outro_card", counting_build)

    main = tmp_video(810, 1440, True)
    out1 = tmp_path / "out1.mp4"
    out2 = tmp_path / "out2.mp4"

    assert append_branded_outro(str(main), str(out1)) is True
    assert append_branded_outro(str(main), str(out2)) is True

    assert len(build_calls) == 1, f"card must be built once and cached; got {len(build_calls)} builds"


def test_download_outro_flag_off_returns_false(tmp_path, tmp_video, monkeypatch):
    """BRANDED_OUTRO_ENABLED=false -> append_branded_outro returns False (original served)."""
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "false")
    main = tmp_video(810, 1440, True)
    out = tmp_path / "out.mp4"
    assert append_branded_outro(str(main), str(out)) is False
    assert not out.exists()


def test_download_outro_failure_is_nonfatal(tmp_path, tmp_video, monkeypatch):
    """Corrupt card path -> append returns False without raising; original is NOT
    written to out_path so the caller can detect failure and serve the original."""
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    monkeypatch.setattr(branded_outro, "_CARD_CACHE_DIR", tmp_path / "card_cache")

    def bad_build(card_path, info):
        raise RuntimeError("injected card build failure")

    monkeypatch.setattr(branded_outro, "_build_outro_card", bad_build)

    main = tmp_video(810, 1440, True)
    out = tmp_path / "out.mp4"
    result = append_branded_outro(str(main), str(out))
    assert result is False
    assert not out.exists(), "out_path must not be written on failure"
