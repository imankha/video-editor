"""T5210 — intro card geometry + motion timing contract parity.

The render engine (`player_intro.py`) and the browser editor/preview (T5205)
must place slots and animate with the SAME numbers, or the export won't match
the preview. Python (`intro_card_geometry.py`) is the source of truth; the JS
mirror (`src/frontend/src/utils/introCardGeometry.js`) is generated from it.

These tests are the drift alarm: they re-parse the JSON the JS mirror embeds
(no JS runtime needed — the generator wraps each data block in `@parity:*`
markers) and assert it byte-for-byte equals the Python contract. If someone edits
the Python numbers without regenerating the JS, or hand-edits the JS, this fails.
Same role as the T5180 `text_render`/`RichText` parity spec.

T6640 replaced the static per-slot `slots` dict with `reflow` (anchor + rhythm
gaps) + `typography` (role sizing), and added the shared `layout()` function
that MEASURES each element's wrapped line count and stacks the block against
the anchor — this is what guarantees a wrapped title can never collide with the
slot below it (see `intro_card_geometry`'s module docstring for the full
argument). This file also carries `layout()`'s own unit tests: the invariance
property (facts' y identical whether the title wraps to 1 or 2 lines), no
overlapping element intervals, and the block staying within [0,1].
"""

import json
import re
from itertools import pairwise
from pathlib import Path

import pytest

from app.services import intro_card_geometry as g
from app.services.intro_cards import (
    COMPOSITION_BROADCAST,
    COMPOSITION_HERO,
    COMPOSITION_RECRUITING,
    COMPOSITION_TITLE_ONLY,
    derive_composition,
)

_JS_PATH = (
    Path(__file__).resolve().parents[3]
    / "src" / "frontend" / "src" / "utils" / "introCardGeometry.js"
)

_ALL_COMPOSITIONS = (
    COMPOSITION_TITLE_ONLY,
    COMPOSITION_HERO,
    COMPOSITION_BROADCAST,
    COMPOSITION_RECRUITING,
)
_ALL_ASPECTS = (g.ASPECT_PORTRAIT, g.ASPECT_LANDSCAPE)


def _extract_parity_block(js: str, name: str) -> object:
    """Pull the JSON wrapped in `/* @parity:{name}:start */ ... :end */` markers
    out of the generated JS and parse it. The embedded blocks are pure JSON, so
    json.loads reads them directly."""
    m = re.search(
        rf"@parity:{re.escape(name)}:start \*/(.*?)/\* @parity:{re.escape(name)}:end",
        js,
        re.DOTALL,
    )
    assert m, f"parity block {name!r} not found in {_JS_PATH}"
    return json.loads(m.group(1))


@pytest.fixture(scope="module")
def js_source() -> str:
    assert _JS_PATH.exists(), (
        f"JS mirror missing at {_JS_PATH}; regenerate with "
        f"`python -m app.services.intro_card_geometry`"
    )
    return _JS_PATH.read_text(encoding="utf-8")


def test_js_mirror_matches_generator_output():
    """The committed JS file is exactly what the generator produces now — catches
    a hand-edit of either the JS or the Python without regeneration."""
    assert _JS_PATH.read_text(encoding="utf-8") == g.render_js_mirror(), (
        "introCardGeometry.js is stale; regenerate with "
        "`python -m app.services.intro_card_geometry`"
    )


def test_geometry_parity(js_source):
    js_geometry = _extract_parity_block(js_source, "geometry")
    # Round-trip the Python side through JSON so float/dict types match exactly.
    py_geometry = json.loads(json.dumps(g.GEOMETRY))
    assert js_geometry == py_geometry


def test_motion_parity(js_source):
    js_motion = _extract_parity_block(js_source, "motion")
    py_motion = json.loads(json.dumps(g.MOTION))
    assert js_motion == py_motion


def test_treatments_parity(js_source):
    js_treatments = _extract_parity_block(js_source, "treatments")
    py_treatments = json.loads(json.dumps(g.TREATMENTS_CONTRACT))
    assert js_treatments == py_treatments


def test_stagger_order_parity(js_source):
    js_order = _extract_parity_block(js_source, "staggerOrder")
    assert js_order == list(g.STAGGER_ORDER)


def test_aspects_parity(js_source):
    js_aspects = _extract_parity_block(js_source, "aspects")
    assert js_aspects == {
        "portrait": g.ASPECT_PORTRAIT,
        "landscape": g.ASPECT_LANDSCAPE,
    }


def test_band_compositions_parity(js_source):
    js_bands = _extract_parity_block(js_source, "bandCompositions")
    assert js_bands == list(g.BAND_COMPOSITIONS)


