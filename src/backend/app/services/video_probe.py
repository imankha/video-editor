"""
T1500: shared byte-range ffprobe helper.

Used by games upload (capture fps at upload time) and by the backfill script
(backfill existing game_videos rows). Fetches a small byte-range from R2,
pipes it to ffprobe via stdin, returns {width, height, fps} or None on failure.
"""
from __future__ import annotations

import json
import logging
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

HEAD_BYTES = 1024 * 1024   # 1 MB head fetch (moov for faststart MP4s)
TAIL_BYTES = 512 * 1024    # 512 KB tail fetch (moov-at-end fallback)


def ffprobe_bytes(data: bytes) -> Optional[dict]:
    """Probe a raw byte blob via ffprobe stdin. Returns width/height/fps or None."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=r_frame_rate,width,height",
                "-of", "json",
                "-",
            ],
            input=data,
            capture_output=True,
            timeout=60,
        )
        if result.returncode != 0:
            return None
        parsed = json.loads(result.stdout)
        stream = (parsed.get("streams") or [{}])[0]
        if not stream.get("width") or not stream.get("height"):
            return None
        fps_str = stream.get("r_frame_rate", "30/1")
        num, _, den = fps_str.partition("/")
        fps = float(num) / float(den) if den else float(num)
        return {
            "width": int(stream["width"]),
            "height": int(stream["height"]),
            "fps": fps,
        }
    except Exception as e:
        logger.warning(f"[video_probe] ffprobe failed: {e}")
        return None


def probe_r2_video(s3_client, bucket: str, key: str) -> Optional[dict]:
    """Byte-range fetch from R2 + ffprobe. Head first, tail fallback."""
    try:
        obj = s3_client.get_object(Bucket=bucket, Key=key, Range=f"bytes=0-{HEAD_BYTES - 1}")
        meta = ffprobe_bytes(obj["Body"].read())
        if meta:
            return meta
    except Exception as e:
        logger.warning(f"[video_probe] head range fetch failed for {key}: {e}")

    try:
        head = s3_client.head_object(Bucket=bucket, Key=key)
        size = head["ContentLength"]
        start = max(0, size - TAIL_BYTES)
        obj = s3_client.get_object(Bucket=bucket, Key=key, Range=f"bytes={start}-{size - 1}")
        return ffprobe_bytes(obj["Body"].read())
    except Exception as e:
        logger.warning(f"[video_probe] tail range fetch failed for {key}: {e}")
        return None
