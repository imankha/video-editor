"""
T5180 rich text engine — font manifest loader.

The SINGLE reader of `app/assets/fonts/fonts.json` (design §4). Both
`text_render.py` (resolves TTF paths for Pillow rendering) and the
`/api/fonts` StaticFiles mount (serves the same manifest + TTFs to the
browser for @font-face) go through this module — no second parse.

The render container has no fontconfig (same constraint as
`branded_outro.py`), so fonts are always resolved by an ABSOLUTE filesystem
path, never a fontconfig family name.
"""

import functools
import json
from pathlib import Path

from PIL import ImageFont

FONT_ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
_MANIFEST_PATH = FONT_ASSETS_DIR / "fonts.json"


@functools.lru_cache(maxsize=1)
def load_manifest() -> dict:
    """Load + parse fonts.json once per process (the manifest is a static
    repo asset, not something that changes at runtime)."""
    with open(_MANIFEST_PATH, encoding="utf-8") as f:
        return json.load(f)


def resolve_font_path(key: str) -> Path:
    """Resolve a FontKey value to its absolute TTF path on disk.

    `key` is already validated at the Pydantic boundary (FontKey enum) by the
    time it reaches this function — an unknown key here means the manifest
    and the enum have drifted, which is a loud bug, not a fallback case.
    """
    manifest = load_manifest()
    entry = manifest.get(key)
    if entry is None:
        raise KeyError(
            f"Font key {key!r} is not present in fonts.json — manifest and "
            f"FontKey enum have drifted out of sync"
        )
    path = FONT_ASSETS_DIR / entry["file"]
    if not path.exists():
        raise FileNotFoundError(f"Font file for key {key!r} missing on disk: {path}")
    return path


def load_font_for_render(key: str, px: int) -> ImageFont.FreeTypeFont:
    """Load `key` at pixel size `px`, pinning the manifest's declared weight on
    a variable-axis face (design/T5180 supervisor decision: Oswald + Playfair
    ship as `wght`-axis variable TTFs upstream — there is no static instance to
    pick instead). `fonts.json`'s `weight` field is the single source of truth
    for the pinned instance on BOTH sides; the frontend mirrors this via
    `font-weight` on the same manifest field (RichText.jsx). A non-variable
    face is loaded as-is — its `weight` is metadata only, already baked into
    the file."""
    manifest = load_manifest()
    entry = manifest.get(key)
    if entry is None:
        raise KeyError(
            f"Font key {key!r} is not present in fonts.json — manifest and "
            f"FontKey enum have drifted out of sync"
        )
    path = resolve_font_path(key)
    font = ImageFont.truetype(str(path), px)
    if entry.get("isVariable"):
        # Both current variable faces (oswald, playfair) expose a single
        # `wght` axis — pin it to the manifest weight. A face with more axes
        # would need a fuller mapping (set_variation_by_axes takes one value
        # PER axis, in font-table order — a single-element list would only pin
        # the first axis and silently leave the rest at their defaults). T6500's
        # Inter is multi-axis upstream (opsz + wght), so it ships PRE-INSTANCED
        # to a single static (wght=500, opsz=14) via fontTools rather than as a
        # variable TTF — it never reaches this branch, keeping this catalogue's
        # only variable faces single-axis. Add a multi-axis mapping here (not
        # another static) only if a genuinely user-variable face is ever added.
        font.set_variation_by_axes([entry["weight"]])
    return font
