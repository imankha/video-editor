"""
Veo server-to-server video import.

Resolves a Veo match URL to a direct CDN download URL, then streams the
MP4 to R2 via multipart upload while computing the blake3 hash on-the-fly.
"""

import asyncio
import re
import logging
from dataclasses import dataclass
from typing import Optional

import blake3
import httpx

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

VEO_URL_PATTERN = re.compile(
    r"https?://app\.veo\.co/matches/([^/?#]+)"
)

OG_IMAGE_PATTERN = re.compile(
    r'<meta\s+(?:property="og:image"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:image")',
    re.IGNORECASE,
)

OG_TITLE_PATTERN = re.compile(
    r'<meta\s+(?:property="og:title"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:title")',
    re.IGNORECASE,
)

PART_SIZE = 100 * 1024 * 1024  # 100MB per part


@dataclass
class VeoVideoInfo:
    download_url: str
    file_size: int
    title: Optional[str] = None


class VeoImportError(Exception):
    """Raised when Veo import fails at any step."""
    pass


def parse_veo_url(url: str) -> str:
    """Extract match slug from a Veo URL.

    Raises VeoImportError if the URL doesn't match expected format.
    """
    match = VEO_URL_PATTERN.match(url.strip().rstrip("/") + "/")
    if not match:
        raise VeoImportError(
            "Invalid Veo URL. Expected format: https://app.veo.co/matches/<match-id>/"
        )
    return match.group(1)


async def resolve_veo_download_url(url: str) -> VeoVideoInfo:
    """Fetch Veo match page and resolve the CDN download URL.

    Steps:
    1. GET match page (public, no auth)
    2. Extract og:image meta tag
    3. Transform: c.veocdn.com → download.veocdn.com, thumbnail.jpg → video.mp4
    4. HEAD the download URL to get Content-Length

    Raises VeoImportError on failure.
    """
    parse_veo_url(url)

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        follow_redirects=True,
    ) as client:
        # Fetch match page
        try:
            resp = await client.get(url)
        except httpx.HTTPError as e:
            raise VeoImportError(f"Failed to fetch Veo match page: {e}")

        if resp.status_code == 404:
            raise VeoImportError("Veo match not found (404). The link may be invalid or deleted.")
        if resp.status_code == 403:
            raise VeoImportError("Veo match is private (403). Only public matches can be imported.")
        if resp.status_code != 200:
            raise VeoImportError(f"Veo returned unexpected status {resp.status_code}")

        html = resp.text

        # Extract og:image
        og_match = OG_IMAGE_PATTERN.search(html)
        if not og_match:
            raise VeoImportError(
                "Could not find video on this Veo page. "
                "The match may be private or the page structure has changed."
            )
        og_image_url = og_match.group(1) or og_match.group(2)

        # Extract og:title for auto-fill
        title = None
        title_match = OG_TITLE_PATTERN.search(html)
        if title_match:
            title = title_match.group(1) or title_match.group(2)

        # Transform to download URL
        download_url = og_image_url.replace("c.veocdn.com", "download.veocdn.com")
        download_url = re.sub(r"/thumbnail\.\w+$", "/video.mp4", download_url)

        # SSRF guard: only allow veocdn.com domains
        from urllib.parse import urlparse
        parsed = urlparse(download_url)
        if not parsed.hostname or not parsed.hostname.endswith(".veocdn.com"):
            raise VeoImportError(
                f"Unexpected CDN domain: {parsed.hostname}. Expected *.veocdn.com"
            )

        # Verify download URL with HEAD
        try:
            head_resp = await client.head(download_url)
        except httpx.HTTPError as e:
            raise VeoImportError(f"Failed to verify download URL: {e}")

        if head_resp.status_code != 200:
            raise VeoImportError(
                f"Veo CDN returned {head_resp.status_code} for download URL. "
                "The video may no longer be available."
            )

        content_length = int(head_resp.headers.get("content-length", 0))
        if content_length == 0:
            raise VeoImportError("Veo CDN returned 0 content-length. Cannot determine file size.")

        content_type = head_resp.headers.get("content-type", "")
        if "video" not in content_type and "octet-stream" not in content_type:
            raise VeoImportError(
                f"Expected video content-type, got: {content_type}"
            )

    return VeoVideoInfo(
        download_url=download_url,
        file_size=content_length,
        title=title,
    )


