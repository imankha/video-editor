"""
T3950 — "Made with Reel Ballers" branded outro.

The outro is a render-time end-card (~1.75s) appended to the FINAL published video.
These tests exercise the render helper directly (real ffmpeg) across every acceptance
criterion that does not need a live R2/DB round trip:

  - single-clip reels end with the outro, correct for the aspect ratio (9:16/1:1/16:9)
  - EXACTLY one outro is appended (out_duration == content + OUTRO_DURATION)
  - the card matches the reel resolution (no letterboxing/stretch): out WxH == in WxH
  - the card carries audio iff the reel does (clean audio concat, no stream drift)
  - the card is visible (non-black final frame with text)
  - the flag (BRANDED_OUTRO_ENABLED) gates the whole feature off -> zero outro
  - the helper is pure render-time: it imports NO DB/persistence modules

The multi-clip "exactly one outro" and re-export "no double" criteria are structural:
the outro is wired ONLY into the final-video producers (overlay render / export_final),
never the framing or multi-clip stitch that produce the intermediate working video, so
a stitched collection and a re-export each get one outro from the single final step.
That wiring is covered end-to-end by the mandatory live-drive QA (see the task file);
here we prove the append primitive those sites call.
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


@pytest.mark.asyncio
async def test_overlay_render_appends_outro_before_finalize(monkeypatch):
    """Wiring proof for the main flow (Site 1): the overlay real-render background task
    appends the outro to the FINAL object, and does so BEFORE the DB finalize / sync gate.

    Drives the real `_run_overlay_export_background` with the render engine, R2 helper,
    finalize, and sync all mocked -- so it needs neither a GPU/subprocess nor R2, and
    isn't blocked by the container's local-overlay ProcessPool contextvar limitation.
    """
    from unittest.mock import AsyncMock, MagicMock
    from app.routers.export import overlay as ov

    order = []

    async def fake_overlay_auto(**kwargs):
        # Assert the outro is appended to the SAME key the engine wrote the final to.
        assert kwargs["output_key"].startswith("final_videos/")
        order.append(("render", kwargs["output_key"]))
        return {"status": "success"}

    def fake_apply_outro(user_id, key):
        order.append(("outro", key))
        return True

    def fake_finalize(*a, **k):
        order.append(("finalize", None))
        return 4242

    monkeypatch.setattr(ov, "call_modal_overlay_auto", fake_overlay_auto)
    monkeypatch.setattr("app.services.branded_outro.apply_branded_outro_to_r2_object", fake_apply_outro)
    monkeypatch.setattr(ov, "_finalize_overlay_export", fake_finalize)
    monkeypatch.setattr("app.services.export_helpers.sync_export_db_to_r2", lambda *a, **k: True)
    monkeypatch.setattr(ov.manager, "send_progress", AsyncMock())
    monkeypatch.setattr(ov, "export_progress", {})

    await ov._run_overlay_export_background(
        export_id="t3950-wire", project_id=7, project_name="P", user_id="u", profile_id="pf",
        working_filename="working_7.mp4",
        highlight_regions=[{"keyframes": [{"t": 0}]}], effect_type="dark_overlay",
        video_duration=3.0, overlay_settings={},
    )

    steps = [s[0] for s in order]
    assert steps == ["render", "outro", "finalize"], steps
    # The outro targeted the exact final object the engine produced.
    render_key = next(k for s, k in order if s == "render")
    outro_key = next(k for s, k in order if s == "outro")
    assert outro_key == render_key
