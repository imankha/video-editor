"""
Branded "Made with Reel Ballers" outro (T3950).

A short (~1.75s) end-card appended to the FINAL published video at render time.
It is *chrome*, not content: it is NOT persisted into working_clips / keyframes /
segments or any DB row (CLAUDE.md: render-time only, no reactive persistence).

Where it is appended (the verified per-flow invariant):
  The outro is appended by the ONE step that produces the FINAL published artifact
  (a `final_videos/*` object) for each flow -- never on the intermediate
  `working_videos/*` object, which the overlay step always re-renders/copies into
  the final. Framing (`_export_clips`) and the multi-clip stitch produce the WORKING
  video; the overlay export (`render_overlay` real render + no-keyframes copy + test
  copy) and `export_final` produce the FINAL video. So the outro is wired into the
  final-video producers only. Every published/shared reel passes through one of them
  (publish 404s without a `final_videos` row), so this covers single-clip, multi-clip,
  and re-export with exactly one outro and no double-stacking. See
  `docs/plans/tasks/T3950-made-with-reel-ballers-outro.md`.

Card generation matches the main video EXACTLY (resolution / fps / SAR / pixel format /
audio layout / timebase) so the append is a fast concat-demuxer stream copy (`-c copy`);
only the ~1.75s card is encoded. A full re-encode concat is the fallback if the copy
join fails validation (e.g. a frontend-rendered `export_final` upload with an odd
profile).

Flag: `BRANDED_OUTRO_ENABLED` (env, default true) gates the whole feature so a paid
"remove branding" tier can turn it off later -- flag only, no billing logic here.

External-boundary failure choice: appending the outro must NEVER abort an export (a
failed card must not sink a paid GPU render). On any card/concat failure the helper
logs loudly and returns False; the caller keeps the card-less final and completes the
export, surfacing a warning. A visible card-less "success" beats a lost reel.
"""

import hashlib
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# Card cache: one card per (resolution/fps/format) combo, shared across all download
# requests. Built once per unique params for the lifetime of the process; stored in the
# system temp dir (survives in-process but not across pod restarts, which is fine --
# a 1.75s card build on a cold start is negligible).
_CARD_CACHE_DIR: Path = Path(tempfile.gettempdir()) / "rb_outro_cards"

# ~4.5s, structured as READ -> HOLD -> REVEAL -> HOLD so viewers can actually read both
# lines of text (a fade-in on the brand would eat the read time). Timeline:
#   0.00       white-flash frame (deterministic white frame 0)
#   0.00-1.30  logo animates (ring spins in, play button lands) WITH the brand text already
#              fully visible -- "Made with" + "Reel Ballers" never fade, they are present
#              from t=0 so there is nothing to wait to read
#   1.30-2.60  HOLD: logo resolved, "Made With Reel Ballers" static -> ~1.3s to read it
#   2.60-2.95  REVEAL: tagline + URL fade in TOGETHER (the only staged elements)
#   2.95-4.50  HOLD: tagline + URL static -> ~1.55s to read them, then the card ends
OUTRO_DURATION = 4.5
# Entrance beat: a quick WHITE FLASH (the shared "flash" motion vocabulary with the animated
# player intro, T5210). It gives a DETERMINISTIC white frame 0 on every ffmpeg build (proven
# portable) and reveals the spinning emblem beneath it. (Was OUTRO_FADE_IN=0.4 black fade.)
OUTRO_FLASH_IN = 0.15
# Emblem reveal (T5240 rework): the logo is assembled from its SVG PARTS, not the flat lockup.
# The film-reel RING (outer ring + 4 sprocket holes, gradient #a855f7->#6366f1) SPINS in,
# decelerating (ease-out) to a stop; then the white PLAY triangle LANDS with a button-press
# bounce (ease-out-back overshoot). Ring + triangle resolve into the whole logo. The brand
# text is present from t=0 alongside this (it does NOT wait for the logo to finish).
OUTRO_SPIN_D = 1.0           # ring spins over the first second, easing to a stop
OUTRO_SPIN_TURNS = 3         # full rotations before it settles
OUTRO_RING_FADE_ST = 0.05
OUTRO_RING_FADE_D = 0.40
OUTRO_PLAY_ST = 1.00         # play triangle lands just as the ring comes to rest
OUTRO_PLAY_D = 0.32          # press/bounce (scale overshoot) duration
OUTRO_PLAY_FADE_D = 0.12
# Staged reveal: "Made with" + "Reel Ballers" are ALWAYS visible (present from t=0, no fade
# -- viewers must be able to read them). Only the tagline + URL are staged: after a ~1.3s
# read-hold on the brand, they fade in TOGETHER over OUTRO_REVEAL_FADE_D, then hold to the end.
OUTRO_REVEAL_ST = 2.60       # tagline + URL begin fading in (after the brand read-hold)
OUTRO_REVEAL_FADE_D = 0.35
# Bump when the card LAYOUT or ANIMATION changes so stale cached cards (old build) rebuild.
_CARD_VERSION = "v5-read-hold"
MADE_WITH_TEXT = "Made with"
BRAND_TEXT = "Reel Ballers"
TAGLINE_TEXT = "Share Your Player's Brilliance"
URL_TEXT = "reelballers.com"