def test_role_for_slot_parity(js_source):
    js_role_for_slot = _extract_parity_block(js_source, "roleForSlot")
    assert js_role_for_slot == g.ROLE_FOR_SLOT


def test_muted_color_parity(js_source):
    js_muted = _extract_parity_block(js_source, "mutedColor")
    assert js_muted == g.MUTED_COLOR


# --- Shape / completeness: every derived composition has both aspects, every -----
# --- slot is well-formed and in-frame. Guards a value edit as much as parity. -----

def test_every_composition_defines_both_aspects():
    for comp in _ALL_COMPOSITIONS:
        assert comp in g.GEOMETRY, f"missing geometry for composition {comp!r}"
        for aspect in _ALL_ASPECTS:
            assert aspect in g.GEOMETRY[comp], f"{comp!r} missing aspect {aspect!r}"


def test_derive_composition_targets_all_have_geometry():
    """Every composition `derive_composition` can return must have geometry —
    the contract can't leave a reachable composition unlaid-out."""
    reachable = {
        derive_composition(False, []),
        derive_composition(True, []),
        derive_composition(True, ["position"]),
        derive_composition(True, ["position", "class"]),
        derive_composition(True, ["position", "class", "team"]),
    }
    assert reachable == set(_ALL_COMPOSITIONS)
    for comp in reachable:
        assert comp in g.GEOMETRY


def test_photo_rects_are_in_frame_and_well_formed():
    for comp in _ALL_COMPOSITIONS:
        for aspect in _ALL_ASPECTS:
            geo = g.geometry_for(comp, aspect)
            photo = geo["photo"]
            for k in ("x", "y", "w", "h"):
                assert 0.0 <= photo[k] <= 1.0, f"{comp}/{aspect} photo.{k} out of range"
            assert photo["x"] + photo["w"] <= 1.0 + 1e-9
            assert photo["y"] + photo["h"] <= 1.0 + 1e-9


def test_reflow_and_typography_are_well_formed():
    """T6640: every composition x aspect defines a complete `reflow` (anchor +
    rhythm) and `typography` (all 3 roles), regardless of fact density — the
    actual element COUNT/position is measured at render time, not baked into
    the contract (see `test_compositions_reachable_via_role_for_slot` for the
    density-independence this enables)."""
    for comp in _ALL_COMPOSITIONS:
        for aspect in _ALL_ASPECTS:
            geo = g.geometry_for(comp, aspect)
            reflow = geo["reflow"]
            assert 0.0 <= reflow["anchorX"] <= 1.0
            assert reflow["align"] in (g.ALIGN_LEFT, g.ALIGN_CENTER)
            assert 0.0 < reflow["maxWidth"] <= 1.0
            assert reflow["anchorMode"] in ("bottom", "center")
            assert 0.0 <= reflow["anchorFrac"] <= 1.0
            for k in ("gapAfterTitle", "gapGroup", "gapLine"):
                assert reflow[k] >= 0.0
            assert reflow["seamSide"] in ("none", "bottom", "right")
            assert reflow["seamFeather"] >= 0.0

            typo = geo["typography"]
            assert set(typo) == {g.ROLE_TITLE, g.ROLE_PRIMARY, g.ROLE_SECONDARY}
            for role, rt in typo.items():
                # size shares TextSpec's ceiling (<= 0.5 of frame height).
                assert 0.0 < rt["size"] <= 0.5, f"{comp}/{aspect}/{role} size out of range"
                assert rt["font"]
                assert set(rt["shadow"]) == {"blur", "color", "opacity"}
            # Only the title role shrink-fits (task §A) — primary/secondary are
            # fixed-size (no maxLines/minSize).
            assert "minSize" in typo[g.ROLE_TITLE] and "maxLines" in typo[g.ROLE_TITLE]
            assert "minSize" not in typo[g.ROLE_PRIMARY]
            assert "minSize" not in typo[g.ROLE_SECONDARY]


def test_role_for_slot_covers_every_ordinal_slot():
    """T6640: every ordinal SLOT (title/subtitle/fact1..3) resolves to exactly
    one of the 3 typography roles, regardless of composition — this is what
    lets `layout()` place ANY combination of shown facts without a per-
    composition slot-existence check (the OLD contract's failure mode:
    `geo["slots"]` only had `fact{N}` keys up to the composition's own fact
    count, which could go stale relative to `derive_composition`)."""
    assert set(g.ROLE_FOR_SLOT) == {
        g.SLOT_TITLE, g.SLOT_SUBTITLE, g.SLOT_FACT1, g.SLOT_FACT2, g.SLOT_FACT3,
    }
    assert g.ROLE_FOR_SLOT[g.SLOT_TITLE] == g.ROLE_TITLE
    assert g.ROLE_FOR_SLOT[g.SLOT_FACT1] == g.ROLE_PRIMARY
    # subtitle groups with the secondary facts (supervisor decision, T6640).
    assert g.ROLE_FOR_SLOT[g.SLOT_SUBTITLE] == g.ROLE_SECONDARY
    assert g.ROLE_FOR_SLOT[g.SLOT_FACT2] == g.ROLE_SECONDARY
    assert g.ROLE_FOR_SLOT[g.SLOT_FACT3] == g.ROLE_SECONDARY


