"""
T5240 — animated branded outro.

T3950 shipped a near-static card (dark bg + logo + two captions, fading up from black).
T5240 animates it INSIDE `_build_outro_card`'s filtergraph (the card is still encoded once
and cached, so animation is free at export time):
  - a WHITE-FLASH entrance (shared "flash" motion vocabulary with the player intro, T5210),
    NOT a fade-up-from-black,
  - the logo slides up + fades in over the first ~half second,
  - the two captions STAGGER in ("Made with" first, the URL on a later offset).

These tests build the card in isolation and read luma over its timeline to pin that motion,
so a regression back to a static/fade-up card is caught. The T3950 suite still guards the
concat/aspect-ratio/non-fatal/cache contract (unchanged).
"""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.branded_outro import (
    OUTRO_FLASH_IN,
    OUTRO_MADE_IN_ST,
    OUTRO_URL_IN_ST,
    _build_outro_card,
)

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe required for outro render tests",
)


def _info(w: int, h: int, has_audio: bool = True) -> dict:
    """A probe-shaped info dict for building a card standalone (no source video needed)."""
    return {
        "width": w, "height": h, "fps_str": "30/1", "pix_fmt": "yuv420p",
        "sar": "1/1", "timescale": 15360, "duration": 0.0,
        "has_audio": has_audio, "a_codec": "aac", "a_rate": 48000, "a_channels": 2,
    }


def _yavg(path: Path, ss: float, crop: str | None = None) -> float:
    """Average luma of the frame at `ss` seconds (optionally within a crop region)."""
    vf = "signalstats,metadata=print:key=lavfi.signalstats.YAVG"
    if crop:
        vf = f"{crop},{vf}"
    r = subprocess.run(
        ["ffmpeg", "-ss", f"{ss}", "-i", str(path), "-vf", vf, "-frames:v", "1", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    lines = [ln for ln in r.stderr.splitlines() if "YAVG" in ln]
    assert lines, f"could not read luma at t={ss}"
    return float(lines[-1].split("YAVG=")[1].strip())


@pytest.fixture
def card(tmp_path):
    def _build(w=1080, h=1920, has_audio=True):
        p = tmp_path / f"card_{w}x{h}.mp4"
        _build_outro_card(str(p), _info(w, h, has_audio))
        return p
    return _build


def test_entrance_is_white_flash_not_black_fade(card):
    """The card PUNCHES IN from white (bright first frame decaying fast), not a fade up from
    black. The old T3950 card started near-black (fade=color=black); this pins the flash."""
    c = card()
    first = _yavg(c, 0.01)          # inside the flash
    after_flash = _yavg(c, OUTRO_FLASH_IN + 0.10)  # flash gone, card revealed
    # White flash => the first frame is very bright...
    assert first > 150.0, f"entrance is not a white flash (first-frame YAVG={first:.1f})"
    # ...and it decays sharply once the flash clears (regression guard vs a static/lit card).
    assert first - after_flash > 80.0, (
        f"no flash decay: first={first:.1f} after={after_flash:.1f}")


def test_logo_reveals_over_time(card):
    """The logo fades/slides in: the card is dimmer during the reveal than once settled."""
    c = card()
    early = _yavg(c, 0.20)   # flash gone, logo mid-reveal (dimmer, partly transparent)
    settled = _yavg(c, 1.55)  # fully revealed + captions in
    assert settled > early + 3.0, (
        f"logo/card does not brighten as it reveals: early={early:.1f} settled={settled:.1f}")


def test_captions_stagger_in(card):
    """The captions STAGGER: at t just past OUTRO_MADE_IN_ST's fade, "Made with" (top band)
    is lit while the URL (bottom band) is still at background baseline; by the end BOTH are in.
    Pins that the two lines do not simply fade up together."""
    c = card()
    # Caption bands (dark bg baseline luma is ~29 in limited range; text adds a few points
    # over the band since the glyphs are a small fraction of its area).
    made_band = "crop=iw:ih*0.09:0:ih*0.13"   # "Made with", just above the logo
    url_band = "crop=iw:ih*0.14:0:ih*0.86"    # the URL, near the bottom edge

    baseline = _yavg(c, OUTRO_MADE_IN_ST - 0.06, crop=made_band)  # before either caption
    # A moment after "Made with" finishes fading and before the URL starts.
    t_mid = OUTRO_URL_IN_ST + 0.03
    made_mid = _yavg(c, t_mid, crop=made_band)
    url_mid = _yavg(c, t_mid, crop=url_band)
    url_end = _yavg(c, 1.55, crop=url_band)

    # "Made with" has come in by t_mid...
    assert made_mid > baseline + 3.0, (
        f'"Made with" did not fade in: baseline={baseline:.1f} mid={made_mid:.1f}')
    # ...while the URL is still at (near) baseline at that same instant -> STAGGER.
    assert made_mid > url_mid + 3.0, (
        f"captions did not stagger (URL already in with 'Made with'): "
        f"made={made_mid:.1f} url={url_mid:.1f} @t={t_mid:.2f}")
    # ...and the URL does come in by the end.
    assert url_end > url_mid + 2.0, (
        f"URL caption never staggered in: mid={url_mid:.1f} end={url_end:.1f}")
    # Sanity: "Made with" leads the URL on the timeline.
    assert OUTRO_MADE_IN_ST < OUTRO_URL_IN_ST


def test_animation_present_without_audio(card):
    """The animation is independent of the audio track (16:9 reels ship without audio)."""
    c = card(1920, 1080, has_audio=False)
    first = _yavg(c, 0.01)
    settled = _yavg(c, 1.55)
    assert first > 150.0, f"no white flash on the no-audio card (first={first:.1f})"
    assert settled < first, "card should settle darker than the flash frame"
