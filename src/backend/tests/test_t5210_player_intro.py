"""T5210 — player intro card render engine.

Fast pure-function tests (element selection, spec merge, framing, cache hash) +
a few real-ffmpeg build/prepend tests (small frames, short duration) that assert
the engine produces a valid animated MP4 with the flash exit, mirroring the
T5240 luma-evidence approach.
"""

import subprocess
from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.services import player_intro as P

pytestmark = pytest.mark.filterwarnings("ignore")


# --- fixtures ----------------------------------------------------------------
@pytest.fixture
def photo(tmp_path) -> str:
    p = tmp_path / "photo.png"
    img = Image.new("RGB", (600, 800), (30, 80, 160))
    img.paste((240, 60, 60), (150, 120, 450, 700))
    img.save(p)
    return str(p)


@pytest.fixture
def cutout(tmp_path) -> str:
    p = tmp_path / "cut.png"
    img = Image.new("RGBA", (600, 800), (0, 0, 0, 0))
    img.paste((240, 60, 60, 255), (150, 120, 450, 700))
    img.save(p)
    return str(p)


def _info(aspect: str, audio: bool = False) -> dict:
    w, h = (270, 480) if aspect == "9:16" else (480, 270)
    return {"width": w, "height": h, "fps_str": "30/1", "pix_fmt": "yuv420p",
            "sar": "1/1", "timescale": 15360, "duration": 0.0, "has_audio": audio,
            "a_codec": "aac", "a_rate": 48000, "a_channels": 2}


def _card(shown, treatment="dark", **kw) -> dict:
    c = {"id": 1, "name": "card", "shown_fields": shown, "treatment": treatment,
         "title_text": "Marcus Johnson", "image_key": "k", "image_cutout_key": None,
         "focal_x": 0.5, "focal_y": 0.25, "zoom": 1.1, "text_elements": {},
         "duration": 1.0, "is_default": False}
    c.update(kw)
    return c


FIELDS = {"position": "Point Guard", "class": "2027", "team": "Ballers Elite"}


# =============================================================================
# Pure functions
# =============================================================================
def test_render_background_solid_is_flat():
    bg = {"type": "solid", "color": "#04060a"}
    im = np.asarray(P._render_background(bg, 40, 30))
    assert im.shape == (30, 40, 3)
    assert (im == (4, 6, 10)).all()  # every pixel the flat fill colour


def test_render_background_radial_brightest_near_center_top():
    # gold: brighter (#2a2410) at the centre (.5, 0), darker (#0d0b06) outward.
    bg = {
        "type": "radial", "center": [0.5, 0.0], "extent": [1.2, 1.2],
        "stops": [{"color": "#2a2410", "pos": 0.0}, {"color": "#0d0b06", "pos": 0.70}],
    }
    im = np.asarray(P._render_background(bg, 100, 100)).astype(int)
    top_center = im[0, 50].sum()
    bottom_corner = im[99, 0].sum()
    assert top_center > bottom_corner  # gradient runs from the centre outward


def test_frame_photo_covers_exact_rect_and_keeps_alpha(photo, cutout):
    plain = P._frame_photo(photo, 100, 200, 0.5, 0.25, 1.1)
    assert plain.size == (100, 200)
    assert plain.mode == "RGB"
    cut = P._frame_photo(cutout, 100, 200, 0.5, 0.25, 1.0)
    assert cut.mode == "RGBA"
    # the transparent margins survive framing (bg shows through at render time)
    assert np.asarray(cut)[:, :, 3].min() == 0


_W916, _H916 = 1080, 1920
_W169, _H169 = 1920, 1080


