"""T5210 — player intro card render engine.

Fast pure-function tests (element selection, spec merge, framing, cache hash) +
a few real-ffmpeg build/prepend tests (small frames, short duration) that assert
the engine produces a valid animated MP4 with the flash exit, mirroring the
T5240 luma-evidence approach.
"""

import subprocess
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


def test_select_elements_reads_title_text_not_text_elements_text():
    # SEAM 1: text_elements is styling only; its .text ('WRONG') must be ignored.
    card = _card(["position"], text_elements={
        "title": {"text": "WRONG", "font": "graduate", "color": "#ff0000",
                  "size": 0.1, "position": {"x": 0.5, "y": 0.5}, "maxWidth": 0.8},
    }, title_text="RIGHT")
    from app.services.intro_card_geometry import geometry_for
    geo = geometry_for("hero", "9:16")
    els = P._select_elements(card, FIELDS, geo, "#ffffff")
    title = next(e for e in els if e["slot"] == "title")
    assert title["spec"].text == "RIGHT"                 # from title_text
    assert title["spec"].font.value == "graduate"        # styling from text_elements
    assert title["spec"].color == "#ff0000"
    # layout WINS over any stored position/size on the styling spec
    assert title["spec"].position.x == geo["slots"]["title"]["x"]
    assert title["spec"].size == geo["slots"]["title"]["size"]


def test_select_elements_title_from_profile_full_name():
    # T6570: with no legacy title_text, the title text is the PROFILE's full name,
    # passed in via field_values["full_name"] (mirrors the browser preview).
    card = _card(["position"], title_text=None)
    fields = {**FIELDS, "full_name": "Jordan Vega"}
    from app.services.intro_card_geometry import geometry_for
    geo = geometry_for("hero", "9:16")
    els = P._select_elements(card, fields, geo, "#ffffff")
    title = next(e for e in els if e["slot"] == "title")
    assert title["spec"].text == "Jordan Vega"


def test_select_elements_legacy_title_text_grandfathers_over_full_name():
    # A pre-T6570 card that stored a title_text keeps rendering it (override),
    # even when the profile now has a full name.
    card = _card(["position"], title_text="Legacy Name")
    fields = {**FIELDS, "full_name": "Jordan Vega"}
    from app.services.intro_card_geometry import geometry_for
    geo = geometry_for("hero", "9:16")
    els = P._select_elements(card, fields, geo, "#ffffff")
    title = next(e for e in els if e["slot"] == "title")
    assert title["spec"].text == "Legacy Name"


def test_select_elements_renders_card_subtitle_when_present():
    # T6570: subtitle is FREE TEXT on the card; it renders at the subtitle slot,
    # between title and facts, and is orthogonal to composition.
    card = _card(["position"], title_text=None, subtitle_text="State Cup 2027")
    fields = {**FIELDS, "full_name": "Jordan Vega"}
    from app.services.intro_card_geometry import geometry_for
    geo = geometry_for("hero", "9:16")
    els = P._select_elements(card, fields, geo, "#ffffff")
    sub = next(e for e in els if e["slot"] == "subtitle")
    assert sub["spec"].text == "State Cup 2027"
    # position taken from the composition's subtitle slot (layout owns it)
    assert sub["spec"].position.y == geo["slots"]["subtitle"]["y"]
    # order: title, subtitle, then the fact
    assert [e["slot"] for e in els] == ["title", "subtitle", "fact1"]


def test_select_elements_omits_blank_subtitle(caplog):
    import logging
    caplog.set_level(logging.INFO)
    card = _card(["position"], title_text="T", subtitle_text="   ")
    from app.services.intro_card_geometry import geometry_for
    geo = geometry_for("hero", "9:16")
    els = P._select_elements(card, FIELDS, geo, "#ffffff")
    assert not any(e["slot"] == "subtitle" for e in els)
    assert "subtitle omitted" in caplog.text


def test_select_elements_maps_ordinal_geometry_to_semantic_styling():
    # SEAM 2: fact{i} geometry <- shown_fields[i]; styling keyed by the FIELD name.
    card = _card(["position", "class"], text_elements={
        "class": {"text": "", "font": "playfair", "color": "#00ff00",
                  "size": 0.05, "position": {"x": 0.5, "y": 0.5}, "maxWidth": 0.8},
    })
    from app.services.intro_card_geometry import geometry_for
    geo = geometry_for("broadcast", "9:16")
    els = P._select_elements(card, FIELDS, geo, "#ffffff")
    by_slot = {e["slot"]: e["spec"] for e in els}
    assert by_slot["fact1"].text == "Point Guard"        # shown_fields[0]=position
    assert by_slot["fact2"].text == "2027"               # shown_fields[1]=class
    # the class styling (semantic key) landed on fact2 (ordinal slot)
    assert by_slot["fact2"].font.value == "playfair"
    assert by_slot["fact2"].color == "#00ff00"
    # position styled fact1 defaulted (no text_elements['position'])
    assert by_slot["fact1"].font.value == P._DEFAULT_FACT_FONT


def test_select_elements_omits_blank_fact_and_blank_title(caplog):
    import logging
    caplog.set_level(logging.INFO)
    card = _card(["position", "class", "team"], title_text="")
    partial = {"position": "Point Guard", "class": "2027"}  # team missing
    from app.services.intro_card_geometry import geometry_for
    geo = geometry_for("recruiting", "9:16")
    els = P._select_elements(card, partial, geo, "#ffffff")
    slots = {e["slot"] for e in els}
    assert slots == {"fact1", "fact2"}          # no title (blank), no fact3 (team unset)
    assert "title omitted" in caplog.text
    assert "team" in caplog.text and "omitted" in caplog.text


def test_content_hash_changes_on_pixel_edit_stable_on_rename(photo):
    from app.services.intro_card_geometry import geometry_for
    geo = geometry_for("hero", "9:16")
    info = _info("9:16")
    c1 = _card(["position"])
    els1 = P._select_elements(c1, FIELDS, geo, "#ffffff")
    h1 = P._content_hash(c1, FIELDS, photo, info, "hero", "9:16", els1)

    c_rename = dict(c1, name="totally different name")
    els_r = P._select_elements(c_rename, FIELDS, geo, "#ffffff")
    assert P._content_hash(c_rename, FIELDS, photo, info, "hero", "9:16", els_r) == h1

    c_edit = dict(c1, title_text="New Title")
    els_e = P._select_elements(c_edit, FIELDS, geo, "#ffffff")
    assert P._content_hash(c_edit, FIELDS, photo, info, "hero", "9:16", els_e) != h1


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
    P.build_intro_card(dict(c1, title_text="Zzz"), FIELDS, photo, info, str(o))  # edit -> miss
    n4 = len(list(cache.glob("*.mp4")))
    assert (n1, n2, n3, n4) == (1, 1, 1, 2)


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
