"""
Trace server-to-server video import.

Resolves a Trace game URL via their anonymous GraphQL API, discovers HLS
manifests for each half, remuxes to MP4 via ffmpeg, and uploads to R2.
"""

import re
import time
import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import blake3
import httpx

from app.services.ffmpeg_errors import run_ffmpeg, FFmpegError
from app.storage import (
    get_r2_transfer_client,
    r2_create_multipart_upload,
    r2_complete_multipart_upload,
    r2_abort_multipart_upload,
    r2_global_key,
    R2_BUCKET,
    R2_ENABLED,
)

logger = logging.getLogger(__name__)

TRACE_URL_PATTERN = re.compile(
    r"https?://go\.traceup\.com/traceid/athlete/([^/]+)/watch/(\d+)"
)

GRAPHQL_ENDPOINT = "https://go.traceup.com/traceid-prod/graphql"

PART_SIZE = 100 * 1024 * 1024  # 100MB per R2 multipart part

GAME_QUERY = """
query game($game_id: Int!, $hash_key: String!, $token: UserToken, $moment_id: Int, $gid: String) {
  game(game_id: $game_id, hash_key: $hash_key, token: $token, gid: $gid) {
    game_id
    base_path
    full_date
    sport_type
    home_team {
      title
      score
    }
    away_team {
      title
      score
    }
    moments(hash_key: $hash_key, moment_id: $moment_id, superfly: true) {
      type
      half
      base_path
      duration
      dynamic_hls
      storage_type
    }
  }
}
"""


@dataclass
class TraceGameRef:
    hash_key: str
    game_id: int


@dataclass
class TraceVideoInfo:
    half: int
    m3u8_url: str
    duration: Optional[float] = None
    base_path: str = ""


@dataclass
class TraceGameInfo:
    game_id: int
    videos: list[TraceVideoInfo] = field(default_factory=list)
    full_date: Optional[str] = None
    home_team: Optional[str] = None
    away_team: Optional[str] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    sport_type: Optional[str] = None


class TraceImportError(Exception):
    pass


def parse_trace_url(url: str) -> TraceGameRef:
    """Extract hash_key and game_id from a Trace URL."""
    match = TRACE_URL_PATTERN.match(url.strip())
    if not match:
        raise TraceImportError(
            "Invalid Trace URL. Expected format: "
            "https://go.traceup.com/traceid/athlete/{hash}/watch/{game_id}/..."
        )
    return TraceGameRef(hash_key=match.group(1), game_id=int(match.group(2)))


async def resolve_trace_videos(url: str) -> TraceGameInfo:
    """Query Trace GraphQL API to discover HLS video URLs for each half.

    Uses anonymous auth (user_id=0, empty token).
    Returns TraceGameInfo with video URLs and metadata.
    """
    ref = parse_trace_url(url)

    variables = {
        "game_id": ref.game_id,
        "hash_key": ref.hash_key,
        "token": {"user_id": 0, "token": "", "timestamp": int(time.time())},
        "moment_id": None,
        "gid": None,
    }

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
    ) as client:
        try:
            resp = await client.post(
                GRAPHQL_ENDPOINT,
                json={"query": GAME_QUERY, "variables": variables},
            )
        except httpx.HTTPError as e:
            raise TraceImportError(f"Failed to query Trace API: {e}")

        if resp.status_code != 200:
            raise TraceImportError(f"Trace API returned status {resp.status_code}")

        data = resp.json()

    if "errors" in data:
        raise TraceImportError(f"Trace GraphQL error: {data['errors']}")

    game = data.get("data", {}).get("game")
    if not game:
        raise TraceImportError(
            "Game not found. The link may be invalid or the game may be private."
        )

    moments = game.get("moments") or []

    # Filter: FullGameVideo moments, non-superfly (raw game footage)
    game_videos = [
        m for m in moments
        if m.get("type") == "FullGameVideo"
        and "superfly" not in (m.get("dynamic_hls") or "")
    ]

    if not game_videos:
        raise TraceImportError(
            "No game video found. The game may not have video uploaded yet."
        )

    # Build HLS URLs and sort by half
    videos = []
    for m in sorted(game_videos, key=lambda x: x.get("half", 0)):
        base = m.get("base_path", "")
        hls = m.get("dynamic_hls", "")
        if not base or not hls:
            continue

        # Master m3u8 URL
        master_url = f"https://go.traceup.com{base}{hls}"
        videos.append(TraceVideoInfo(
            half=m.get("half", 0),
            m3u8_url=master_url,
            duration=m.get("duration"),
            base_path=base,
        ))

    if not videos:
        raise TraceImportError("Could not construct video URLs from game data.")

    home = game.get("home_team") or {}
    away = game.get("away_team") or {}

    return TraceGameInfo(
        game_id=ref.game_id,
        videos=videos,
        full_date=game.get("full_date"),
        home_team=home.get("title"),
        away_team=away.get("title"),
        home_score=home.get("score"),
        away_score=away.get("score"),
        sport_type=game.get("sport_type"),
    )