def test_stagger_order_includes_subtitle_after_title():
    # T6570: subtitle staggers between the title and the facts.
    assert g.STAGGER_ORDER == ("title", "subtitle", "fact1", "fact2", "fact3")


def _is_hex(c):
    return isinstance(c, str) and c.startswith("#") and len(c) == 7


def test_treatment_palette_covers_all_treatments():
    from app.services.intro_cards import TREATMENTS

    assert set(g.TREATMENTS_CONTRACT) == set(TREATMENTS)
    for name, t in g.TREATMENTS_CONTRACT.items():
        # T6580 item 4: each treatment owns background + accent + band + photoMood.
        # T6640 adds seamColor (the flat colour an inset photo's edge fades to).
        assert set(t) == {"background", "accent", "band", "photoMood", "seamColor"}, (
            f"{name} unexpected keys"
        )
        assert _is_hex(t["accent"])
        assert _is_hex(t["seamColor"])
        bg = t["background"]
        if bg["type"] == "solid":
            assert _is_hex(bg["color"])
        elif bg["type"] == "radial":
            # endpoints preserved (not flattened to one colour), centre + extent present.
            assert len(bg["stops"]) >= 2
            assert len(bg["center"]) == 2 and len(bg["extent"]) == 2
            for stop in bg["stops"]:
                assert _is_hex(stop["color"]) and 0.0 <= stop["pos"] <= 1.0
        else:
            raise AssertionError(f"{name} unknown background type {bg['type']!r}")

        # band: a solid lower-third ground, or None (photo-forward).
        band = t["band"]
        if band is not None:
            assert _is_hex(band["color"])
            assert 0.0 <= band["opacity"] <= 1.0
            assert 0.0 < band["heightFrac"] <= 1.0   # EXPLICIT height (user ask)
            assert 0.0 <= band["featherFrac"] <= 1.0

        # photoMood: tint (colour wash) + vignette, each present as a dict or None.
        mood = t["photoMood"]
        assert set(mood) == {"tint", "vignette"}, f"{name} photoMood keys"
        if mood["tint"] is not None:
            assert _is_hex(mood["tint"]["color"]) and 0.0 <= mood["tint"]["opacity"] <= 1.0
        if mood["vignette"] is not None:
            assert 0.0 <= mood["vignette"]["opacity"] <= 1.0
            assert 0.0 <= mood["vignette"]["innerFrac"] <= 1.0
            assert 0.0 < mood["vignette"]["extent"] <= 2.0


def test_band_applies_to_lower_third_photo_compositions_only():
    from app.services.intro_cards import (
        COMPOSITION_BROADCAST,
        COMPOSITION_HERO,
        COMPOSITION_RECRUITING,
        COMPOSITION_TITLE_ONLY,
    )
    assert g.band_kind(COMPOSITION_HERO) == "bottom"
    assert g.band_kind(COMPOSITION_BROADCAST) == "bottom"
    assert g.band_kind(COMPOSITION_TITLE_ONLY) == "none"
    assert g.band_kind(COMPOSITION_RECRUITING) == "none"
    # photo-forward carries no band (photo dominates), so it never grounds text.
    assert g.TREATMENTS_CONTRACT["photo-forward"]["band"] is None
    # gold + dark do.
    assert g.TREATMENTS_CONTRACT["gold"]["band"] is not None
    assert g.TREATMENTS_CONTRACT["dark"]["band"] is not None


def test_treatment_for_unknown_raises():
    with pytest.raises(KeyError):
        g.treatment_for("neon")


def test_aspect_key_buckets_portrait_landscape_square():
    assert g.aspect_key(1080, 1920) == g.ASPECT_PORTRAIT
    assert g.aspect_key(1920, 1080) == g.ASPECT_LANDSCAPE
    assert g.aspect_key(1000, 1000) == g.ASPECT_LANDSCAPE


def test_geometry_for_unknown_raises():
    with pytest.raises(KeyError):
        g.geometry_for("nope", g.ASPECT_PORTRAIT)
    with pytest.raises(KeyError):
        g.geometry_for(COMPOSITION_HERO, "1:1")


