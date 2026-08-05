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
"""

import json
import re
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


def test_stagger_order_parity(js_source):
    js_order = _extract_parity_block(js_source, "staggerOrder")
    assert js_order == list(g.STAGGER_ORDER)


def test_aspects_parity(js_source):
    js_aspects = _extract_parity_block(js_source, "aspects")
    assert js_aspects == {
        "portrait": g.ASPECT_PORTRAIT,
        "landscape": g.ASPECT_LANDSCAPE,
    }


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


def test_slot_rects_are_in_frame_and_well_formed():
    for comp in _ALL_COMPOSITIONS:
        for aspect in _ALL_ASPECTS:
            geo = g.geometry_for(comp, aspect)
            photo = geo["photo"]
            for k in ("x", "y", "w", "h"):
                assert 0.0 <= photo[k] <= 1.0, f"{comp}/{aspect} photo.{k} out of range"
            assert photo["x"] + photo["w"] <= 1.0 + 1e-9
            assert photo["y"] + photo["h"] <= 1.0 + 1e-9
            for slot_name, slot in geo["slots"].items():
                assert set(slot) == {"x", "y", "maxWidth", "size", "align"}, (
                    f"{comp}/{aspect}/{slot_name} has unexpected keys {set(slot)}"
                )
                assert 0.0 <= slot["x"] <= 1.0
                assert 0.0 <= slot["y"] <= 1.0
                assert 0.0 < slot["maxWidth"] <= 1.0
                # size shares TextSpec's ceiling (<= 0.5 of frame height).
                assert 0.0 < slot["size"] <= 0.5
                assert slot["align"] in (g.ALIGN_LEFT, g.ALIGN_CENTER)


def test_compositions_show_expected_fact_slot_counts():
    """title-only shows no facts; hero 1; broadcast 2; recruiting 3 — the whole
    point of deriving composition from fact count."""
    expected_facts = {
        COMPOSITION_TITLE_ONLY: 0,
        COMPOSITION_HERO: 1,
        COMPOSITION_BROADCAST: 2,
        COMPOSITION_RECRUITING: 3,
    }
    for comp, n in expected_facts.items():
        for aspect in _ALL_ASPECTS:
            slots = g.geometry_for(comp, aspect)["slots"]
            fact_slots = [s for s in slots if s.startswith("fact")]
            assert len(fact_slots) == n, f"{comp}/{aspect} expected {n} fact slots"


def test_aspect_key_buckets_portrait_landscape_square():
    assert g.aspect_key(1080, 1920) == g.ASPECT_PORTRAIT
    assert g.aspect_key(1920, 1080) == g.ASPECT_LANDSCAPE
    assert g.aspect_key(1000, 1000) == g.ASPECT_LANDSCAPE


def test_geometry_for_unknown_raises():
    with pytest.raises(KeyError):
        g.geometry_for("nope", g.ASPECT_PORTRAIT)
    with pytest.raises(KeyError):
        g.geometry_for(COMPOSITION_HERO, "1:1")