async def resolve_best_variant(m3u8_url: str) -> str:
    """Fetch master m3u8 and return the highest-bitrate variant URL."""
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
    ) as client:
        try:
            resp = await client.get(m3u8_url)
        except httpx.HTTPError as e:
            raise TraceImportError(f"Failed to fetch HLS manifest: {e}")

        if resp.status_code != 200:
            raise TraceImportError(
                f"HLS manifest returned {resp.status_code}. Video may not be available."
            )

    lines = resp.text.strip().split("\n")
    variants = []
    for i, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF"):
            bw_match = re.search(r"BANDWIDTH=(\d+)", line)
            bandwidth = int(bw_match.group(1)) if bw_match else 0
            if i + 1 < len(lines) and not lines[i + 1].startswith("#"):
                variants.append((bandwidth, lines[i + 1].strip()))

    if not variants:
        raise TraceImportError("No variants found in HLS master manifest.")

    # Pick highest bandwidth (1080p)
    variants.sort(key=lambda x: x[0], reverse=True)
    variant_path = variants[0][1]

    # Variant path is relative to master m3u8 directory
    base = m3u8_url.rsplit("/", 1)[0]
    return f"{base}/{variant_path}"


def remux_hls_to_mp4(
    m3u8_url: str,
    output_path: str,
    max_segments: Optional[int] = None,
    timeout: int = 600,
) -> None:
    """Remux HLS stream to MP4 via ffmpeg (copy codec, no re-encode).

    Args:
        m3u8_url: URL to the variant m3u8 playlist
        output_path: Local path for the output MP4
        max_segments: Optional limit on segments to download (for testing)
        timeout: ffmpeg timeout in seconds (default 10 min)
    """
    cmd = [
        "ffmpeg", "-y",
        "-i", m3u8_url,
        "-c", "copy",
        "-movflags", "+faststart",
    ]

    if max_segments:
        # Estimate duration: ~2s per segment
        cmd.extend(["-t", str(max_segments * 2)])

    cmd.append(output_path)

    try:
        run_ffmpeg(cmd, timeout=timeout)
    except FFmpegError as e:
        raise TraceImportError(f"FFmpeg remux failed: {e.message}") from e


def upload_file_to_r2(local_path: str, r2_key: str) -> str:
    """Upload a local file to R2 via multipart upload, return blake3 hash.

    Reads the file in chunks to compute blake3 and upload parts.
    """
    if not R2_ENABLED:
        raise TraceImportError("R2 storage is not enabled")

    client = get_r2_transfer_client()
    if not client:
        raise TraceImportError("R2 client not available")

    file_path = Path(local_path)
    file_size = file_path.stat().st_size
    if file_size == 0:
        raise TraceImportError("Remuxed file is empty")

    full_key = r2_global_key(r2_key)
    upload_id = r2_create_multipart_upload(full_key)
    if not upload_id:
        raise TraceImportError("Failed to create multipart upload in R2")

    hasher = blake3.blake3()
    parts = []
    part_number = 1

    try:
        with open(local_path, "rb") as f:
            while True:
                data = f.read(PART_SIZE)
                if not data:
                    break
                hasher.update(data)
                etag = _upload_part(client, full_key, upload_id, part_number, data)
                parts.append({"PartNumber": part_number, "ETag": etag})
                logger.info(
                    f"[trace_import] Uploaded part {part_number}, "
                    f"{part_number * PART_SIZE / (1024*1024):.0f}MB / "
                    f"{file_size / (1024*1024):.0f}MB"
                )
                part_number += 1

        success = r2_complete_multipart_upload(full_key, upload_id, parts)
        if not success:
            raise TraceImportError("Failed to complete multipart upload")

        blake3_hash = hasher.hexdigest()
        logger.info(
            f"[trace_import] Upload complete: {r2_key}, "
            f"size={file_size / (1024*1024):.1f}MB, hash={blake3_hash[:16]}..."
        )
        return blake3_hash

    except TraceImportError:
        r2_abort_multipart_upload(full_key, upload_id)
        raise
    except Exception as e:
        r2_abort_multipart_upload(full_key, upload_id)
        raise TraceImportError(f"Upload to R2 failed: {e}") from e


def _upload_part(client, key: str, upload_id: str, part_number: int, data: bytes) -> str:
    from app.utils.retry import retry_r2_call, TIER_1

    response = retry_r2_call(
        client.upload_part,
        Bucket=R2_BUCKET,
        Key=key,
        UploadId=upload_id,
        PartNumber=part_number,
        Body=data,
        operation=f"upload_part {key} #{part_number}",
        **TIER_1,
    )
    return response["ETag"]
