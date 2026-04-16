"""
Storage API Router - Presigned URL generation for R2 direct access.

Provides endpoints for generating presigned URLs that allow the frontend
to access files directly from R2 without proxying through the backend.
This reduces latency and backend bandwidth usage for video streaming.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import logging
import mimetypes

logger = logging.getLogger(__name__)

from ..user_context import get_current_user_id
from ..storage import (
    R2_ENABLED,
    generate_presigned_url,
    generate_presigned_url_global,
    generate_presigned_upload_url,
    file_exists_in_r2,
)
from ..queries import latest_working_clips_subquery

router = APIRouter(prefix="/storage", tags=["storage"])


class PresignedUrlResponse(BaseModel):
    """Response containing a presigned URL."""
    url: str
    expires_in: int
    r2_enabled: bool = True


class PresignedUrlRequest(BaseModel):
    """Request for generating a presigned URL."""
    path: str
    expires_in: int = 3600


class BatchPresignedUrlRequest(BaseModel):
    """Request for generating multiple presigned URLs."""
    paths: List[str]
    expires_in: int = 3600


class BatchPresignedUrlResponse(BaseModel):
    """Response containing multiple presigned URLs."""
    urls: dict  # path -> url mapping
    r2_enabled: bool = True


def get_content_type(path: str) -> Optional[str]:
    """Guess content type from file path."""
    content_type, _ = mimetypes.guess_type(path)
    return content_type


@router.get("/status")
async def storage_status():
    """Check if R2 storage is enabled."""
    return {
        "r2_enabled": R2_ENABLED,
        "mode": "r2" if R2_ENABLED else "local"
    }


@router.get("/url/{file_type}/{filename:path}")
async def get_presigned_url(
    file_type: str,
    filename: str,
    expires_in: int = Query(default=3600, ge=60, le=86400)
) -> PresignedUrlResponse:
    """
    Generate a presigned URL for accessing a file from R2.

    Args:
        file_type: Type of file (games, raw_clips, working_videos, final_videos, highlights)
        filename: Name of the file within that directory
        expires_in: URL expiration time in seconds (default 1 hour, max 24 hours)

    Returns:
        PresignedUrlResponse with the presigned URL

    Example:
        GET /storage/url/games/abc123.mp4
        GET /storage/url/highlights/player_1.png?expires_in=7200
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage is not enabled. Use local file endpoints instead."
        )

    user_id = get_current_user_id()

    # Validate file_type
    valid_types = {"games", "raw_clips", "working_videos", "final_videos", "highlights", "downloads"}
    if file_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Must be one of: {', '.join(valid_types)}"
        )

    # Construct the relative path
    relative_path = f"{file_type}/{filename}"

    # Get content type for proper browser handling
    content_type = get_content_type(filename)

    # Generate presigned URL
    url = generate_presigned_url(
        user_id=user_id,
        relative_path=relative_path,
        expires_in=expires_in,
        content_type=content_type
    )

    if not url:
        raise HTTPException(
            status_code=500,
            detail="Failed to generate presigned URL"
        )

    return PresignedUrlResponse(
        url=url,
        expires_in=expires_in
    )


