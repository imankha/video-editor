"""
T5240 — animated branded outro (spin -> play-button press rework).

T3950 shipped a near-static card (dark bg + flat lockup + two captions). The first T5240
pass animated that lockup; this rework rebuilds the logo from its SVG PARTS and animates
them inside `_build_outro_card`'s filtergraph (the card is still encoded once and cached,
so animation stays free at export time):
  - a WHITE-FLASH entrance (shared "flash" vocab with the player intro, T5210) that gives
    a DETERMINISTIC white frame 0 on every ffmpeg build,
  - the film-reel RING (outer ring + 4 sprocket holes) SPINS in, decelerating to a stop,
  - then the white PLAY triangle LANDS with a button-press bounce (scale overshoot),
  - the captions STAGGER in: "Made with" + "Reel Ballers" brand, then the tagline
    ("Share Your Player's Brilliance"), then the URL.

These tests build the card in isolation and read luma over its timeline (seek-free) to pin
that motion, so a regression back to a static/fade-up card, a missing play button, or the
old flat lockup is caught. The T3950 suite still guards concat/aspect/non-fatal/cache.
"""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.branded_outro import (
    OUTRO_BRAND_IN_ST,
    OUTRO_FLASH_IN,
    OUTRO_PLAY_ST,
    OUTRO_TAGLINE_IN_ST,
    OUTRO_URL_IN_ST,
    TAGLINE_TEXT,
    _build_outro_card,
)

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe required for outro render tests",
)

# The tagline the card must carry (also asserted verbatim so a copy change fails loudly).
EXPECTED_TAGLINE = "Share Your Player's Brilliance"

# Crops on the default 1080x1920 card. `center` is the emblem INTERIOR (where the play
# triangle lands -- inside the ring, so the ring band itself is excluded); `emblem` is the
# whole logo (ring + interior); the caption bands sit below the emblem.
CROP_CENTER = "crop=iw*0.20:iw*0.20:iw*0.40:ih*0.34"
CROP_EMBLEM = "crop=iw*0.34:iw*0.34:iw*0.33:ih*0.30"
CROP_BRAND = "crop=iw:ih*0.06:0:ih*0.51"
CROP_TAGLINE = "crop=iw:ih*0.05:0:ih*0.57"
CROP_URL = "crop=iw:ih*0.05:0:ih*0.89"


def _info(w: int, h: int, has_audio: bool = True) -> dict:
    """A probe-shaped info dict for building a card standalone (no source video needed)."""
    return {
        "width": w, "height": h, "fps_str": "30/1", "pix_fmt": "yuv420p",
        "sar": "1/1", "timescale": 15360, "duration": 0.0,
        "has_audio": has_audio, "a_codec": "aac", "a_rate": 48000, "a_channels": 2,
    }