# Bundled font -- the Fly image installs ffmpeg but NO fontconfig fonts, so drawtext
# must be pointed at an absolute `fontfile=` that ships in the repo (COPY . . in the
# Dockerfile), not `font=Sans` (which needs fontconfig). Works identically in the
# /dotask container and in dev.
_FONT_PATH = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "DejaVuSans-Bold.ttf"

# The logo EMBLEM split into its two animatable parts, rasterized from logo.svg on a
# TRANSPARENT canvas (RGBA) so each can be moved independently and composited over the
# card background at render time:
#   - reelballers-ring.png : the film-reel outer ring + 4 sprocket holes (the gradient
#     part that SPINS). Circular + centered, so it rotates without clipping.
#   - reelballers-play.png : the white play triangle (the part that LANDS with a bounce).
# Both share logo.svg's 48x48 viewbox, so overlaying them at the same position/scale
# reconstructs the whole logo exactly. Regenerate from logo.svg if the mark changes.
_RING_PATH = Path(__file__).resolve().parent.parent / "assets" / "branding" / "reelballers-ring.png"
_PLAY_PATH = Path(__file__).resolve().parent.parent / "assets" / "branding" / "reelballers-play.png"

# Brand palette (dark background, muted caption text; the emblem carries the color).
_BG_COLOR = "0x0B0F1A"
_CAPTION_COLOR = "0x9CA3AF"
_BRAND_COLOR = "0xF3F4F6"     # near-white for the "Reel Ballers" wordmark (stands out)


def outro_enabled() -> bool:
    """Whether the branded outro should be appended (env flag, default ON).

    The one place a future paid branding-removal tier flips the whole feature off.
    """
    return os.getenv("BRANDED_OUTRO_ENABLED", "true").strip().lower() not in (
        "0", "false", "no", "off", "",
    )


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=True)


def _escape_filter_path(path: str) -> str:
    """Escape a filesystem path for use inside an ffmpeg filtergraph value.

    A colon separates filter options, so a Windows drive letter (`C:/...`)
    breaks parsing. Backslash-escape the colon; forward slashes are already
    fine. No-op on POSIX paths (prod/container), needed for local Windows dev.
    """
    return path.replace("\\", "/").replace(":", "\\:")


def _card_cache_key(info: dict) -> str:
    """16-char hex key for the params that determine card content and compatibility."""
    key = (
        f"{_CARD_VERSION}_{info['width']}x{info['height']}_fps={info['fps_str']}"
        f"_pix={info['pix_fmt']}_sar={info['sar']}_ts={info['timescale']}"
        f"_audio={info['has_audio']}_arate={info.get('a_rate', 0)}"
        f"_ach={info.get('a_channels', 0)}"
    )
    return hashlib.md5(key.encode()).hexdigest()[:16]


def _get_or_build_card(info: dict) -> str | None:
    """Return a cached card path for `info`, building it if absent.

    Writes to _CARD_CACHE_DIR using an atomic rename so concurrent callers
    never read a partial file. Returns None on any failure (never raises).
    """
    try:
        _CARD_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        logger.warning(f"[BrandedOutro] cannot create card cache dir: {e}")
        return None

    card_path = _CARD_CACHE_DIR / f"card_{_card_cache_key(info)}.mp4"
    if card_path.exists():
        return str(card_path)

    tmp_card = str(card_path) + ".tmp"
    try:
        _build_outro_card(tmp_card, info)
        os.replace(tmp_card, str(card_path))
        return str(card_path)
    except Exception as e:
        logger.error(f"[BrandedOutro] card build failed: {e}")
        try:
            os.remove(tmp_card)
        except OSError:
            pass
        return None