@router.post("/urls/batch")
async def get_batch_presigned_urls(
    request: BatchPresignedUrlRequest
) -> BatchPresignedUrlResponse:
    """
    Generate multiple presigned URLs in one request.

    Useful for loading a page with multiple videos/images.

    Args:
        request: BatchPresignedUrlRequest with list of paths

    Returns:
        BatchPresignedUrlResponse with url mapping

    Example body:
        {
            "paths": ["games/abc.mp4", "highlights/player.png"],
            "expires_in": 3600
        }
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage is not enabled"
        )

    user_id = get_current_user_id()
    urls = {}

    for path in request.paths:
        content_type = get_content_type(path)
        url = generate_presigned_url(
            user_id=user_id,
            relative_path=path,
            expires_in=request.expires_in,
            content_type=content_type
        )
        if url:
            urls[path] = url

    return BatchPresignedUrlResponse(
        urls=urls
    )


@router.get("/exists/{file_type}/{filename:path}")
async def check_file_exists(file_type: str, filename: str) -> dict:
    """
    Check if a file exists in R2 storage.

    Args:
        file_type: Type of file (games, raw_clips, etc.)
        filename: Name of the file

    Returns:
        {"exists": bool, "r2_enabled": bool}
    """
    if not R2_ENABLED:
        return {"exists": False, "r2_enabled": False}

    user_id = get_current_user_id()
    relative_path = f"{file_type}/{filename}"

    exists = file_exists_in_r2(user_id, relative_path)

    return {"exists": exists, "r2_enabled": True}


@router.get("/warmup")
async def get_warmup_urls(
    expires_in: int = Query(default=3600, ge=60, le=86400)
) -> dict:
    """
    Get all video URLs for the current user to pre-warm CDN cache.

    Returns presigned URLs for:
    - Game videos (source footage) - includes size for tail warming
    - Final videos (exported results)
    - Working videos (intermediate exports)

    Call this on user login/app init to warm Cloudflare edge cache.
    First access to R2 can be slow (cold cache), but subsequent
    accesses are fast. Pre-warming ensures videos load quickly.

    For large game videos, the frontend should warm BOTH the start
    AND the end of the file (where moov atom often lives for non-faststart MP4s).

    Returns:
        {"urls": [url1, url2, ...], "count": N}
    """
    if not R2_ENABLED:
        return {"urls": [], "count": 0, "r2_enabled": False}

    from ..database import get_db_connection

    user_id = get_current_user_id()
    gallery_urls = []
    game_urls = []
    working_urls = []

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Gallery videos (final_videos) - most recent first
        cursor.execute("""
            SELECT filename FROM final_videos
            WHERE filename IS NOT NULL AND filename != ''
            ORDER BY created_at DESC
        """)
        for row in cursor.fetchall():
            url = generate_presigned_url(
                user_id=user_id,
                relative_path=f"final_videos/{row['filename']}",
                expires_in=expires_in,
                content_type="video/mp4"
            )
            if url:
                gallery_urls.append(url)

        # Game videos - use blake3_hash (global) or video_filename (legacy).
        # Multi-video games (T1440) have games.blake3_hash=NULL and live in game_videos.
        # UNION both so warmup covers all source videos.
        cursor.execute("""
            SELECT blake3_hash, video_filename, video_size FROM games
            WHERE blake3_hash IS NOT NULL OR video_filename IS NOT NULL
            UNION
            SELECT gv.blake3_hash, NULL AS video_filename, gv.video_size
            FROM game_videos gv
            WHERE gv.blake3_hash IS NOT NULL
        """)
        for row in cursor.fetchall():
            if row['blake3_hash']:
                # New global storage
                url = generate_presigned_url_global(
                    f"games/{row['blake3_hash']}.mp4",
                    expires_in=expires_in
                )
            elif row['video_filename']:
                # Legacy per-user storage
                url = generate_presigned_url(
                    user_id=user_id,
                    relative_path=f"games/{row['video_filename']}",
                    expires_in=expires_in,
                    content_type="video/mp4"
                )
            else:
                url = None
            if url:
                # Include size so frontend can warm the tail for large videos
                game_urls.append({
                    "url": url,
                    "size": row['video_size']
                })

        # Working videos only for incomplete projects. Returns the same-origin
        # proxy URL the player will use (see projects.get_working_video_url),
        # so the warmer warms the same path the foreground load takes.
        cursor.execute("""
            SELECT p.id AS project_id, wv.filename
            FROM working_videos wv
            JOIN projects p ON p.working_video_id = wv.id
            WHERE wv.filename IS NOT NULL AND wv.filename != ''
            AND p.final_video_id IS NULL
        """)
        for row in cursor.fetchall():
            working_urls.append(f"/api/projects/{row['project_id']}/working_video/stream")

        # Project clips for tier-1 warmup: incomplete projects with their clip ranges
        cursor.execute(f"""
            SELECT p.id as project_id,
                   p.working_video_id,
                   wv.filename as working_video_filename,
                   wc.id as clip_id,
                   rc.start_time,
                   rc.end_time,
                   rc.game_id,
                   rc.video_sequence,
                   COALESCE(gv.blake3_hash, g.blake3_hash) AS blake3_hash,
                   g.video_filename,
                   COALESCE(gv.duration, g.video_duration) AS video_duration,
                   COALESCE(gv.video_size, g.video_size) AS video_size
            FROM projects p
            LEFT JOIN working_videos wv ON p.working_video_id = wv.id
            JOIN working_clips wc ON wc.project_id = p.id
            JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            JOIN games g ON rc.game_id = g.id
            LEFT JOIN game_videos gv ON rc.game_id = gv.game_id AND rc.video_sequence = gv.sequence
            WHERE p.final_video_id IS NULL
              AND wc.id IN ({latest_working_clips_subquery(project_filter=False)})
            ORDER BY p.id, wc.sort_order
        """)

        # Group rows by project
        project_map = {}
        for row in cursor.fetchall():
            pid = row['project_id']
            if pid not in project_map:
                has_wv = row['working_video_id'] is not None
                # The frontend warms whatever URL it will later play. Working
                # videos play through the same-origin proxy (see
                # projects.get_working_video_url for why), so we hand the
                # warmer the proxy URL too. The proxy fetches R2 on the
                # backend, which warms R2's edge cache as a side effect.
                wv_url = (
                    f"/api/projects/{pid}/working_video/stream"
                    if has_wv and row['working_video_filename']
                    else None
                )
                project_map[pid] = {
                    "project_id": pid,
                    "has_working_video": has_wv,
                    "working_video_url": wv_url,
                    "clips": [],
                }

            # Only include clip ranges for projects without a working video
            if not project_map[pid]["has_working_video"]:
                if row['game_id'] and not row['blake3_hash']:
                    logger.warning(
                        f"[warmup] Clip {row['clip_id']} references game_id={row['game_id']} but "
                        f"game_videos has no row for video_sequence={row['video_sequence']} — skipping warmup"
                    )
                # Generate presigned URL for the game video
                if row['blake3_hash']:
                    game_url = generate_presigned_url_global(
                        f"games/{row['blake3_hash']}.mp4",
                        expires_in=expires_in
                    )
                elif row['video_filename']:
                    game_url = generate_presigned_url(
                        user_id=user_id,
                        relative_path=f"games/{row['video_filename']}",
                        expires_in=expires_in,
                        content_type="video/mp4"
                    )
                else:
                    game_url = None

                if game_url:
                    project_map[pid]["clips"].append({
                        "id": row['clip_id'],
                        "game_url": game_url,
                        "start_time": row['start_time'],
                        "end_time": row['end_time'],
                        "video_duration": row['video_duration'],
                        "video_size": row['video_size'],
                    })

        project_clips = list(project_map.values())

    # Combined list for backwards compatibility (flatten game_urls)
    flat_game_urls = [g['url'] if isinstance(g, dict) else g for g in game_urls]
    urls = gallery_urls + flat_game_urls + working_urls

    return {
        "urls": urls,
        "count": len(urls),
        "r2_enabled": True,
        "project_clips": project_clips,
        "gallery_urls": gallery_urls,
        "game_urls": game_urls,  # Now includes {url, size} for tail warming
        "working_urls": working_urls,
    }


@router.get("/upload-url/{file_type}/{filename:path}")
async def get_upload_url(
    file_type: str,
    filename: str,
    content_type: Optional[str] = Query(default=None),
    expires_in: int = Query(default=3600, ge=60, le=86400)
) -> PresignedUrlResponse:
    """
    Generate a presigned URL for uploading a file directly to R2.

    The frontend can use this URL with a PUT request to upload directly.

    Args:
        file_type: Type of file (games, raw_clips, etc.)
        filename: Name of the file
        content_type: MIME type of the file being uploaded
        expires_in: URL expiration time in seconds

    Returns:
        PresignedUrlResponse with the presigned upload URL
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage is not enabled"
        )

    user_id = get_current_user_id()

    valid_types = {"games", "raw_clips", "working_videos", "final_videos", "highlights", "uploads"}
    if file_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Must be one of: {', '.join(valid_types)}"
        )

    relative_path = f"{file_type}/{filename}"

    # Use provided content type or guess from filename
    if not content_type:
        content_type = get_content_type(filename)

    url = generate_presigned_upload_url(
        user_id=user_id,
        relative_path=relative_path,
        expires_in=expires_in,
        content_type=content_type
    )

    if not url:
        raise HTTPException(
            status_code=500,
            detail="Failed to generate presigned upload URL"
        )

    return PresignedUrlResponse(
        url=url,
        expires_in=expires_in
    )