def _run_yavg(path: Path, chain: str) -> float:
    r = subprocess.run(
        ["ffmpeg", "-i", str(path), "-vf", chain, "-vsync", "0",
         "-frames:v", "1", "-an", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    lines = [ln for ln in r.stderr.splitlines() if "YAVG" in ln]
    assert lines, f"could not read luma from {path} (chain={chain})"
    # Take the FIRST printed frame, not the last. `-frames:v 1` bounds the null MUXER to
    # one frame but does NOT bound the `metadata=print` FILTER -- on older ffmpeg (the apt
    # build CI uses) the filtergraph keeps pulling frames until teardown, so metadata prints
    # for many frames even though only one is muxed. Both callers want the first matching
    # frame (frame 0, or the first frame passing the `select`), always printed first in
    # presentation order. `lines[-1]` would silently read a later frame on CI.
    return float(lines[0].split("YAVG=")[1].strip())


def _yavg_at(path: Path, t: float, crop: str | None = None) -> float:
    """Average luma of the frame at ~`t` seconds, sampled SEEK-FREE.

    Decodes from the start and `select`s the first frame with pts >= t (no `-ss`). Input
    seeking (`-ss` before `-i`) is keyframe-based and NOT frame-accurate across ffmpeg
    builds; decoding forward and selecting by timestamp is frame-accurate everywhere.
    """
    chain = f"select='gte(t\\,{t})'"
    if crop:
        chain += f",{crop}"
    chain += ",signalstats,metadata=print:key=lavfi.signalstats.YAVG"
    return _run_yavg(path, chain)


def _yavg_first_frame(path: Path, crop: str | None = None) -> float:
    """Average luma of the VERY FIRST output frame (t=0), no seek, no select.

    The strongest portable proof of the white-flash entrance: at t=0 the fade-from-white is
    at fraction 0 => a fully white frame on every ffmpeg build (verified 235 on 6.0/6.1/7.1)."""
    chain = f"{crop}," if crop else ""
    chain += "signalstats,metadata=print:key=lavfi.signalstats.YAVG"
    return _run_yavg(path, chain)


@pytest.fixture
def card(tmp_path):
    def _build(w=1080, h=1920, has_audio=True):
        p = tmp_path / f"card_{w}x{h}.mp4"
        _build_outro_card(str(p), _info(w, h, has_audio))
        return p
    return _build


def test_tagline_constant_is_exact():
    """The card's tagline is the exact approved copy (guards the string the card burns in)."""
    assert TAGLINE_TEXT == EXPECTED_TAGLINE


def test_entrance_is_white_flash_not_black_fade(card):
    """The card PUNCHES IN from white (frame 0 is white, decaying fast), not a fade up from
    black. Frame 0 is the deterministic white anchor that renders identically on every
    ffmpeg build; a black fade-up would have frame 0 DARK and rising (the opposite)."""
    c = card()
    first = _yavg_first_frame(c)                       # t=0: fade-from-white at fraction 0
    after_flash = _yavg_at(c, OUTRO_FLASH_IN + 0.15)   # flash cleared, card revealed
    assert first > 150.0, f"entrance is not a white flash (frame-0 YAVG={first:.1f})"
    assert first - after_flash > 80.0, (
        f"no flash decay: first={first:.1f} after={after_flash:.1f}")


def test_ring_spins_in_before_play_lands(card):
    """The film-reel RING reveals FIRST (it is lit while the emblem interior is still empty),
    and the emblem brightens as it resolves. Pins that the ring comes in ahead of the play
    button -- the spin-then-resolve ordering -- not a single static logo."""
    c = card()
    # While the ring is in but the play button has NOT landed yet (before OUTRO_PLAY_ST),
    # the ring band is clearly lit while the interior (where the triangle will land) is
    # still near the dark background baseline.
    t_ring_only = OUTRO_PLAY_ST - 0.20
    ring = _yavg_at(c, t_ring_only, crop=CROP_EMBLEM)
    interior = _yavg_at(c, t_ring_only, crop=CROP_CENTER)
    assert ring > interior + 4.0, (
        f"ring not revealed ahead of the play button: ring={ring:.1f} interior={interior:.1f}")
    # The emblem brightens from its early reveal (ring fading in) to fully resolved.
    early = _yavg_at(c, 0.20, crop=CROP_EMBLEM)
    settled = _yavg_at(c, 1.60, crop=CROP_EMBLEM)
    assert settled > early + 8.0, (
        f"emblem does not resolve/brighten: early={early:.1f} settled={settled:.1f}")


def test_play_button_lands_with_press_bounce(card):
    """The white PLAY triangle LANDS in the emblem interior (dark before it arrives, bright
    after), and the landing OVERSHOOTS then settles -- the button-press bounce."""
    c = card()
    before = _yavg_at(c, OUTRO_PLAY_ST - 0.10, crop=CROP_CENTER)  # interior empty (ring hollow)
    peak = _yavg_at(c, OUTRO_PLAY_ST + 0.16, crop=CROP_CENTER)    # press overshoot (bigger)
    settled = _yavg_at(c, OUTRO_PLAY_ST + 0.70, crop=CROP_CENTER)  # settled at rest size
    # The triangle lands: the interior goes from ~background to clearly lit.
    assert settled > before + 12.0, (
        f"play button never lands: before={before:.1f} settled={settled:.1f}")
    # ...and it overshoots on the way in (the bounce): the triangle is momentarily larger,
    # so the interior crop is brighter at the press peak than once it settles.
    assert peak > settled + 1.5, (
        f"no press/bounce overshoot: peak={peak:.1f} settled={settled:.1f}")


def test_captions_stagger_in(card):
    """The three caption lines STAGGER: the "Reel Ballers" brand comes in first, then the
    tagline, then the URL -- each still at the dark baseline when the line above it is
    already lit. Pins that they do not simply fade up together."""
    c = card()
    baseline = _yavg_at(c, OUTRO_BRAND_IN_ST - 0.05, crop=CROP_BRAND)  # before any caption

    # A moment after the brand has come in but BEFORE the tagline starts: brand lit, both
    # the tagline and URL still at baseline.
    t_brand = OUTRO_TAGLINE_IN_ST - 0.05
    brand_mid = _yavg_at(c, t_brand, crop=CROP_BRAND)
    tag_at_brand = _yavg_at(c, t_brand, crop=CROP_TAGLINE)
    assert brand_mid > baseline + 8.0, (
        f'"Reel Ballers" did not fade in: baseline={baseline:.1f} mid={brand_mid:.1f}')
    assert brand_mid > tag_at_brand + 8.0, (
        f"brand/tagline did not stagger: brand={brand_mid:.1f} tag={tag_at_brand:.1f}")

    # A moment after the tagline has come in but BEFORE the URL starts: tagline lit, URL
    # still at baseline.
    t_tag = OUTRO_URL_IN_ST - 0.02
    tag_mid = _yavg_at(c, t_tag, crop=CROP_TAGLINE)
    url_at_tag = _yavg_at(c, t_tag, crop=CROP_URL)
    assert tag_mid > url_at_tag + 6.0, (
        f"tagline/URL did not stagger: tag={tag_mid:.1f} url={url_at_tag:.1f}")

    # ...and the URL does come in by the end.
    url_end = _yavg_at(c, 2.30, crop=CROP_URL)
    assert url_end > url_at_tag + 3.0, (
        f"URL caption never staggered in: mid={url_at_tag:.1f} end={url_end:.1f}")

    # Sanity: the three lines lead one another on the timeline.
    assert OUTRO_BRAND_IN_ST < OUTRO_TAGLINE_IN_ST < OUTRO_URL_IN_ST


def test_animation_present_without_audio(card):
    """The animation is independent of the audio track (16:9 reels ship without audio)."""
    c = card(1920, 1080, has_audio=False)
    first = _yavg_first_frame(c)
    settled = _yavg_at(c, 1.70)
    assert first > 150.0, f"no white flash on the no-audio card (first={first:.1f})"
    assert settled < first, "card should settle darker than the flash frame"
