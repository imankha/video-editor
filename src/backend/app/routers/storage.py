"""
Storage API Router - Presigned URL generation for R2 direct access.

Provides endpoints for generating presigned URLs that allow the frontend
to access files directly from R2 without proxying through the backend.
This reduces latency and backend bandwidth usage for video streaming.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import mimetypes

from ..user_context import get_current_user_id
from ..storage import (
    R2_ENABLED,
    generate_presigned_url,
    generate_presigned_upload_url,
    file_exists_in_r2,
)

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
    - Game videos (source footage)
    - Final videos (exported results)
    - Working videos (intermediate exports)

    Call this on user login/app init to warm Cloudflare edge cache.
    First access to R2 can be slow (cold cache), but subsequent
    accesses are fast. Pre-warming ensures videos load quickly.

    Returns:
        {"urls": [url1, url2, ...], "count": N}
    """
    if not R2_ENABLED:
        return {"urls": [], "count": 0, "r2_enabled": False}

    from ..database import get_db_connection

    user_id = get_current_user_id()
    urls = []

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Game videos
        cursor.execute("""
            SELECT video_filename FROM games
            WHERE video_filename IS NOT NULL AND video_filename != ''
        """)
        for row in cursor.fetchall():
            url = generate_presigned_url(
                user_id=user_id,
                relative_path=f"games/{row['video_filename']}",
                expires_in=expires_in,
                content_type="video/mp4"
            )
            if url:
                urls.append(url)

        # Final videos (gallery)
        cursor.execute("""
            SELECT filename FROM final_videos
            WHERE filename IS NOT NULL AND filename != ''
        """)
        for row in cursor.fetchall():
            url = generate_presigned_url(
                user_id=user_id,
                relative_path=f"final_videos/{row['filename']}",
                expires_in=expires_in,
                content_type="video/mp4"
            )
            if url:
                urls.append(url)

        # Working videos (intermediate exports)
        cursor.execute("""
            SELECT filename FROM working_videos
            WHERE filename IS NOT NULL AND filename != ''
        """)
        for row in cursor.fetchall():
            url = generate_presigned_url(
                user_id=user_id,
                relative_path=f"working_videos/{row['filename']}",
                expires_in=expires_in,
                content_type="video/mp4"
            )
            if url:
                urls.append(url)

    return {
        "urls": urls,
        "count": len(urls),
        "r2_enabled": True
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
