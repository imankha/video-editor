"""
T4430: the one app-side video probe.

`probe_video` is how app code asks a video (local path, URL, or raw bytes) for
its size, frame rate and duration. It raises `VideoProbeError` when the file
cannot be read -- never a guessed 30 fps or 0x0. Callers probing an external
dependency (an R2 object over the network) catch the error themselves and say
so. The Modal file keeps its own copy by policy.

T1500: `probe_r2_video` presigns an R2 object and probes it through ffprobe's
HTTP byte-range reads (games upload, backfill, clip linking).
"""
from __future__ import annotations

import json
import logging
import subprocess

logger = logging.getLogger(__name__)


class VideoProbeError(RuntimeError):
    """The video could not be probed: unreadable, no video stream, or no size/rate."""


def parse_frame_rate(rate: str | None) -> float:
    """ffprobe rate string ("30000/1001", "25/1", "25") -> fps. Raises on an
    unknown rate ("0/0", "N/A", missing) instead of assuming one."""
    try:
        num, _, den = (rate or "").partition("/")
        fps = float(num) / float(den) if den else float(num)
    except (ValueError, ZeroDivisionError) as e:
        raise VideoProbeError(f"unknown frame rate {rate!r}") from e
    if not fps > 0:
        raise VideoProbeError(f"unknown frame rate {rate!r}")
    return fps


def _valid_rate(rate: str | None) -> str | None:
    try:
        parse_frame_rate(rate)
    except VideoProbeError:
        return None
    return rate


def probe_video(source: str | bytes, *, timeout: float = 120, fast_remote: bool = False) -> dict:
    """Probe a video's first video stream (and first audio stream, if any).

    `source` is a local path or URL, or the file's raw bytes (piped to stdin).
    `fast_remote` caps ffprobe's analysis for a presigned URL (R2 range reads).

    Returns width, height, fps (float), fps_str (the exact r_frame_rate
    fraction), avg_fps_str (avg_frame_rate fraction, or None when unknown),
    duration (container, or None), stream_duration (video stream, or None),
    frame_count (nb_frames, or None), codec, plus the raw video_stream,
    audio_stream (or None) and format dicts for callers needing more fields.

    Raises VideoProbeError when the source can't be read or has no video
    stream with a size and frame rate.
    """
    from_stdin = isinstance(source, bytes)
    cmd = ["ffprobe", "-v", "error"]
    if fast_remote:
        cmd += ["-analyzeduration", "500000", "-probesize", "5000000"]
    cmd += ["-show_streams", "-show_format", "-of", "json", "-" if from_stdin else source]
    label = "<bytes>" if from_stdin else source.split("?")[0]
    try:
        result = subprocess.run(
            cmd, input=source if from_stdin else None, capture_output=True, timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise VideoProbeError(f"ffprobe could not run on {label}: {e}") from e
    if result.returncode != 0:
        raise VideoProbeError(
            f"ffprobe failed on {label}: {result.stderr.decode(errors='replace')[:300]}"
        )
    try:
        data = json.loads(result.stdout)
    except ValueError as e:
        raise VideoProbeError(f"ffprobe returned unreadable output for {label}") from e

    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None:
        raise VideoProbeError(f"no video stream in {label}")
    if not video.get("width") or not video.get("height"):
        raise VideoProbeError(f"video stream in {label} has no size")
    fps_str = video.get("r_frame_rate")
    fps = parse_frame_rate(fps_str)

    fmt = data.get("format") or {}
    return {
        "width": int(video["width"]),
        "height": int(video["height"]),
        "fps": fps,
        "fps_str": fps_str,
        "avg_fps_str": _valid_rate(video.get("avg_frame_rate")),
        "duration": float(fmt["duration"]) if fmt.get("duration") else None,
        "stream_duration": float(video["duration"]) if video.get("duration") else None,
        "frame_count": int(video["nb_frames"]) if video.get("nb_frames") else None,
        "codec": video.get("codec_name"),
        "video_stream": video,
        "audio_stream": audio,
        "format": fmt,
    }


def probe_r2_video(s3_client, bucket: str, key: str) -> dict | None:
    """
    Probe a video in R2 via presigned URL + ffprobe. ffprobe natively uses HTTP
    byte-range requests, pulling only the bytes it needs (moov atom + a handful
    of samples) — far more reliable than pre-fetching a fixed prefix, which
    often fails because ffprobe needs to cross-reference moov and mdat offsets.

    Returns {width, height, fps, duration}, or None when R2 or the probe fails
    (an external dependency; logged, callers decide).
    """
    try:
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=300,
        )
        info = probe_video(url, fast_remote=True)
    except Exception as e:
        logger.warning(f"[video_probe] probe_r2_video failed for {key}: {e}")
        return None
    return {k: info[k] for k in ("width", "height", "fps", "duration")}