# =============================================================================
# T6640 — layout() unit tests. These are the collision-safety guarantee itself,
# not just contract shape: they prove the MEASURED, ANCHORED stack a wrapped
# title produces can never collide with the elements below it, independent of
# the JS mirror / parity mechanism above (which only proves the two runtimes
# read the SAME NUMBERS — these tests prove the numbers are safe to begin with).
# =============================================================================
_SHORT_NAME = "Maya"
_LONG_NAME = "Anastasia Wintergreen"  # invented, two words -> wraps (no PII)
_FRAME_SIZES = {g.ASPECT_PORTRAIT: (1080, 1920), g.ASPECT_LANDSCAPE: (1920, 1080)}


def _recruiting_elements(title: str) -> list[tuple[str, str]]:
    # Full stack (title + all 3 facts) -- the densest, most collision-prone case
    # and the one the reported bug was filed against.
    return [
        (g.SLOT_TITLE, title),
        (g.SLOT_FACT1, "Midfielder"),
        (g.SLOT_FACT2, "2027"),
        (g.SLOT_FACT3, "West Coast Elite ECNL"),
    ]


@pytest.mark.parametrize("aspect", [g.ASPECT_PORTRAIT, g.ASPECT_LANDSCAPE])
def test_layout_invariance_facts_never_move_when_title_wraps(aspect):
    """The acceptance criterion, as a direct assertion: a long two-word name
    NEVER collides with any slot below it. Bottom-anchored compositions hold
    this EXACTLY (facts' y bit-for-bit unchanged); centre-anchored recruiting/
    16:9 does not hold y exactly (nothing is anchored below the block there),
    but must still hold NO OVERLAP (asserted by the next test)."""
    accent = "#f7e28b"
    short_pos = g.layout("recruiting", aspect, _recruiting_elements(_SHORT_NAME), accent, *_FRAME_SIZES[aspect])
    long_pos = g.layout("recruiting", aspect, _recruiting_elements(_LONG_NAME), accent, *_FRAME_SIZES[aspect])

    reflow = g.geometry_for("recruiting", aspect)["reflow"]
    if reflow["anchorMode"] == "bottom":
        for slot in (g.SLOT_FACT1, g.SLOT_FACT2, g.SLOT_FACT3):
            assert short_pos[slot]["y"] == pytest.approx(long_pos[slot]["y"], abs=1e-9), (
                f"{aspect}/{slot}: facts moved when the title wrapped (bottom anchor invariance broken)"
            )
    # The title itself DOES move (grows upward into empty space) whenever it wraps.
    assert short_pos[g.SLOT_TITLE]["y"] != pytest.approx(long_pos[g.SLOT_TITLE]["y"], abs=1e-6) or (
        short_pos[g.SLOT_TITLE]["size"] != long_pos[g.SLOT_TITLE]["size"]
    )


@pytest.mark.parametrize("comp", _ALL_COMPOSITIONS)
@pytest.mark.parametrize("aspect", [g.ASPECT_PORTRAIT, g.ASPECT_LANDSCAPE])
@pytest.mark.parametrize("name", [_SHORT_NAME, _LONG_NAME])
def test_layout_never_overlaps_and_stays_in_frame(comp, aspect, name):
    """No two elements' [y, y+height] intervals overlap, and the whole block
    stays within [0, 1] — across EVERY composition x aspect x {short, long}
    name (the full acceptance-criterion matrix), not just recruiting."""
    accent = "#f7e28b"
    frame_w, frame_h = _FRAME_SIZES[aspect]
    elements = [(g.SLOT_TITLE, name)]
    fact_values = ["Midfielder", "2027", "West Coast Elite ECNL"]
    n_facts = {COMPOSITION_TITLE_ONLY: 0, COMPOSITION_HERO: 1, COMPOSITION_BROADCAST: 2, COMPOSITION_RECRUITING: 3}[comp]
    for i in range(n_facts):
        elements.append((f"fact{i + 1}", fact_values[i]))

    positions = g.layout(comp, aspect, elements, accent, frame_w, frame_h)
    intervals = []
    for slot, text in elements:
        pos = positions[slot]
        lines = g._count_lines(text, pos["size"], pos["font"], frame_w, frame_h, pos["maxWidth"])
        advance = g._advance_frac(pos["size"], pos["font"], frame_h)
        y0, y1 = pos["y"], pos["y"] + lines * advance
        assert y0 >= -1e-6 and y1 <= 1.0 + 1e-6, f"{comp}/{aspect}/{name}/{slot}: [{y0},{y1}] escapes [0,1]"
        intervals.append((slot, y0, y1))

    intervals.sort(key=lambda t: t[1])
    for (slot_a, _, end_a), (slot_b, start_b, _) in pairwise(intervals):
        assert start_b >= end_a - 1e-6, (
            f"{comp}/{aspect}/{name}: {slot_a} [ends {end_a:.4f}] overlaps {slot_b} [starts {start_b:.4f}]"
        )
