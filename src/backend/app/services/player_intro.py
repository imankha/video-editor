"""Animated player intro card renderer (T5210).

Turns an `intro_cards` row into a short ANIMATED MP4 that can be PREPENDED to a
reel of any resolution / fps / pixel format, cheaply enough to run on a download
request. Mirrors `branded_outro.py`'s shape exactly (probe -> build-once-and-cache
-> concat -> validate -> non-fatal), just in the prepend direction and with a
richer, data-driven card.

What makes this different from the outro:
  - The card is DATA: composition is derived from the card (epic decision 2),
    treatment is an independent axis (2b), text is the user's, framing is a stored
    focal point (3b). Geometry + motion + treatment come from the shared contract
    `intro_card_geometry` so the export matches the T5205 browser preview.
  - Text is a PRE-RENDERED RGBA PNG per element via `text_render.render_text_layer`
    (T5180). ffmpeg composites and animates the PNGs; it NEVER draws a glyph
    (epic decision 5). This is what makes the export match the preview.
  - Motion is the deliverable, not a nicety (epic decision 10): a photo Ken Burns
    push-in, staggered text fade-up, and a white-flash exit into the footage,
    sharing T5240's animated vocabulary.

Contract (task §D):
  - PURE function of (card row, resolved profile field values, local image, probe)
    -> file. NO DB reads, NO R2, NO job rows. T5220 owns fetching the card,
    resolving the profile facts + effective focal, downloading the R2 image
    (cutout if present), and wiring this into every egress.
  - NON-FATAL, ALWAYS (epic decision 9): every failure returns False/None and logs
    loudly; it never raises into a download, share or export.

Text sourcing (seam-critical — see intro_card_geometry's mapping note):
  - `text_elements` is STYLING ONLY. NEVER read its `.text` (always '').
  - title text  = profile full name, passed in as field_values["full_name"],
    ALWAYS (T6620). card["title_text"] is DEAD — no longer read (was a
    pre-T6570 grandfathered override; nulled by migration v036).
    styling = text_elements["title"].
  - fact{i} geometry (ORDINAL) <- shown_fields[i] (SEMANTIC): text =
    field_values[field] (omit+log if blank), styling = text_elements[field].
"""

import hashlib
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from app.schemas import TextSpec
from app.services.intro_card_geometry import MOTION, STAGGER_ORDER, aspect_key, band_kind, geometry_for, treatment_for
from app.services.intro_card_geometry import layout as compute_layout
from app.services.intro_cards import derive_composition
from app.services.text_render import render_text_layer

logger = logging.getLogger(__name__)

# One card per (content hash x probe params); built once per unique key and reused
# across download requests. System temp dir (survives in-process, cheap to rebuild
# on a cold start), atomic-renamed so concurrent callers never read a partial file.
_CARD_CACHE_DIR: Path = Path(tempfile.gettempdir()) / "rb_intro_cards"

# Bump whenever the RENDERER (filtergraph, defaults, motion wiring) changes so
# stale cached cards from an old build rebuild. Distinct from the card's content
# hash, which changes when the user edits the card.
# T6640: template-owned typography + measured layout replaced per-slot styling
# (text_elements is no longer read) -- every existing cache entry is stale.
_CARD_VERSION = "v3-template-typography"


# =============================================================================
# ffmpeg helpers — copied from branded_outro (2nd use; extract a shared module on
# the 3rd, per the "abstract on the third duplication" rule + T5210 gate Q4).
# =============================================================================
def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=True)


def _escape_filter_path(path: str) -> str:
    """Escape a filesystem path for use inside an ffmpeg filtergraph value (a
    colon separates filter options, so a Windows drive letter breaks parsing).
    No-op on POSIX paths."""
    return path.replace("\\", "/").replace(":", "\\:")