def test_select_elements_title_from_profile_ignores_dead_title_text_and_text_elements():
    # T6620: the title TEXT is the profile's full_name ALWAYS; a stored
    # title_text ('DEAD') is no longer read (was a pre-T6570 override).
    # T6640: a legacy text_elements blob ('WRONG'/'graduate'/red) is ALSO
    # ignored entirely — typography is template-owned (ROLE_FOR_SLOT), never
    # read from the card. Both are grandfathered-dead columns.
    card = _card(["position"], text_elements={
        "title": {"text": "WRONG", "font": "graduate", "color": "#ff0000",
                  "size": 0.1, "position": {"x": 0.5, "y": 0.5}, "maxWidth": 0.8},
    }, title_text="DEAD")
    fields = {**FIELDS, "full_name": "Jordan Vega"}
    accent = "#f7e28b"
    els = P._select_elements(card, fields, "hero", "9:16", accent, _W916, _H916)
    title = next(e for e in els if e["slot"] == "title")
    assert title["spec"].text == "Jordan Vega"    # profile full_name, NOT title_text/text_elements
    assert title["spec"].font.value == "anton"    # TEMPLATE typography, not text_elements' 'graduate'
    assert title["spec"].color == accent          # the treatment accent, not text_elements' red


def test_select_elements_title_from_profile_full_name():
    # T6570: with no legacy title_text, the title text is the PROFILE's full name,
    # passed in via field_values["full_name"] (mirrors the browser preview).
    card = _card(["position"], title_text=None)
    fields = {**FIELDS, "full_name": "Jordan Vega"}
    els = P._select_elements(card, fields, "hero", "9:16", "#ffffff", _W916, _H916)
    title = next(e for e in els if e["slot"] == "title")
    assert title["spec"].text == "Jordan Vega"


def test_select_elements_title_text_is_dead_profile_full_name_always_wins():
    # T6620: a pre-T6570 card that stored a title_text no longer overrides the
    # profile — the profile's full name ALWAYS wins (the override trap is gone,
    # which is the whole point of the fix). Regression pin for report item 2.
    card = _card(["position"], title_text="Legacy Name")
    fields = {**FIELDS, "full_name": "Jordan Vega"}
    els = P._select_elements(card, fields, "hero", "9:16", "#ffffff", _W916, _H916)
    title = next(e for e in els if e["slot"] == "title")
    assert title["spec"].text == "Jordan Vega"


def test_select_elements_renders_card_subtitle_when_present():
    # T6570: subtitle is FREE TEXT on the card; it renders between title and
    # facts (STAGGER_ORDER), and is orthogonal to composition. T6640: it takes
    # the SECONDARY role (muted), grouped with the supporting facts.
    from app.services.intro_card_geometry import MUTED_COLOR
    card = _card(["position"], title_text=None, subtitle_text="State Cup 2027")
    fields = {**FIELDS, "full_name": "Jordan Vega"}
    els = P._select_elements(card, fields, "hero", "9:16", "#ffffff", _W916, _H916)
    sub = next(e for e in els if e["slot"] == "subtitle")
    assert sub["spec"].text == "State Cup 2027"
    assert sub["spec"].color == MUTED_COLOR
    # order: title, subtitle, then the fact
    assert [e["slot"] for e in els] == ["title", "subtitle", "fact1"]


def test_select_elements_omits_blank_subtitle(caplog):
    import logging
    caplog.set_level(logging.INFO)
    card = _card(["position"], title_text="T", subtitle_text="   ")
    els = P._select_elements(card, FIELDS, "hero", "9:16", "#ffffff", _W916, _H916)
    assert not any(e["slot"] == "subtitle" for e in els)
    assert "subtitle omitted" in caplog.text


def test_select_elements_ordinal_facts_use_role_typography_not_semantic_styling():
    # T6640: fact{i} geometry <- shown_fields[i] (ORDINAL, unchanged); but
    # STYLING no longer follows the semantic field at all — a legacy
    # text_elements['class'] entry is ignored, and colour/font come from the
    # ROLE (fact1 = primary/accent, fact2 = secondary/muted).
    from app.services.intro_card_geometry import MUTED_COLOR
    card = _card(["position", "class"], text_elements={
        "class": {"text": "", "font": "playfair", "color": "#00ff00",
                  "size": 0.05, "position": {"x": 0.5, "y": 0.5}, "maxWidth": 0.8},
    })
    accent = "#ffffff"
    els = P._select_elements(card, FIELDS, "broadcast", "9:16", accent, _W916, _H916)
    by_slot = {e["slot"]: e["spec"] for e in els}
    assert by_slot["fact1"].text == "Point Guard"        # shown_fields[0]=position
    assert by_slot["fact2"].text == "2027"               # shown_fields[1]=class
    # fact2 (class) ignores its text_elements entry entirely -- secondary role.
    assert by_slot["fact2"].font.value == "oswald"
    assert by_slot["fact2"].color == MUTED_COLOR
    # fact1 (position) is the PRIMARY role -- accented, same font family.
    assert by_slot["fact1"].font.value == "oswald"
    assert by_slot["fact1"].color == accent