def _probe_media(path: str) -> dict:
    """Probe the video+audio stream params we must match for a clean concat.

    Returns width/height/fps_str/pix_fmt/sar/timescale/duration plus audio info
    (has_audio, a_codec, a_rate, a_channels). Raises on a failed probe -- we must
    not guess dimensions for a concat (a mismatch corrupts the join).
    """
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

    # Prefer avg_frame_rate; fall back to r_frame_rate. Keep it as a fraction string
    # so we pass the exact rate (e.g. 30000/1001) through to the card, not a rounded float.
    fps_str = vstream.get("avg_frame_rate") or vstream.get("r_frame_rate") or "30/1"
    if fps_str in ("0/0", "0/1", "N/A", None):
        fps_str = vstream.get("r_frame_rate") or "30/1"

    sar = vstream.get("sample_aspect_ratio") or "1:1"
    if sar in ("0:1", "N/A", None):
        sar = "1:1"

    # timebase like "1/15360" -> timescale 15360, matched on the card so -c copy joins cleanly.
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


def _reveal_alpha() -> str:
    """drawtext alpha ramp for the STAGED reveal (tagline + URL): 0 during the brand
    read-hold, linear up over the reveal fade at OUTRO_REVEAL_ST, then holds 1 to the end."""
    end = OUTRO_REVEAL_ST + OUTRO_REVEAL_FADE_D
    return (
        f"if(lt(t,{OUTRO_REVEAL_ST}),0,"
        f"if(lt(t,{end}),(t-{OUTRO_REVEAL_ST})/{OUTRO_REVEAL_FADE_D},1))"
    )