def _probe_media(path: str) -> dict:
    """Probe the video+audio stream params we must match for a clean concat.
    Raises on a failed probe (we must not guess dimensions for a concat)."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries",
        "stream=index,codec_type,codec_name,width,height,r_frame_rate,"
        "avg_frame_rate,pix_fmt,sample_aspect_ratio,time_base,sample_rate,channels",
        "-show_entries", "format=duration",
        "-of", "json", path,
    ]
    data = json.loads(_run(cmd).stdout)
    streams = data.get("streams", [])
    vstream = next((s for s in streams if s.get("codec_type") == "video"), None)
    astream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not vstream:
        raise RuntimeError(f"no video stream in {path}")

    fps_str = vstream.get("avg_frame_rate") or vstream.get("r_frame_rate") or "30/1"
    if fps_str in ("0/0", "0/1", "N/A", None):
        fps_str = vstream.get("r_frame_rate") or "30/1"

    sar = vstream.get("sample_aspect_ratio") or "1:1"
    if sar in ("0:1", "N/A", None):
        sar = "1:1"

    time_base = vstream.get("time_base") or "1/15360"
    try:
        timescale = int(time_base.split("/")[1])
    except (ValueError, IndexError):
        timescale = 15360

    return {
        "width": int(vstream["width"]),
        "height": int(vstream["height"]),
        "fps_str": fps_str,
        "pix_fmt": vstream.get("pix_fmt") or "yuv420p",
        "sar": sar.replace(":", "/"),
        "timescale": timescale,
        "duration": float(data.get("format", {}).get("duration") or 0.0),
        "has_audio": astream is not None,
        "a_codec": (astream or {}).get("codec_name") or "aac",
        "a_rate": int((astream or {}).get("sample_rate") or 48000),
        "a_channels": int((astream or {}).get("channels") or 2),
    }


def _concat_copy(card_path: str, main_path: str, out_path: str) -> None:
    """Fast PREPEND: concat demuxer, stream copy (only the card was encoded). The
    card comes FIRST in the list — the intro plays before the reel."""
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        list_path = f.name
        for p in (card_path, main_path):
            f.write(f"file '{os.path.abspath(p)}'\n")
    try:
        _run([
            "ffmpeg", "-y",
            "-fflags", "+genpts",
            "-f", "concat", "-safe", "0", "-i", list_path,
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            "-movflags", "+faststart",
            out_path,
        ])
    finally:
        try:
            os.remove(list_path)
        except OSError:
            pass


def _concat_reencode(card_path: str, main_path: str, out_path: str, has_audio: bool) -> None:
    """Robust PREPEND fallback: re-encode concat (card first), used only when the
    stream-copy join fails validation."""
    if has_audio:
        fc = "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]"
        maps = ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "128k"]
    else:
        fc = "[0:v][1:v]concat=n=2:v=1:a=0[v]"
        maps = ["-map", "[v]", "-an"]
    _run([
        "ffmpeg", "-y",
        "-i", card_path, "-i", main_path,
        "-filter_complex", fc, *maps,
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        out_path,
    ])


def _validate_concat(out_path: str, expected_min: float) -> bool:
    """Sanity-check the joined file: probes cleanly and is at least expected length."""
    try:
        info = _probe_media(out_path)
        return info["duration"] >= expected_min
    except Exception as e:
        logger.warning(f"[PlayerIntro] concat validation probe failed: {e}")
        return False


# =============================================================================
# Pixel helpers (background / scrim / photo framing) — Pillow, exact + testable.
# =============================================================================
def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _render_background(bg: dict, w: int, h: int) -> Image.Image:
    """Paint the treatment background to an RGB image. `solid` -> a flat fill;
    `radial` -> the same radial gradient the editor's CSS produces, computed
    per-pixel so both sides match (contract §Treatment palette). Endpoints are
    interpolated, never flattened to one colour."""
    if bg["type"] == "solid":
        return Image.new("RGB", (w, h), _hex_to_rgb(bg["color"]))

    # Radial: normalised distance from `center`, scaled by `extent` (the CSS
    # ending-shape radius). t = clip(d / lastStopPos, 0, 1), stops lerped by t.
    cx, cy = bg["center"]
    ex, ey = bg["extent"]
    stops = bg["stops"]
    xs = np.arange(w, dtype=np.float64)
    ys = np.arange(h, dtype=np.float64)
    dx = (xs[None, :] - cx * w) / (ex * w)
    dy = (ys[:, None] - cy * h) / (ey * h)
    d = np.sqrt(dx * dx + dy * dy)  # 0 at centre, 1 at the extent ellipse edge

    positions = [s["pos"] for s in stops]
    colors = [np.array(_hex_to_rgb(s["color"]), dtype=np.float64) for s in stops]
    out = np.empty((h, w, 3), dtype=np.float64)
    # Before the first stop / after the last: clamp to the end colours.
    out[:] = colors[0]
    out[d >= positions[-1]] = colors[-1]
    for i in range(len(stops) - 1):
        p0, p1 = positions[i], positions[i + 1]
        if p1 <= p0:
            continue
        seg = (d >= p0) & (d < p1)
        frac = ((d[seg] - p0) / (p1 - p0))[:, None]
        out[seg] = colors[i] * (1 - frac) + colors[i + 1] * frac
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def _render_scrim(kind: str, w: int, h: int) -> Image.Image | None:
    """A dark RGBA overlay that keeps text legible over a photo. `bottom` = a
    transparent-to-dark vertical gradient under a lower-third stack; `dim` = a
    uniform wash under centred text. None = no scrim."""
    if kind == "dim":
        scrim = Image.new("RGBA", (w, h), (0, 0, 0, 90))
        return scrim
    if kind == "bottom":
        alpha = np.zeros((h, w), dtype=np.float64)
        ys = np.arange(h, dtype=np.float64) / max(h - 1, 1)
        # Transparent above 45% height, ramping to ~78% black at the very bottom.
        ramp = np.clip((ys - 0.45) / 0.55, 0, 1) ** 1.4 * 200.0
        alpha[:] = ramp[:, None]
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., 3] = alpha.astype(np.uint8)
        return Image.fromarray(rgba, "RGBA")
    return None


# --- Treatment photo grade + band (T6580 item 4) — parity with introCardVisual.js -
def _render_tint(tint: dict | None, w: int, h: int) -> Image.Image | None:
    """A flat normal-alpha colour wash over the photo (the treatment's grade).
    Matches the CSS `rgba(color, opacity)` overlay the preview paints."""
    if not tint:
        return None
    r, g, b = _hex_to_rgb(tint["color"])
    return Image.new("RGBA", (w, h), (r, g, b, round(float(tint["opacity"]) * 255)))


def _render_vignette(v: dict | None, w: int, h: int) -> Image.Image | None:
    """Radial edge-darkening: transparent within `innerFrac` of the ellipse,
    ramping to `opacity` black at its edge. Same normalised radial distance the
    CSS radial-gradient uses (`extent` = the ellipse radius fraction), so the
    browser preview and this render match."""
    if not v:
        return None
    opacity = float(v["opacity"])
    inner = float(v["innerFrac"])
    extent = float(v["extent"])
    xs = np.arange(w, dtype=np.float64)
    ys = np.arange(h, dtype=np.float64)
    nx = (xs[None, :] - 0.5 * w) / (extent * w)
    ny = (ys[:, None] - 0.5 * h) / (extent * h)
    d = np.sqrt(nx * nx + ny * ny)  # 0 at centre, 1 at the ellipse edge
    t = np.clip((d - inner) / max(1.0 - inner, 1e-6), 0.0, 1.0)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 3] = np.clip(opacity * 255.0 * t, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def _render_seam_fade(
    rect: dict, side: str, frac: float, target_hex: str, w: int, h: int,
) -> Image.Image | None:
    """T6640 (task §C "hard 50/50 seam"): a static RGBA overlay, sized to the
    PHOTO RECT, that fades from transparent to `target_hex` (the treatment's own
    background colour) at one edge — an inset photo (recruiting) then reads as
    bleeding into the panel instead of a hard cut. A FLAT target colour (not a
    per-pixel sample of the painted background) is deliberate: the browser
    preview mirrors this with one CSS `linear-gradient(transparent, seamColor)`
    (`introCardVisual.seamFadeCss`) — using the identical flat colour on both
    sides is what keeps preview and export pixel-equivalent at the seam, which a
    per-pixel Python-side gradient sample could not guarantee. `side`: 'right'
    (recruiting/16:9, panel to the right of the photo) | 'bottom'
    (recruiting/9:16, panel below) | 'none' (no seam -> None, no-op)."""
    if side == "none" or frac <= 0:
        return None
    rw, rh = max(round(rect["w"] * w), 1), max(round(rect["h"] * h), 1)
    r, g, b = _hex_to_rgb(target_hex)
    rgba = np.zeros((rh, rw, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = r, g, b
    if side == "right":
        fade_w = max(int(rw * frac), 1)
        ramp = np.zeros(rw, dtype=np.float64)
        ramp[rw - fade_w:] = np.linspace(0.0, 255.0, fade_w)
        rgba[..., 3] = ramp[None, :].astype(np.uint8)
    else:  # "bottom"
        fade_h = max(int(rh * frac), 1)
        ramp = np.zeros(rh, dtype=np.float64)
        ramp[rh - fade_h:] = np.linspace(0.0, 255.0, fade_h)
        rgba[..., 3] = ramp[:, None].astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def _render_band(band: dict | None, w: int, h: int) -> Image.Image | None:
    """A solid lower-third ground behind the text: `heightFrac` of the frame tall,
    filled at `opacity`, with the top `featherFrac` of the band fading in (no hard
    edge). Matches the CSS `linear-gradient(to top, ...)` the preview paints."""
    if not band:
        return None
    r, g, b = _hex_to_rgb(band["color"])
    opacity = float(band["opacity"])
    band_h = max(round(float(band["heightFrac"]) * h), 1)
    feather = float(band["featherFrac"])
    top = h - band_h
    ys = np.arange(h, dtype=np.float64)
    p = np.clip((ys - top) / band_h, 0.0, 1.0)  # 0 at band top, 1 at the base
    ramp = np.clip(p / max(feather, 1e-6), 0.0, 1.0)
    ramp[ys < top] = 0.0
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = r, g, b
    rgba[..., 3] = (opacity * 255.0 * ramp).astype(np.uint8)[:, None]
    return Image.fromarray(rgba, "RGBA")


def _frame_photo(
    image_path: str, rw: int, rh: int, focal_x: float, focal_y: float, zoom: float
) -> Image.Image:
    """Cover-crop the photo into an `rw x rh` frame from the stored focal point +
    zoom (epic decision 3b). Scales to COVER the rect at `zoom`, then crops around
    the focal point — so ONE stored framing works at any output aspect. Preserves
    an alpha channel (a T5200 cut-out overlays with transparency; the treatment
    background shows around the player)."""
    img = Image.open(image_path)
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    img = img.convert("RGBA" if has_alpha else "RGB")
    iw, ih = img.size
    scale = max(rw / iw, rh / ih) * max(zoom, 1.0)
    nw, nh = max(rw, round(iw * scale)), max(rh, round(ih * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    # Focal pixel in the scaled image, then a crop box clamped inside it.
    fx, fy = focal_x * nw, focal_y * nh
    left = round(min(max(fx - rw / 2, 0), nw - rw))
    top = round(min(max(fy - rh / 2, 0), nh - rh))
    return img.crop((left, top, left + rw, top + rh))


# =============================================================================
# Card assembly (element selection + spec merge)
# =============================================================================
def _even(n: int) -> int:
    return n if n % 2 == 0 else n + 1


def _select_elements(
    card: dict, field_values: dict, composition: str, aspect: str, accent: str,
    frame_w: int, frame_h: int,
) -> list[dict]:
    """Resolve the SHOWN text elements in STAGGER_ORDER, then compute their
    MEASURED layout in one pass (T6640 `intro_card_geometry.layout`). A slot with
    blank text is OMITTED and logged (never drawn blank). Returns dicts with the
    rendered TextSpec and the stagger index.

    T6640: `text_elements` (the old per-slot STYLING blob) is NO LONGER READ —
    decision 12 makes the TEMPLATE own every element's font/colour/shadow via a
    fixed ROLE (`intro_card_geometry.ROLE_FOR_SLOT`); position/size are MEASURED,
    not a fixed per-slot lookup, so a wrapped title can never collide with the
    slot below it.
    """
    shown_fields = card.get("shown_fields") or []
    texts: dict[str, str] = {}

    # title: the PROFILE's full name, ALWAYS (T6620) -- the name is a property of
    # the athlete, not of a card. card.title_text (a pre-T6570 grandfathered
    # override) is NO LONGER read: T6570 removed the only UI that could clear it,
    # so a legacy value trapped the card on a stale name with no escape hatch.
    # The column is now dead and is nulled by profile_db migration v036.
    title_text = (field_values.get("full_name") or "").strip()
    if title_text:
        texts["title"] = title_text
    else:
        logger.info("[PlayerIntro] title omitted: profile full_name unset")

    # subtitle: FREE TEXT on the card (T6570) — a tournament name / sub-heading,
    # a property of THIS card (not the athlete). Orthogonal to composition; it
    # never counts toward the fact-count. .get() column-guards the read for a
    # pre-v035 card row.
    subtitle_text = (card.get("subtitle_text") or "").strip()
    if subtitle_text:
        texts["subtitle"] = subtitle_text
    else:
        logger.info("[PlayerIntro] subtitle omitted: card has no subtitle_text")

    # facts: ORDINAL slot fact{i+1} <- SEMANTIC field shown_fields[i]
    for i, field in enumerate(shown_fields):
        slot_key = f"fact{i + 1}"
        value = (field_values.get(field) or "").strip()
        if not value:
            logger.info(f"[PlayerIntro] fact {field!r} omitted: profile value unset")
            continue
        texts[slot_key] = value

    # Stack in STAGGER_ORDER (title, subtitle, fact1..3) -- present slots only.
    ordered = [(slot, texts[slot]) for slot in STAGGER_ORDER if slot in texts]
    positions = compute_layout(composition, aspect, ordered, accent, frame_w, frame_h)

    order_index = {name: idx for idx, name in enumerate(STAGGER_ORDER)}
    elements: list[dict] = []
    for slot, text in ordered:
        pos = positions[slot]
        spec = TextSpec.model_validate({
            "text": text,
            "font": pos["font"],
            "color": pos["color"],
            "size": pos["size"],
            "align": pos["align"],
            "position": {"x": pos["x"], "y": pos["y"]},
            "maxWidth": pos["maxWidth"],
            "shadow": pos["shadow"],
            "animation": "none",
        })
        elements.append({"slot": slot, "spec": spec, "stagger": order_index[slot]})
    return elements


def _fps_float(fps_str: str) -> float:
    try:
        if "/" in fps_str:
            n, d = fps_str.split("/")
            return float(n) / float(d)
        return float(fps_str)
    except (ValueError, ZeroDivisionError):
        return 30.0


def _scrim_kind(composition: str, has_photo: bool) -> str:
    if not has_photo:
        return "none"
    if composition == "title-only":
        return "dim"
    if composition in ("hero", "broadcast"):
        return "bottom"
    return "none"  # recruiting: text sits on the treatment area beside the inset


def _content_hash(
    card: dict, field_values: dict, image_path: str | None, info: dict,
    composition: str, aspect: str, elements: list[dict],
) -> str:
    """Hash EVERYTHING that affects pixels (task §C): card content, resolved text
    + specs, image bytes, framing, probe params, and _CARD_VERSION. Editing the
    card (or the reel's format) invalidates the cache; nothing else does. Card id /
    updated_at are excluded — they don't change pixels."""
    img_sig = ""
    if image_path:
        try:
            with open(image_path, "rb") as f:
                img_sig = hashlib.sha256(f.read()).hexdigest()
        except OSError:
            img_sig = "unreadable"
    payload = {
        "v": _CARD_VERSION,
        "composition": composition,
        "aspect": aspect,
        "treatment": card.get("treatment"),
        "duration": card.get("duration"),
        "focal": [card.get("focal_x"), card.get("focal_y"), card.get("zoom")],
        "image": img_sig,
        "elements": [{"slot": e["slot"], "spec": e["spec"].model_dump(mode="json")} for e in elements],
        "probe": {
            "w": info["width"], "h": info["height"], "fps": info["fps_str"],
            "pix": info["pix_fmt"], "sar": info["sar"], "ts": info["timescale"],
            "audio": info["has_audio"], "arate": info.get("a_rate"),
            "ach": info.get("a_channels"),
        },
    }
    return hashlib.md5(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:20]


# =============================================================================
# Card build (the one filter_complex, encoded once)
# =============================================================================
def _build_card(card: dict, field_values: dict, image_path: str | None, info: dict, card_path: str) -> None:
    """Render the animated card to `card_path`, matching the reel's stream params
    exactly. All motion lives in ONE filter_complex so the card is encoded once
    (animation is free at serve time). Raises on failure — the caller catches and
    returns non-fatally."""
    w, h = info["width"], info["height"]
    fps_str = info["fps_str"]
    pix_fmt = info["pix_fmt"]
    duration = float(card.get("duration") or 4.0)
    fps = _fps_float(fps_str)
    nframes = max(1, round(duration * fps))

    composition = derive_composition(image_path is not None, card.get("shown_fields") or [])
    aspect = aspect_key(w, h)
    geo = geometry_for(composition, aspect)
    treatment = treatment_for(card["treatment"])
    accent = treatment["accent"]

    elements = _select_elements(card, field_values, composition, aspect, accent, w, h)

    tmp_dir = Path(tempfile.mkdtemp(prefix="rb_intro_build_"))
    try:
        # --- Background (PIL, exact CSS parity) ---------------------------------
        bg_png = tmp_dir / "bg.png"
        _render_background(treatment["background"], w, h).save(bg_png)

        inputs: list[str] = [
            "-loop", "1", "-framerate", fps_str, "-t", str(duration), "-i", bg_png.as_posix(),
        ]
        parts = ["[0:v]format=rgba[base]"]
        last = "[base]"
        idx = 1

        # --- Photo: focal cover-crop (PIL) + Ken Burns push-in (zoompan) --------
        if image_path is not None:
            rect = geo["photo"]
            rw, rh = _even(round(rect["w"] * w)), _even(round(rect["h"] * h))
            px, py = round(rect["x"] * w), round(rect["y"] * h)
            fx = card.get("focal_x")
            fy = card.get("focal_y")
            zoom = card.get("zoom")
            framed = _frame_photo(
                image_path, rw, rh,
                0.5 if fx is None else float(fx),
                0.5 if fy is None else float(fy),
                1.0 if zoom is None else float(zoom),
            )
            photo_png = tmp_dir / "photo.png"
            framed.save(photo_png)
            inputs += ["-i", photo_png.as_posix()]
            z0 = MOTION["photoPushInZoomStart"]
            dz = MOTION["photoPushInZoomEnd"] - z0
            maxn = max(nframes - 1, 1)
            # Ease-out zoom about the centre; constant output size (overlay-safe,
            # T5240 landmine (a)). Commas inside the single-quoted expr are literal.
            zexpr = f"{z0}+{dz:.4f}*(1-pow(1-min(on/{maxn},1),2))"
            parts.append(
                f"[{idx}:v]zoompan=z='{zexpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                f"d={nframes}:s={rw}x{rh}:fps={fps_str},format=rgba[photo]"
            )
            parts.append(f"{last}[photo]overlay=x={px}:y={py}[withphoto]")
            last = "[withphoto]"
            idx += 1

            # --- Treatment photo GRADE (T6580 item 4): tint then vignette, over
            # the photo rect (px,py, rw x rh) so they clip to the photo exactly as
            # the preview does. Each is a static PNG overlaid on every frame. -----
            photo_mood = treatment.get("photoMood") or {}
            for name, img in (
                ("tint", _render_tint(photo_mood.get("tint"), rw, rh)),
                ("vignette", _render_vignette(photo_mood.get("vignette"), rw, rh)),
            ):
                if img is None:
                    continue
                png = tmp_dir / f"{name}.png"
                img.save(png)
                inputs += ["-loop", "1", "-framerate", fps_str, "-t", str(duration), "-i", png.as_posix()]
                parts.append(f"[{idx}:v]format=rgba[{name}]")
                parts.append(f"{last}[{name}]overlay=x={px}:y={py}[with{name}]")
                last = f"[with{name}]"
                idx += 1

            # --- Seam fade (T6640, task §C "hard 50/50 seam"): recruiting's
            # inset photo fades to the treatment's own background colour at its
            # inner edge, so the photo bleeds into the panel instead of a hard
            # cut. Static PNG, same seamSide/seamFeather/seamColor the browser
            # preview's CSS gradient reads (introCardVisual.seamFadeCss). -------
            seam_side = geo["reflow"].get("seamSide", "none")
            seam_feather = geo["reflow"].get("seamFeather", 0.0)
            seam_img = _render_seam_fade(rect, seam_side, seam_feather, treatment["seamColor"], w, h)
            if seam_img is not None:
                seam_png = tmp_dir / "seam.png"
                seam_img.save(seam_png)
                inputs += ["-loop", "1", "-framerate", fps_str, "-t", str(duration), "-i", seam_png.as_posix()]
                parts.append(f"[{idx}:v]format=rgba[seam]")
                parts.append(f"{last}[seam]overlay=x={px}:y={py}[withseam]")
                last = "[withseam]"
                idx += 1

            # --- Text ground: a treatment BAND (T6580 item 4) grounds the text in
            # the lower-third looks; where there is no band (photo-forward), the
            # bottom scrim stays. They are mutually exclusive, so the band replaces
            # the scrim rather than stacking. -----------------------------------
            band_spec = treatment.get("band") if band_kind(composition) == "bottom" else None
            scrim_kind = _scrim_kind(composition, True)
            if band_spec and scrim_kind == "bottom":
                scrim_kind = "none"
            scrim = _render_scrim(scrim_kind, w, h)
            if scrim is not None:
                scrim_png = tmp_dir / "scrim.png"
                scrim.save(scrim_png)
                inputs += ["-loop", "1", "-framerate", fps_str, "-t", str(duration), "-i", scrim_png.as_posix()]
                parts.append(f"[{idx}:v]format=rgba[scrim]")
                parts.append(f"{last}[scrim]overlay=x=0:y=0[withscrim]")
                last = "[withscrim]"
                idx += 1
            band_img = _render_band(band_spec, w, h)
            if band_img is not None:
                band_png = tmp_dir / "band.png"
                band_img.save(band_png)
                inputs += ["-loop", "1", "-framerate", fps_str, "-t", str(duration), "-i", band_png.as_posix()]
                parts.append(f"[{idx}:v]format=rgba[band]")
                parts.append(f"{last}[band]overlay=x=0:y=0[withband]")
                last = "[withband]"
                idx += 1

        # --- Text PNGs: staggered fade-up (alpha ramp on the PNG + a small rise) -
        first_st = MOTION["textStaggerFirstSt"]
        step = MOTION["textStaggerStep"]
        fade_d = MOTION["textFadeD"]
        rise_px = round(MOTION["textRiseFrac"] * h)
        for k, el in enumerate(elements):
            layer = render_text_layer(el["spec"], w, h)  # full-frame RGBA, glyphs at the slot
            el_png = tmp_dir / f"el_{k}.png"
            layer.save(el_png)
            inputs += ["-loop", "1", "-framerate", fps_str, "-t", str(duration), "-i", el_png.as_posix()]
            st = first_st + el["stagger"] * step
            # Rise: start `rise_px` lower, settle to 0 over the fade (fade-UP).
            yexpr = (
                f"if(lt(t,{st}),{rise_px},"
                f"if(lt(t,{st + fade_d}),{rise_px}*(1-(t-{st})/{fade_d}),0))"
            )
            parts.append(f"[{idx}:v]format=rgba,fade=t=in:st={st}:d={fade_d}:alpha=1[el{k}]")
            parts.append(f"{last}[el{k}]overlay=x=0:y='{yexpr}'[t{k}]")
            last = f"[t{k}]"
            idx += 1

        # --- Exit flash LAST (deterministic final frame -> clean cut to footage) -
        flash_d = MOTION["flashOutD"]
        flash_st = max(duration - flash_d, 0.0)
        parts.append(
            f"{last}fade=t=out:st={flash_st}:d={flash_d}:color=white,"
            f"setsar={info['sar']},format={pix_fmt}[v]"
        )
        filter_complex = ";".join(parts)

        # Silent audio matching the reel's layout, only when the reel has audio,
        # so the `-c copy` prepend stays stream-aligned (mirrors branded_outro).
        cmd = ["ffmpeg", "-y", *inputs]
        audio_idx = idx
        if info["has_audio"]:
            audio_layout = "mono" if info["a_channels"] == 1 else "stereo"
            cmd += ["-f", "lavfi", "-i",
                    f"anullsrc=channel_layout={audio_layout}:sample_rate={info['a_rate']}"]

        cmd += ["-filter_complex", filter_complex, "-map", "[v]"]
        if info["has_audio"]:
            cmd += ["-map", f"{audio_idx}:a"]
        cmd += ["-t", str(duration)]
        cmd += ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
                "-pix_fmt", pix_fmt, "-r", fps_str,
                "-video_track_timescale", str(info["timescale"])]
        if info["has_audio"]:
            cmd += ["-c:a", "aac", "-b:a", "128k",
                    "-ar", str(info["a_rate"]), "-ac", str(info["a_channels"]),
                    "-t", str(duration)]
        else:
            cmd += ["-an"]
        cmd += ["-f", "mp4", card_path]
        _run(cmd)
    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _get_or_build_card(card: dict, field_values: dict, image_path: str | None, info: dict) -> str | None:
    """Return a cached card path for these inputs, building it if absent. Atomic
    rename so concurrent callers never read a partial file. Returns None on any
    failure (never raises)."""
    try:
        _CARD_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        logger.warning(f"[PlayerIntro] cannot create card cache dir: {e}")
        return None

    composition = derive_composition(image_path is not None, card.get("shown_fields") or [])
    aspect = aspect_key(info["width"], info["height"])
    try:
        accent = treatment_for(card["treatment"])["accent"]
        elements = _select_elements(
            card, field_values, composition, aspect, accent, info["width"], info["height"],
        )
    except Exception as e:
        logger.error(f"[PlayerIntro] cannot resolve card layout: {e}", exc_info=True)
        return None

    key = _content_hash(card, field_values, image_path, info, composition, aspect, elements)
    card_path = _CARD_CACHE_DIR / f"card_{key}.mp4"
    if card_path.exists():
        return str(card_path)

    tmp_card = str(card_path) + ".tmp"
    try:
        _build_card(card, field_values, image_path, info, tmp_card)
        os.replace(tmp_card, str(card_path))
        return str(card_path)
    except Exception as e:
        stderr = getattr(e, "stderr", None)
        detail = stderr[-600:] if isinstance(stderr, str) else str(e)
        logger.error(f"[PlayerIntro] card build failed: {detail}", exc_info=not stderr)
        try:
            os.remove(tmp_card)
        except OSError:
            pass
        return None


# =============================================================================
# Public API
# =============================================================================
def build_intro_card(
    card: dict,
    field_values: dict,
    image_path: str | None,
    info: dict,
    out_path: str,
) -> bool:
    """Render `card` into an animated MP4 at `out_path`, matching `info` (the probe
    of the target reel). Returns True on success, False if it was skipped or failed
    (in which case `out_path` is not written). NEVER raises — a failed intro card
    must not sink a download, share or export (epic decision 9).

    Pure function of (card row, resolved profile `field_values`, local `image_path`,
    probe) -> file: no DB, no R2, no job rows (task §D). T5220 resolves the card,
    profile facts + effective focal, and the downloaded image (cut-out if present).
    """
    try:
        card_path = _get_or_build_card(card, field_values, image_path, info)
        if card_path is None:
            return False
        import shutil
        shutil.copyfile(card_path, out_path)
        logger.info(
            f"[PlayerIntro] built {info['width']}x{info['height']} @ {info['fps_str']} "
            f"treatment={card.get('treatment')} audio={info['has_audio']}"
        )
        return True
    except Exception as e:
        logger.error(f"[PlayerIntro] unexpected failure; no card: {e}", exc_info=True)
        return False


def prepend_intro_card(card_path: str, main_path: str, out_path: str) -> bool:
    """PREPEND an already-built card to `main_path`, writing to `out_path`. Probe-
    matched stream-copy when profiles match, re-encode fallback, then validate.
    Returns False (and does not commit `out_path`) on any failure. Never raises.

    Provided for T5220's egress callers; the card is expected to have been built
    with `build_intro_card(info=_probe_media(main_path))` so the copy join works.
    """
    try:
        main = _probe_media(main_path)
        card = _probe_media(card_path)
        expected_min = main["duration"] + card["duration"] * 0.6
        try:
            _concat_copy(card_path, main_path, out_path)
            if _validate_concat(out_path, expected_min):
                logger.info("[PlayerIntro] prepended (copy)")
                return True
            logger.warning("[PlayerIntro] stream-copy prepend failed validation; re-encoding")
        except subprocess.CalledProcessError as e:
            logger.warning(
                f"[PlayerIntro] stream-copy prepend failed; re-encoding. "
                f"{e.stderr[-400:] if e.stderr else e}"
            )
        _concat_reencode(card_path, main_path, out_path, main["has_audio"])
        if _validate_concat(out_path, expected_min):
            logger.info("[PlayerIntro] prepended (re-encode fallback)")
            return True
        logger.error("[PlayerIntro] re-encode prepend also failed validation; no intro")
        return False
    except subprocess.CalledProcessError as e:
        stderr = e.stderr[-600:] if e.stderr else str(e)
        logger.error(f"[PlayerIntro] ffmpeg failed; no intro. stderr:\n{stderr}")
        return False
    except Exception as e:
        logger.error(f"[PlayerIntro] unexpected prepend failure; no intro: {e}", exc_info=True)
        return False