def test_select_elements_omits_blank_fact_and_blank_title(caplog):
    import logging
    caplog.set_level(logging.INFO)
    card = _card(["position", "class", "team"], title_text="")
    partial = {"position": "Point Guard", "class": "2027"}  # team missing
    els = P._select_elements(card, partial, "recruiting", "9:16", "#ffffff", _W916, _H916)
    slots = {e["slot"] for e in els}
    assert slots == {"fact1", "fact2"}          # no title (blank), no fact3 (team unset)
    assert "title omitted" in caplog.text
    assert "team" in caplog.text and "omitted" in caplog.text


def test_content_hash_changes_on_pixel_edit_stable_on_rename(photo):
    info = _info("9:16")
    c1 = _card(["position"])
    els1 = P._select_elements(c1, FIELDS, "hero", "9:16", "#ffffff", _W916, _H916)
    h1 = P._content_hash(c1, FIELDS, photo, info, "hero", "9:16", els1)

    c_rename = dict(c1, name="totally different name")
    els_r = P._select_elements(c_rename, FIELDS, "hero", "9:16", "#ffffff", _W916, _H916)
    assert P._content_hash(c_rename, FIELDS, photo, info, "hero", "9:16", els_r) == h1

    # A real pixel edit: the subtitle is rendered (hero has a subtitle slot).
    c_edit = dict(c1, subtitle_text="State Cup 2027")
    els_e = P._select_elements(c_edit, FIELDS, "hero", "9:16", "#ffffff", _W916, _H916)
    assert P._content_hash(c_edit, FIELDS, photo, info, "hero", "9:16", els_e) != h1

    # T6620: the DEAD title_text affects NO pixels (never read) -> hash stable.
    c_dead = dict(c1, title_text="Whatever New")
    els_d = P._select_elements(c_dead, FIELDS, "hero", "9:16", "#ffffff", _W916, _H916)
    assert P._content_hash(c_dead, FIELDS, photo, info, "hero", "9:16", els_d) == h1

    # T6640: a DEAD text_elements edit affects NO pixels either -> hash stable.
    c_dead_style = dict(c1, text_elements={"title": {"text": "", "font": "playfair",
                         "color": "#ff0000", "size": 0.1,
                         "position": {"x": 0.5, "y": 0.5}, "maxWidth": 0.8}})
    els_ds = P._select_elements(c_dead_style, FIELDS, "hero", "9:16", "#ffffff", _W916, _H916)
    assert P._content_hash(c_dead_style, FIELDS, photo, info, "hero", "9:16", els_ds) == h1


