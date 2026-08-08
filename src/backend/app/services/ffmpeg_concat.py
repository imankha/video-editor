"""Shared ffmpeg concat/probe helpers (T5220 design §8).

`_probe_media`/`_concat_copy`/`_concat_reencode`/`_validate_concat`/`_run`/
`_escape_filter_path` were byte-for-byte duplicated in `branded_outro.py`
(main-first join) and `player_intro.py` (card-first join) -- this is the 3rd
use (`serve_time_video.compose_serve_time` wants an ORDERED N-segment join),
so per the "abstract on the 3rd duplication" rule (T5210 gate Q4 deferred
this here) they are extracted verbatim into this module.

This is a MECHANICAL MOVE (strangler-fig Commit A, design §8): `branded_outro`
and `player_intro` now import from here instead of defining their own copies;
their public APIs (`append_branded_outro`, `apply_branded_outro_to_bytes`,
`build_intro_card`, `prepend_intro_card`) keep their exact existing
signatures. No behaviour change in this commit -- `test_t3950_branded_outro.py`
and `test_t5210_player_intro.py` must stay green byte-for-byte.

`concat_segments` generalizes the old 2-segment (`_concat_copy`/`_concat_reencode`)
joins to an ORDERED list of N segments: demuxer concat with `-c copy` first,
falling back to a `filter_complex concat=n=len` re-encode when the copy-join
fails validation, validating again after the fallback. Non-fatal: returns
False on total failure, never raises -- this is what lets
`serve_time_video.compose_serve_time` join `[intro?, reel, outro?]` in ONE
pass (design §4) instead of two sequential 2-segment concats.
"""

import json
import logging
import os
import subprocess
import tempfile

logger = logging.getLogger(__name__)


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=True)


# Back-compat alias for callers migrated from the old private name.
_run = run


def escape_filter_path(path: str) -> str:
    """Escape a filesystem path for use inside an ffmpeg filtergraph value.

    A colon separates filter options, so a Windows drive letter (`C:/...`)
    breaks parsing. Backslash-escape the colon; forward slashes are already
    fine. No-op on POSIX paths (prod/container), needed for local Windows dev.
    """
    return path.replace("\\", "/").replace(":", "\\:")


_escape_filter_path = escape_filter_path


def probe_media(path: str) -> dict:
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
    data = json.loads(run(cmd).stdout)
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


def _validate_concat(out_path: str, expected_min: float) -> bool:
    """Sanity-check the joined file: probes cleanly and is at least expected length."""
    try:
        info = probe_media(out_path)
        return info["duration"] >= expected_min
    except Exception as e:
        logger.warning(f"[ffmpeg_concat] concat validation probe failed: {e}")
        return False