def _build_outro_card(card_path: str, info: dict) -> None:
    """Render the end-card to `card_path`, matching the main video's params exactly.

    Dark background + an animated logo emblem (spinning film-reel ring that resolves into
    the whole logo with a pressed-play-button beat) + staggered captions, sized to the
    output resolution so all three aspect ratios (9:16 / 1:1 / 16:9) get correctly-
    proportioned marks with no letterboxing/stretch. A silent audio track (matching
    layout) is included only when the main video has audio, so a `-c copy` concat stays
    stream-aligned.

    The animation is deterministic across ffmpeg builds: frame 0 is a full white flash
    (fade-from-white at fraction 0), and the spin/press are ordinary rotate/scale
    expressions of the frame timestamp `t`. Motion timings may land a frame apart on
    different builds, but the sampled luma windows the tests pin do not.
    """
    w, h = info["width"], info["height"]
    fps_str = info["fps_str"]
    pix_fmt = info["pix_fmt"]
    font = _escape_filter_path(_FONT_PATH.as_posix())
    ring = _RING_PATH.as_posix()
    play = _PLAY_PATH.as_posix()

    # Layout: a centered vertical stack, URL pinned near the bottom.
    #   "Made with"      (small caption, above the emblem)
    #   [emblem]         (spinning ring + landing play triangle -- the visual anchor)
    #   "Reel Ballers"   (brand wordmark, below the emblem: reads "Made with .. Reel Ballers")
    #   tagline          ("Share Your Player's Brilliance")
    #   reelballers.com  (URL, near the bottom edge)
    # The emblem is a square, sized off the SHORTER card side so it never overflows on any
    # of 9:16 / 1:1 / 16:9; overlay=(W-w)/2 centers it horizontally.
    emblem = round(min(w, h) * 0.30)
    emblem_cy = round(h * 0.40)                    # emblem centered ~40% down
    emblem_top = emblem_cy - emblem // 2
    emblem_bot = emblem_cy + emblem // 2
    # The play triangle animates its scale (see below). overlay cannot composite an input
    # whose size changes per frame, so each scaled play frame is padded back onto this
    # constant canvas (bigger than the bounce's overshoot) before it reaches overlay.
    play_canvas = round(emblem * 1.25)

    made_fs = max(16, round(h * 0.030))            # "Made with" -- deliberately small
    brand_fs = max(20, round(h * 0.045))           # "Reel Ballers" -- the brand, larger
    tag_fs = max(15, round(h * 0.028))
    url_fs = max(13, round(h * 0.024))
    made_y = emblem_top - made_fs - round(h * 0.02)
    brand_y = emblem_bot + round(h * 0.03)
    tag_y = brand_y + brand_fs + round(h * 0.02)
    url_y = round(h * 0.90)

    # --- Motion (T5240 rework) ---------------------------------------------------
    # `t` is the card timeline (0..OUTRO_DURATION); the ring/play are looped into full-
    # length streams (see cmd below) so their filters have frames to animate across.
    # Expressions are wrapped in single quotes in the filtergraph, so commas inside them
    # are protected literally (no backslash escaping needed).
    #
    # Ring spin: angle in radians, ease-OUT (decelerate) to a stop -- 1-(1-p)^2.
    two_pi = 6.28318530718
    spin_total = two_pi * OUTRO_SPIN_TURNS
    spin_p = f"clip(t/{OUTRO_SPIN_D},0,1)"
    angle = f"{spin_total:.5f}*(1-pow(1-{spin_p},2))"
    # Play press: ease-OUT-back scale -- grows from ~0, overshoots ~10%, settles to 1.0.
    # max(0.05,..) keeps the scaled width > 0 before/at the start (scale to 0 is invalid).
    q = f"clip((t-{OUTRO_PLAY_ST})/{OUTRO_PLAY_D},0,1)"
    eob = f"1+2.70158*pow({q}-1,3)+1.70158*pow({q}-1,2)"
    play_dim = f"{emblem}*max(0.05,{eob})"

    # The tagline contains an apostrophe, which cannot be reliably escaped inside a
    # single-quoted drawtext `text=` across ffmpeg builds. Write it to a temp file and
    # point drawtext at it with `textfile=` (sidesteps all filtergraph quoting).
    tag_fd, tag_path = tempfile.mkstemp(suffix=".txt", prefix="rb_outro_tag_")
    try:
        with os.fdopen(tag_fd, "w", encoding="utf-8") as f:
            f.write(TAGLINE_TEXT)
        tagfile = _escape_filter_path(Path(tag_path).as_posix())

        filter_complex = (
            # Ring: scale to the emblem box, spin (decelerating), fade in.
            f"[1:v]scale={emblem}:{emblem},format=rgba,"
            f"rotate=a='{angle}':c=none,"
            f"fade=t=in:st={OUTRO_RING_FADE_ST}:d={OUTRO_RING_FADE_D}:alpha=1[ring];"
            # Play triangle: land with a per-frame press/bounce scale, then fade in.
            # The scale changes size every frame; overlay freezes on a variable-size input,
            # so pad each frame back onto a constant `play_canvas` (> the overshoot) -- the
            # triangle stays centered and grows within it, and overlay sees a fixed size.
            f"[2:v]scale=w='{play_dim}':h='{play_dim}':eval=frame,"
            f"pad=w={play_canvas}:h={play_canvas}:x=({play_canvas}-iw)/2:y=({play_canvas}-ih)/2:"
            f"color=black@0:eval=frame,format=rgba,"
            f"fade=t=in:st={OUTRO_PLAY_ST}:d={OUTRO_PLAY_FADE_D}:alpha=1[play];"
            # Compose the emblem: ring centered, play centered on the same point (the
            # bounce scales about that center so ring + triangle stay registered).
            f"[0:v][ring]overlay=x=(W-w)/2:y={emblem_top}[base0];"
            f"[base0][play]overlay=x=(W-w)/2:y='{emblem_cy}-h/2'[base];"
            # Brand unit ("Made with" + "Reel Ballers"): ALWAYS visible -- present from t=0
            # with no alpha ramp, so there is nothing to wait to read (the flash whites out
            # frame 0, then the brand is fully legible immediately behind it).
            f"[base]drawtext=fontfile='{font}':text='{MADE_WITH_TEXT}':"
            f"fontsize={made_fs}:fontcolor={_CAPTION_COLOR}:x=(w-text_w)/2:y={made_y},"
            f"drawtext=fontfile='{font}':text='{BRAND_TEXT}':"
            f"fontsize={brand_fs}:fontcolor={_BRAND_COLOR}:x=(w-text_w)/2:y={brand_y},"
            # Staged reveal: tagline + URL fade in TOGETHER after the brand read-hold.
            f"drawtext=fontfile='{font}':textfile='{tagfile}':"
            f"fontsize={tag_fs}:fontcolor={_CAPTION_COLOR}:x=(w-text_w)/2:y={tag_y}:"
            f"alpha='{_reveal_alpha()}',"
            f"drawtext=fontfile='{font}':text='{URL_TEXT}':"
            f"fontsize={url_fs}:fontcolor={_CAPTION_COLOR}:x=(w-text_w)/2:y={url_y}:"
            f"alpha='{_reveal_alpha()}',"
            # Entrance flash: deterministic white frame 0 on every ffmpeg build.
            f"fade=t=in:st=0:d={OUTRO_FLASH_IN}:color=white,"
            f"setsar={info['sar']},format={pix_fmt}[v]"
        )

        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"color=c={_BG_COLOR}:s={w}x{h}:r={fps_str}:d={OUTRO_DURATION}",
            # Loop each still into a full-length stream so its filters have frames to
            # animate over (a single -i image is one frame -- filters can't animate it).
            "-loop", "1", "-framerate", fps_str, "-t", str(OUTRO_DURATION), "-i", ring,
            "-loop", "1", "-framerate", fps_str, "-t", str(OUTRO_DURATION), "-i", play,
        ]
        audio_idx = 3
        if info["has_audio"]:
            layout = "mono" if info["a_channels"] == 1 else "stereo"
            cmd += ["-f", "lavfi", "-i",
                    f"anullsrc=channel_layout={layout}:sample_rate={info['a_rate']}"]

        cmd += ["-filter_complex", filter_complex, "-map", "[v]"]
        if info["has_audio"]:
            cmd += ["-map", f"{audio_idx}:a"]
        cmd += ["-t", str(OUTRO_DURATION)]
        cmd += ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
                "-pix_fmt", pix_fmt, "-r", fps_str,
                "-video_track_timescale", str(info["timescale"])]
        if info["has_audio"]:
            cmd += ["-c:a", "aac", "-b:a", "128k",
                    "-ar", str(info["a_rate"]), "-ac", str(info["a_channels"]),
                    "-t", str(OUTRO_DURATION)]
        else:
            cmd += ["-an"]
        # Force mp4 container explicitly so the output path extension doesn't need
        # to be .mp4 (the cache builds to a .tmp path before an atomic rename).
        cmd += ["-f", "mp4", card_path]
        _run(cmd)
    finally:
        try:
            os.remove(tag_path)
        except OSError:
            pass