# =============================================================================
# T6640 — wrap-never-collides matrix (the acceptance criterion). Contract-level
# invariance is already proven exhaustively by test_t5210_geometry_parity.py;
# this exercises the SAME property through the actual production entry point
# (_select_elements, with real card/profile dicts and the caption text from
# the reported bug), so a regression in the seam between the two (e.g. a bad
# STAGGER_ORDER filter, a role misassignment) would be caught here too.
# =============================================================================
@pytest.mark.parametrize("comp,shown,aspect,w,h", [
    ("title-only", [], "9:16", _W916, _H916),
    ("title-only", [], "16:9", _W169, _H169),
    ("hero", ["position"], "9:16", _W916, _H916),
    ("hero", ["position"], "16:9", _W169, _H169),
    ("broadcast", ["position", "class"], "9:16", _W916, _H916),
    ("broadcast", ["position", "class"], "16:9", _W169, _H169),
    ("recruiting", ["position", "class", "team"], "9:16", _W916, _H916),
    ("recruiting", ["position", "class", "team"], "16:9", _W169, _H169),
])
def test_select_elements_wrap_never_collides_matrix(comp, shown, aspect, w, h):
    card = _card(shown, title_text=None)
    # Invented long two-word name (NO PII) -- the exact shape of the reported bug.
    fields = {**FIELDS, "full_name": "Anastasia Wintergreen"}
    els = P._select_elements(card, fields, comp, aspect, "#f7e28b", w, h)

    intervals = []
    for el in els:
        spec = el["spec"]
        px = max(round(spec.size * h), 1)
        from app.services.fonts import load_font_for_render
        from app.services.text_render import wrap_lines
        font = load_font_for_render(spec.font.value, px)
        lines = len(wrap_lines(spec.text, font, spec.maxWidth * w))
        ascent, descent = font.getmetrics()
        y0 = spec.position.y
        y1 = y0 + lines * (ascent + descent) / h
        assert y0 >= -1e-6 and y1 <= 1.0 + 1e-6, f"{comp}/{aspect}/{el['slot']}: [{y0},{y1}] escapes frame"
        intervals.append((el["slot"], y0, y1))

    intervals.sort(key=lambda t: t[1])
    for (slot_a, _, end_a), (slot_b, start_b, _) in pairwise(intervals):
        assert start_b >= end_a - 1e-6, (
            f"{comp}/{aspect}: {slot_a} [ends {end_a:.4f}] collides with {slot_b} [starts {start_b:.4f}]"
        )


def test_render_band_is_grounded_at_base_and_fades_at_top():
    # T6580 item 4: a lower-third band, opaque at the base, feathered at the top,
    # empty above it.
    band = {"color": "#241a0b", "opacity": 0.9, "heightFrac": 0.44, "featherFrac": 0.16}
    im = np.asarray(P._render_band(band, 40, 100))
    assert im.shape == (100, 40, 4)
    top = 100 - round(0.44 * 100)          # band starts here
    assert im[0, 20, 3] == 0               # nothing above the band
    assert im[top, 20, 3] == 0             # transparent at the band's very top
    assert im[99, 20, 3] > 200             # ~opaque at the base
    # colour is the band colour where painted
    assert tuple(im[99, 20, :3]) == P._hex_to_rgb("#241a0b")


def test_render_vignette_dark_at_corners_clear_at_centre():
    v = {"opacity": 0.6, "innerFrac": 0.4, "extent": 0.72}
    im = np.asarray(P._render_vignette(v, 80, 80))
    assert im[40, 40, 3] == 0              # centre is clear
    assert im[0, 0, 3] > im[40, 40, 3]     # corner darker than centre
    assert (im[..., :3] == 0).all()        # vignette is black, only alpha varies


def test_render_tint_is_flat_colour_wash():
    im = np.asarray(P._render_tint({"color": "#5a3a12", "opacity": 0.25}, 10, 10))
    assert (im[..., :3] == P._hex_to_rgb("#5a3a12")).all()
    assert im[0, 0, 3] == round(0.25 * 255)
    assert P._render_tint(None, 10, 10) is None


def test_photo_forward_has_no_band_or_grade():
    from app.services.intro_card_geometry import treatment_for
    t = treatment_for("photo-forward")
    assert t["band"] is None
    assert t["photoMood"]["tint"] is None and t["photoMood"]["vignette"] is None


def test_scrim_kind_by_composition():
    assert P._scrim_kind("title-only", True) == "dim"
    assert P._scrim_kind("hero", True) == "bottom"
    assert P._scrim_kind("broadcast", True) == "bottom"
    assert P._scrim_kind("recruiting", True) == "none"
    assert P._scrim_kind("title-only", False) == "none"


# =============================================================================
# Non-fatal contract (no ffmpeg needed for these failures)
# =============================================================================
def test_build_is_nonfatal_on_bad_treatment(photo, tmp_path):
    out = tmp_path / "o.mp4"
    assert P.build_intro_card(_card(["position"], treatment="neon"), FIELDS, photo, _info("9:16"), str(out)) is False
    assert not out.exists()


def test_build_is_nonfatal_on_missing_image(tmp_path):
    out = tmp_path / "o.mp4"
    assert P.build_intro_card(_card(["position"]), FIELDS, "/no/such/image.png", _info("9:16"), str(out)) is False
    assert not out.exists()