def _concat_copy_n(segments: list[str], out_path: str) -> None:
    """Fast N-segment join: concat demuxer with stream copy (segments are
    already-encoded/matched files), in ORDER."""
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        list_path = f.name
        for p in segments:
            f.write(f"file '{os.path.abspath(p)}'\n")
    try:
        run([
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


def _concat_reencode_n(
    segments: list[str], out_path: str, has_audio: bool,
    target_w: int | None = None, target_h: int | None = None,
) -> None:
    """Robust N-segment re-encode fallback via the concat filter, used only when
    the stream-copy join fails validation (e.g. mismatched profiles).

    The concat FILTER (unlike the demuxer's `-c copy` mode) requires every
    input to share the same frame size/SAR -- it errors out rather than
    silently reinterpreting mismatched segments. `target_w`/`target_h`
    (defaulting to the first segment's own probed size when omitted) are
    applied via a per-input `scale` so segments built at different
    resolutions (e.g. an intro card vs. the reel) still join cleanly here.
    """
    n = len(segments)
    inputs: list[str] = []
    for seg in segments:
        inputs += ["-i", seg]

    if target_w is None or target_h is None:
        first = probe_media(segments[0])
        target_w, target_h = first["width"], first["height"]

    scale_parts = [
        f"[{i}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=disable,"
        f"setsar=1,format=yuv420p[v{i}]"
        for i in range(n)
    ]
    if has_audio:
        stream_refs = "".join(f"[v{i}][{i}:a]" for i in range(n))
        fc = ";".join(scale_parts) + f";{stream_refs}concat=n={n}:v=1:a=1[v][a]"
        maps = ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "128k"]
    else:
        stream_refs = "".join(f"[v{i}]" for i in range(n))
        fc = ";".join(scale_parts) + f";{stream_refs}concat=n={n}:v=1:a=0[v]"
        maps = ["-map", "[v]", "-an"]

    run([
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", fc, *maps,
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        out_path,
    ])


def _concat_reencode(
    segments: list[str], out_path: str, has_audio: bool,
    target_w: int | None = None, target_h: int | None = None,
) -> None:
    """Alias kept for external test/monkeypatch compatibility with the pre-move
    per-module private name; delegates to `_concat_reencode_n`."""
    return _concat_reencode_n(segments, out_path, has_audio, target_w, target_h)


def concat_segments(segments: list[str], out_path: str, probe: dict) -> bool:
    """Join an ORDERED list of N segment file paths into `out_path`.

    Ordered demuxer concat with `-c copy` first (fast -- all segments are
    already built to match `probe`'s params); falls back to a `filter_complex
    concat=n=len` re-encode when the copy-join fails validation (mismatched
    profiles), validating again after the fallback. `probe` supplies the
    expected per-segment minimum duration floor via its own `duration` field
    is NOT used directly here -- callers pass the probe of ONE reference
    segment purely so a future validation refinement has it; the validation
    floor is computed from the segment files themselves (each segment's own
    probed duration), so a silently-truncated concat is never reported as
    success.

    Non-fatal: returns False on total failure (out_path is not left as a
    partial/broken file), never raises.
    """
    if not segments:
        return False

    try:
        seg_probes = [probe_media(s) for s in segments]
    except Exception as e:
        logger.error(f"[ffmpeg_concat] could not probe a segment for concat: {e}")
        return False

    seg_durations = [p["duration"] for p in seg_probes]
    expected_min = sum(seg_durations) * 0.6
    has_audio = bool(probe.get("has_audio"))

    # The concat DEMUXER's `-c copy` mode does not itself reject a mismatched
    # resolution/pix_fmt/SAR -- it silently reinterprets every segment's frames
    # under the FIRST segment's declared params, corrupting playback while
    # still reporting a plausible summed duration (so a duration-only
    # validation can't catch it). Check compatibility across all segments
    # upfront and go straight to the re-encode fallback on any mismatch,
    # exactly the case the pre-extraction callers avoided by always building
    # their card to match the reel's own probe before calling in.
    compatible = all(
        p["width"] == seg_probes[0]["width"]
        and p["height"] == seg_probes[0]["height"]
        and p["pix_fmt"] == seg_probes[0]["pix_fmt"]
        for p in seg_probes
    )

    try:
        if compatible:
            try:
                _concat_copy_n(segments, out_path)
                if _validate_concat(out_path, expected_min):
                    logger.info(f"[ffmpeg_concat] joined {len(segments)} segments (copy)")
                    return True
                logger.warning("[ffmpeg_concat] stream-copy join failed validation; re-encoding")
            except subprocess.CalledProcessError as e:
                logger.warning(
                    f"[ffmpeg_concat] stream-copy concat failed; re-encoding. "
                    f"{e.stderr[-400:] if e.stderr else e}"
                )
        else:
            logger.info(
                "[ffmpeg_concat] segment params differ (resolution/pix_fmt/SAR); "
                "skipping copy join, re-encoding directly"
            )

        target_w = probe.get("width") or seg_probes[0]["width"]
        target_h = probe.get("height") or seg_probes[0]["height"]
        _concat_reencode(segments, out_path, has_audio, target_w, target_h)
        if _validate_concat(out_path, expected_min):
            logger.info(f"[ffmpeg_concat] joined {len(segments)} segments (re-encode fallback)")
            return True
        logger.error("[ffmpeg_concat] re-encode concat also failed validation; no output")
        return False
    except subprocess.CalledProcessError as e:
        stderr = e.stderr[-600:] if e.stderr else str(e)
        logger.error(f"[ffmpeg_concat] ffmpeg failed: {stderr}")
        return False
    except Exception as e:
        logger.error(f"[ffmpeg_concat] unexpected concat failure: {e}", exc_info=True)
        return False
