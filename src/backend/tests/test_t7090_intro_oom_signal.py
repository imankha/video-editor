"""T7090 (fix #3) -- stop swallowing an OOM/SIGKILL into an ordinary card miss.

The intro-card ffmpeg subprocess is OOM-killed by the kernel on a 1GB Fly box
(returncode == -9). Before this fix `_get_or_build_card` collapsed that into a
plain `None`, indistinguishable from "this reel has no intro configured", so the
download shipped a 200 with silently missing content and nothing was logged
loudly.

These tests lock the distinguishing behaviour:
  - a SIGNAL-terminated render (negative returncode) is logged at CRITICAL with
    the INTRO_CARD_OOM marker AND surfaces `degraded_reason` through the report
    out-dict;
  - an ordinary (positive returncode) build failure stays an ERROR with no
    degraded_reason -- it is NOT an infrastructure kill;
  - the never-raise / HTTP-200-always compose contract is preserved (a killed
    intro still ships the reel), but a caller that passes a report now learns the
    fidelity was lost to an infra kill.
"""

import logging
import shutil
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import player_intro as P  # noqa: E402
from app.services.player_intro import INTRO_DEGRADED_KILLED, build_intro_card  # noqa: E402

pytestmark = pytest.mark.filterwarnings("ignore")


def _info(aspect: str = "9:16", audio: bool = False) -> dict:
    w, h = (270, 480) if aspect == "9:16" else (480, 270)
    return {"width": w, "height": h, "fps_str": "30/1", "pix_fmt": "yuv420p",
            "sar": "1/1", "timescale": 15360, "duration": 0.0, "has_audio": audio,
            "a_codec": "aac", "a_rate": 48000, "a_channels": 2}


def _card(shown=None, treatment="dark", **kw) -> dict:
    c = {"id": 7, "name": "card", "shown_fields": shown or ["position"],
         "treatment": treatment, "title_text": None, "subtitle_text": None,
         "image_key": "k", "image_cutout_key": None, "focal_x": 0.5,
         "focal_y": 0.25, "zoom": 1.1, "text_elements": {}, "duration": 1.0,
         "is_default": False}
    c.update(kw)
    return c


FIELDS = {"full_name": "Marcus Johnson", "position": "Point Guard"}


@pytest.fixture(autouse=True)
def _isolated_card_cache(tmp_path, monkeypatch):
    """Point the card cache at a clean per-test dir so a real cached card from a
    prior run can never short-circuit the build we are exercising."""
    monkeypatch.setattr(P, "_CARD_CACHE_DIR", tmp_path / "cards")


def _kill(returncode: int):
    """A _build_card stand-in that dies exactly like ffmpeg would: a
    CalledProcessError whose returncode is negative for a signal kill."""
    def _raise(*_a, **_k):
        raise subprocess.CalledProcessError(
            returncode, ["ffmpeg"], output="", stderr="Killed (out of memory)")
    return _raise


# =============================================================================
# 1. SIGKILL (negative returncode) -> CRITICAL + degraded_reason
# =============================================================================
def test_sigkill_logs_critical_and_reports_degraded(monkeypatch, caplog):
    monkeypatch.setattr(P, "_build_card", _kill(-9))
    report: dict = {}
    with caplog.at_level(logging.CRITICAL, logger="app.services.player_intro"):
        path = P._get_or_build_card(_card(), FIELDS, None, _info(), report=report)

    assert path is None
    assert report.get("degraded_reason") == INTRO_DEGRADED_KILLED
    crit = [r for r in caplog.records if r.levelno >= logging.CRITICAL]
    assert crit, "an OOM/SIGKILL must be logged at CRITICAL, not silently swallowed"
    assert any("INTRO_CARD_OOM" in r.getMessage() for r in crit)


# =============================================================================
# 2. Ordinary build failure (positive returncode) is NOT an infra kill
# =============================================================================
def test_ordinary_failure_is_not_critical_and_not_degraded(monkeypatch, caplog):
    monkeypatch.setattr(P, "_build_card", _kill(1))
    report: dict = {}
    with caplog.at_level(logging.DEBUG, logger="app.services.player_intro"):
        path = P._get_or_build_card(_card(), FIELDS, None, _info(), report=report)

    assert path is None
    assert "degraded_reason" not in report
    assert not [r for r in caplog.records if r.levelno >= logging.CRITICAL], \
        "an ordinary build failure must NOT be a CRITICAL infra alert"


# =============================================================================
# 3. build_intro_card threads the report through (no report passed still works)
# =============================================================================
def test_build_intro_card_threads_report(monkeypatch, tmp_path):
    monkeypatch.setattr(P, "_build_card", _kill(-9))
    report: dict = {}
    ok = build_intro_card(_card(), FIELDS, None, _info(),
                          str(tmp_path / "intro.mp4"), report=report)
    assert ok is False
    assert report.get("degraded_reason") == INTRO_DEGRADED_KILLED


def test_build_intro_card_without_report_is_backcompat(monkeypatch, tmp_path):
    monkeypatch.setattr(P, "_build_card", _kill(-9))
    # No report kwarg -> the old signature still works, still returns False.
    assert build_intro_card(_card(), FIELDS, None, _info(),
                            str(tmp_path / "intro.mp4")) is False


# =============================================================================
# 4. compose_serve_time: killed intro still ships the reel, but reports the loss
# =============================================================================
@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe required for the compose integration check",
)
def test_compose_surfaces_intro_kill_but_still_ships(tmp_path, monkeypatch):
    from app.services.intro_egress import IntroSpec
    from app.services.serve_time_video import compose_serve_time

    reel = tmp_path / "reel.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=270x480:rate=30:duration=1",
         "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-an", str(reel)],
        capture_output=True, check=True)

    monkeypatch.setattr(P, "_build_card", _kill(-9))
    intro = IntroSpec(card=_card(), field_values=FIELDS, image_path=None,
                      tempdir=str(tmp_path / "intro_tmp"))
    out = tmp_path / "out.mp4"
    report: dict = {}
    result = compose_serve_time(str(reel), str(out), intro=intro, outro=False,
                                report=report)

    assert result is True, "the reel must still ship even when the intro is OOM-killed"
    assert out.exists()
    assert report["full_fidelity"] is False
    assert report.get("degraded_reason") == INTRO_DEGRADED_KILLED