# =============================================================================
# Real ffmpeg build + prepend (small frames, short duration)
# =============================================================================
def _has_ffmpeg() -> bool:
    from shutil import which
    return which("ffmpeg") is not None and which("ffprobe") is not None


requires_ffmpeg = pytest.mark.skipif(not _has_ffmpeg(), reason="ffmpeg/ffprobe not available")


def _last_frame_luma(mp4: str) -> float:
    p = str(Path(mp4).with_suffix(".last.png"))
    subprocess.run(["ffmpeg", "-y", "-sseof", "-0.04", "-i", mp4, "-frames:v", "1", p],
                   capture_output=True)
    return float(np.asarray(Image.open(p).convert("L")).mean())


@requires_ffmpeg
@pytest.mark.parametrize("comp,shown,aspect,audio", [
    ("title-only", [], "9:16", False),
    ("hero", ["position"], "9:16", True),
    ("broadcast", ["position", "class"], "16:9", False),
    ("recruiting", ["position", "class", "team"], "16:9", False),
])
def test_build_matrix_produces_valid_animated_card(photo, tmp_path, comp, shown, aspect, audio):
    out = tmp_path / f"{comp}.mp4"
    info = _info(aspect, audio=audio)
    ok = P.build_intro_card(_card(shown, "gold"), FIELDS, photo, info, str(out))
    assert ok and out.exists()
    pr = P._probe_media(str(out))
    assert (pr["width"], pr["height"]) == (info["width"], info["height"])
    assert abs(pr["duration"] - 1.0) < 0.35
    assert pr["has_audio"] == audio
    # exit flash: the final frame is near-white and deterministic
    assert _last_frame_luma(str(out)) > 180


@requires_ffmpeg
def test_cutout_builds(photo, cutout, tmp_path):
    out = tmp_path / "cut.mp4"
    assert P.build_intro_card(_card(["position"], "dark"), FIELDS, cutout, _info("9:16"), str(out))


@requires_ffmpeg
def test_cache_hit_and_invalidation(photo, tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    monkeypatch.setattr(P, "_CARD_CACHE_DIR", cache)
    info = _info("9:16")
    c1 = _card(["position"], "dark")
    o = tmp_path / "o.mp4"
    P.build_intro_card(c1, FIELDS, photo, info, str(o))
    n1 = len(list(cache.glob("*.mp4")))
    P.build_intro_card(c1, FIELDS, photo, info, str(o))                 # identical -> hit
    n2 = len(list(cache.glob("*.mp4")))
    P.build_intro_card(dict(c1, name="x"), FIELDS, photo, info, str(o))  # rename -> hit
    n3 = len(list(cache.glob("*.mp4")))
    # T6620: a DEAD title_text edit changes no pixels -> still a HIT.
    P.build_intro_card(dict(c1, title_text="Zzz"), FIELDS, photo, info, str(o))
    n4 = len(list(cache.glob("*.mp4")))
    # A real pixel edit (the rendered title text, via the profile full_name) -> miss.
    P.build_intro_card(c1, {**FIELDS, "full_name": "Zzz Player"}, photo, info, str(o))
    n5 = len(list(cache.glob("*.mp4")))
    assert (n1, n2, n3, n4, n5) == (1, 1, 1, 1, 2)


@requires_ffmpeg
def test_prepend_is_probe_matched_stream_copy(photo, tmp_path):
    reel = tmp_path / "reel.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=270x480:rate=30:duration=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
        "-video_track_timescale", "15360", str(reel),
    ], check=True, capture_output=True)
    info = P._probe_media(str(reel))
    card_mp4 = tmp_path / "card.mp4"
    assert P.build_intro_card(_card(["position"], "dark"), FIELDS, photo, info, str(card_mp4))
    out = tmp_path / "joined.mp4"
    assert P.prepend_intro_card(str(card_mp4), str(reel), str(out))
    pr = P._probe_media(str(out))
    assert pr["duration"] >= 1.0 + 1.0 * 0.6
    assert (pr["width"], pr["height"]) == (270, 480)