async def stream_to_r2(
    download_url: str,
    r2_key: str,
    expected_size: int,
    max_bytes: Optional[int] = None,
) -> str:
    """Stream video from URL directly to R2 via multipart upload.

    Downloads in chunks, uploads each 100MB part to R2, and computes
    blake3 hash on-the-fly. Never buffers the full file in memory.

    Args:
        download_url: Direct URL to the video file
        r2_key: R2 object key (e.g. "games/{hash}.mp4")
        expected_size: Expected file size from HEAD (for progress tracking)
        max_bytes: Optional cap on bytes to download (for testing)

    Returns:
        blake3 hash hex string of the downloaded content

    Raises VeoImportError on failure.
    """
    if not R2_ENABLED:
        raise VeoImportError("R2 storage is not enabled")

    client = get_r2_transfer_client()
    if not client:
        raise VeoImportError("R2 client not available")

    full_key = r2_global_key(r2_key)
    upload_id = r2_create_multipart_upload(full_key)
    if not upload_id:
        raise VeoImportError("Failed to create multipart upload in R2")

    hasher = blake3.blake3()
    parts = []
    part_number = 1
    buffer = bytearray()
    total_bytes = 0

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(300.0, connect=10.0),
        ) as http_client:
            async with http_client.stream("GET", download_url) as resp:
                if resp.status_code != 200:
                    raise VeoImportError(
                        f"Download failed with status {resp.status_code}"
                    )

                async for chunk in resp.aiter_bytes(chunk_size=1024 * 1024):
                    buffer.extend(chunk)
                    hasher.update(chunk)
                    total_bytes += len(chunk)

                    if max_bytes and total_bytes >= max_bytes:
                        break

                    # Upload part when buffer reaches PART_SIZE
                    while len(buffer) >= PART_SIZE:
                        part_data = bytes(buffer[:PART_SIZE])
                        buffer = bytearray(buffer[PART_SIZE:])

                        etag = await asyncio.to_thread(
                            _upload_part, client, full_key, upload_id, part_number, part_data
                        )
                        parts.append({"PartNumber": part_number, "ETag": etag})
                        part_number += 1

                        logger.info(
                            f"[veo_import] Uploaded part {part_number - 1}, "
                            f"{total_bytes / (1024*1024):.0f}MB / "
                            f"{expected_size / (1024*1024):.0f}MB"
                        )

        # Upload remaining buffer as final part
        if buffer:
            etag = await asyncio.to_thread(
                _upload_part, client, full_key, upload_id, part_number, bytes(buffer)
            )
            parts.append({"PartNumber": part_number, "ETag": etag})

        # Complete multipart upload
        success = await asyncio.to_thread(
            r2_complete_multipart_upload, full_key, upload_id, parts
        )
        if not success:
            raise VeoImportError("Failed to complete multipart upload")

        blake3_hash = hasher.hexdigest()
        logger.info(
            f"[veo_import] Upload complete: {r2_key}, "
            f"size={total_bytes / (1024*1024):.1f}MB, hash={blake3_hash[:16]}..."
        )
        return blake3_hash

    except VeoImportError:
        await asyncio.to_thread(r2_abort_multipart_upload, full_key, upload_id)
        raise
    except Exception as e:
        await asyncio.to_thread(r2_abort_multipart_upload, full_key, upload_id)
        raise VeoImportError(f"Stream to R2 failed: {e}") from e


def _upload_part(client, key: str, upload_id: str, part_number: int, data: bytes) -> str:
    """Upload a single part to R2 and return the ETag."""
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