def _concat_copy(main_path: str, card_path: str, out_path: str) -> None:
    """Fast append: concat demuxer with stream copy (only the card was encoded)."""
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        list_path = f.name
        for p in (main_path, card_path):
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


def _concat_reencode(main_path: str, card_path: str, out_path: str, has_audio: bool) -> None:
    """Robust fallback: re-encode concat via the concat filter.

    Slower (re-encodes the main video), used only when the stream-copy join fails
    validation -- e.g. a frontend-rendered final with an incompatible H.264 profile.
    """
    if has_audio:
        fc = "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]"
        maps = ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "128k"]
    else:
        fc = "[0:v][1:v]concat=n=2:v=1:a=0[v]"
        maps = ["-map", "[v]", "-an"]
    _run([
        "ffmpeg", "-y",
        "-i", main_path, "-i", card_path,
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
        logger.warning(f"[BrandedOutro] concat validation probe failed: {e}")
        return False


def append_branded_outro(in_path: str, out_path: str) -> bool:
    """Append the branded outro to `in_path`, writing the result to `out_path`.

    Returns True if the outro was appended, False if it was skipped (flag off) or
    failed (in which case `out_path` is NOT written -- the caller keeps `in_path`).
    Never raises: outro failure must not abort an export or a download.

    The outro card is cached per (resolution/fps/format) in _CARD_CACHE_DIR so
    repeated download requests for the same reel don't re-encode the card each time.
    """
    if not outro_enabled():
        return False
    if not _FONT_PATH.exists():
        logger.error(f"[BrandedOutro] font missing at {_FONT_PATH}; skipping outro")
        return False

    try:
        info = _probe_media(in_path)
        card_path = _get_or_build_card(info)
        if card_path is None:
            return False

        expected_min = info["duration"] + OUTRO_DURATION * 0.6

        try:
            _concat_copy(in_path, card_path, out_path)
            if _validate_concat(out_path, expected_min):
                logger.info(
                    f"[BrandedOutro] appended (copy) {info['width']}x{info['height']} "
                    f"@ {info['fps_str']} audio={info['has_audio']}"
                )
                return True
            logger.warning("[BrandedOutro] stream-copy join failed validation; re-encoding")
        except subprocess.CalledProcessError as e:
            logger.warning(f"[BrandedOutro] stream-copy concat failed; re-encoding. {e.stderr[-400:] if e.stderr else e}")

        _concat_reencode(in_path, card_path, out_path, info["has_audio"])
        if _validate_concat(out_path, expected_min):
            logger.info("[BrandedOutro] appended (re-encode fallback)")
            return True
        logger.error("[BrandedOutro] re-encode concat also failed validation; shipping card-less")
        return False

    except subprocess.CalledProcessError as e:
        stderr = e.stderr[-600:] if e.stderr else str(e)
        logger.error(f"[BrandedOutro] ffmpeg failed; shipping card-less final. stderr:\n{stderr}")
        return False
    except Exception as e:
        logger.error(f"[BrandedOutro] unexpected failure; shipping card-less final: {e}", exc_info=True)
        return False


def apply_branded_outro_to_bytes(content: bytes) -> bytes:
    """Append the outro to an in-memory final video, returning the new bytes.

    For `export_final`, which already holds the frontend-rendered final in memory --
    appending before the single R2 upload avoids a download+re-upload round trip.
    Returns the ORIGINAL bytes unchanged if the outro is skipped (flag off) or fails
    (never raises -- the export still ships).
    """
    if not outro_enabled():
        return content

    tmp_dir = tempfile.mkdtemp(prefix="branded_outro_bytes_")
    in_path = os.path.join(tmp_dir, "final_in.mp4")
    out_path = os.path.join(tmp_dir, "final_out.mp4")
    try:
        with open(in_path, "wb") as f:
            f.write(content)
        if not append_branded_outro(in_path, out_path):
            return content
        with open(out_path, "rb") as f:
            return f.read()
    except Exception as e:
        logger.error(f"[BrandedOutro] apply-to-bytes failed; shipping card-less: {e}", exc_info=True)
        return content
    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)


def apply_branded_outro_to_r2_object(user_id: str, final_key: str) -> bool:
    """Append the outro to an existing `final_videos/*` R2 object, in place.

    Downloads the final, appends the card, re-uploads to the SAME key. Runs at the
    router layer (above the Modal/local dispatch), so it covers both engines without
    editing any Modal function. Blocking (sync) -- callers wrap in asyncio.to_thread.

    Returns True if the object was rewritten with the outro; False if skipped (flag
    off) or on any failure (the original card-less object is left untouched). Never
    raises -- the export completes either way.
    """
    if not outro_enabled():
        return False

    from app.storage import download_from_r2, upload_to_r2

    tmp_dir = tempfile.mkdtemp(prefix="branded_outro_r2_")
    in_path = os.path.join(tmp_dir, "final_in.mp4")
    out_path = os.path.join(tmp_dir, "final_out.mp4")
    try:
        if not download_from_r2(user_id, final_key, Path(in_path)):
            logger.error(f"[BrandedOutro] could not download {final_key} to append outro; shipping card-less")
            return False
        if not append_branded_outro(in_path, out_path):
            return False
        if not upload_to_r2(user_id, final_key, Path(out_path)):
            logger.error(f"[BrandedOutro] re-upload of outro'd {final_key} failed; original object retained")
            return False
        logger.info(f"[BrandedOutro] rewrote {final_key} with outro")
        return True
    except Exception as e:
        logger.error(f"[BrandedOutro] apply-to-r2 failed for {final_key}; shipping card-less: {e}", exc_info=True)
        return False
    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)
