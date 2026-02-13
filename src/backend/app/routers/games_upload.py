"""
Game Upload endpoints for Video Editor API (T80).

This router handles deduplicated game uploads:
- POST /api/games/prepare-upload - Check if upload needed, get presigned URLs
- POST /api/games/finalize-upload - Complete multipart upload

Games are stored globally in R2 at games/{blake3_hash}.mp4 for deduplication.
Users link to games via the user_games table.
"""

import re
import uuid
import logging
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel, Field

from app.database import get_db_connection
from app.storage import (
    R2_ENABLED,
    r2_global_key,
    r2_head_object_global,
    r2_delete_object_global,
    r2_create_multipart_upload,
    r2_complete_multipart_upload,
    r2_abort_multipart_upload,
    r2_get_object_metadata_global,
    r2_set_object_metadata_global,
    increment_ref_count,
    decrement_ref_count,
    generate_multipart_urls,
    generate_presigned_url_global,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games-upload"])

# BLAKE3 hash is 64 hex characters (256 bits)
BLAKE3_PATTERN = re.compile(r'^[a-f0-9]{64}$')

# Maximum file size: 10GB (R2 limit is 5TB, but practical limit for video)
MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024  # 10GB

# Part size for multipart uploads
PART_SIZE = 100 * 1024 * 1024  # 100MB


def validate_blake3_hash(hash_value: str) -> bool:
    """Validate that a string is a valid BLAKE3 hash (64 hex chars)."""
    return bool(BLAKE3_PATTERN.match(hash_value.lower()))


def validate_file_size(size: int) -> bool:
    """Validate file size is within acceptable range."""
    return 0 < size <= MAX_FILE_SIZE


# ==============================================================================
# Request/Response Models
# ==============================================================================

class PrepareUploadRequest(BaseModel):
    blake3_hash: str = Field(..., description="BLAKE3 hash of the file (64 hex chars)")
    file_size: int = Field(..., description="File size in bytes")
    original_filename: str = Field(..., description="Original filename")


class PartInfo(BaseModel):
    part_number: int
    etag: str


class FinalizeUploadRequest(BaseModel):
    upload_session_id: str = Field(..., description="Session ID from prepare-upload")
    parts: List[PartInfo] = Field(..., description="List of uploaded parts with ETags")


# ==============================================================================
# Endpoints
# ==============================================================================

@router.post("/prepare-upload")
async def prepare_upload(request: PrepareUploadRequest):
    """
    Prepare a game upload. Returns one of:
    - already_owned: User already has this game
    - linked: Game exists globally, linked to user's account
    - upload_required: Game doesn't exist, presigned URLs provided

    This endpoint enables deduplication: if the same game exists globally,
    the user gets linked to it without re-uploading.
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage not enabled. Multipart upload requires R2."
        )

    # Validate inputs
    blake3_hash = request.blake3_hash.lower()
    if not validate_blake3_hash(blake3_hash):
        raise HTTPException(
            status_code=400,
            detail="Invalid BLAKE3 hash format. Expected 64 hex characters."
        )

    if not validate_file_size(request.file_size):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file size. Must be between 1 byte and {MAX_FILE_SIZE // (1024**3)}GB."
        )

    r2_key = f"games/{blake3_hash}.mp4"

    # Check if game already exists in R2
    head_result = r2_head_object_global(r2_key)

    if head_result:
        # Game exists globally - check if user already has it
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM user_games WHERE blake3_hash = ?",
                (blake3_hash,)
            )
            existing = cursor.fetchone()

            if existing:
                # User already owns this game
                logger.info(f"Game already owned: {blake3_hash}")
                return {
                    "status": "already_owned",
                    "game_id": existing['id']
                }

            # Link game to user's account
            metadata = head_result.get('Metadata', {})

            # Get video metadata from R2 object
            duration = None
            width = None
            height = None
            fps = None
            try:
                duration = float(metadata.get('duration', 0)) or None
                width = int(metadata.get('width', 0)) or None
                height = int(metadata.get('height', 0)) or None
                fps = float(metadata.get('fps', 0)) or None
            except (ValueError, TypeError):
                pass

            cursor.execute("""
                INSERT INTO user_games (
                    blake3_hash, original_filename, file_size,
                    duration, width, height, fps
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                blake3_hash,
                request.original_filename,
                request.file_size,
                duration,
                width,
                height,
                fps
            ))
            conn.commit()
            game_id = cursor.lastrowid

            # Increment ref_count
            increment_ref_count(r2_key)

            logger.info(f"Linked existing game to user: {blake3_hash}, game_id: {game_id}")
            return {
                "status": "linked",
                "game_id": game_id,
                "message": "Game already exists, linked to your account"
            }

    # Game doesn't exist - create multipart upload
    upload_id = r2_create_multipart_upload(r2_key)
    if not upload_id:
        raise HTTPException(
            status_code=500,
            detail="Failed to initiate multipart upload"
        )

    # Generate session ID
    session_id = f"upload_{uuid.uuid4().hex}"

    # Store pending upload in user's database
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO pending_uploads (
                id, blake3_hash, file_size, original_filename, r2_upload_id
            )
            VALUES (?, ?, ?, ?, ?)
        """, (
            session_id,
            blake3_hash,
            request.file_size,
            request.original_filename,
            upload_id
        ))
        conn.commit()

    # Generate presigned URLs for all parts (4 hour expiry)
    parts = generate_multipart_urls(
        key=r2_key,
        upload_id=upload_id,
        file_size=request.file_size,
        part_size=PART_SIZE,
        expires_in=14400  # 4 hours
    )

    logger.info(
        f"Prepared multipart upload: {blake3_hash}, "
        f"session: {session_id}, parts: {len(parts)}"
    )

    return {
        "status": "upload_required",
        "upload_session_id": session_id,
        "parts": parts
    }


@router.post("/finalize-upload")
async def finalize_upload(request: FinalizeUploadRequest):
    """
    Complete a multipart upload after all parts have been uploaded.

    Verifies the upload, sets metadata, and links the game to the user.
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage not enabled"
        )

    session_id = request.upload_session_id

    # Get pending upload from database
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM pending_uploads WHERE id = ?",
            (session_id,)
        )
        pending = cursor.fetchone()

        if not pending:
            raise HTTPException(
                status_code=404,
                detail="Upload session not found"
            )

        blake3_hash = pending['blake3_hash']
        r2_key = f"games/{blake3_hash}.mp4"
        r2_upload_id = pending['r2_upload_id']

        # Convert parts to R2 format
        r2_parts = [
            {'PartNumber': p.part_number, 'ETag': p.etag}
            for p in request.parts
        ]

        # Complete multipart upload
        if not r2_complete_multipart_upload(r2_key, r2_upload_id, r2_parts):
            # Attempt to abort the upload to clean up
            r2_abort_multipart_upload(r2_key, r2_upload_id)
            raise HTTPException(
                status_code=500,
                detail="Failed to complete multipart upload"
            )

        # Verify file size matches
        head_result = r2_head_object_global(r2_key)
        if not head_result:
            raise HTTPException(
                status_code=500,
                detail="Upload completed but object not found"
            )

        actual_size = head_result.get('ContentLength', 0)
        expected_size = pending['file_size']

        if actual_size != expected_size:
            logger.error(
                f"Size mismatch for {blake3_hash}: "
                f"expected {expected_size}, got {actual_size}"
            )
            # Don't delete - let admin investigate
            raise HTTPException(
                status_code=400,
                detail=f"File size mismatch: expected {expected_size}, got {actual_size}"
            )

        # Set initial metadata (ref_count = 1)
        # Video metadata will be extracted asynchronously or by frontend
        initial_metadata = {
            'ref_count': '1',
            'original_filename': pending['original_filename'],
            'created_at': datetime.utcnow().isoformat() + 'Z'
        }

        r2_set_object_metadata_global(r2_key, initial_metadata)

        # Insert into user_games
        cursor.execute("""
            INSERT INTO user_games (
                blake3_hash, original_filename, file_size
            )
            VALUES (?, ?, ?)
        """, (
            blake3_hash,
            pending['original_filename'],
            pending['file_size']
        ))
        conn.commit()
        game_id = cursor.lastrowid

        # Delete pending upload record
        cursor.execute(
            "DELETE FROM pending_uploads WHERE id = ?",
            (session_id,)
        )
        conn.commit()

        logger.info(
            f"Finalized upload: {blake3_hash}, game_id: {game_id}, "
            f"size: {actual_size / (1024*1024):.1f}MB"
        )

        return {
            "status": "success",
            "game_id": game_id,
            "blake3_hash": blake3_hash,
            "file_size": actual_size
        }


@router.delete("/upload/{session_id}")
async def cancel_upload(session_id: str):
    """
    Cancel an in-progress upload and clean up R2 multipart upload.
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage not enabled"
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT blake3_hash, r2_upload_id FROM pending_uploads WHERE id = ?",
            (session_id,)
        )
        pending = cursor.fetchone()

        if not pending:
            raise HTTPException(
                status_code=404,
                detail="Upload session not found"
            )

        r2_key = f"games/{pending['blake3_hash']}.mp4"

        # Abort multipart upload in R2
        r2_abort_multipart_upload(r2_key, pending['r2_upload_id'])

        # Delete from database
        cursor.execute(
            "DELETE FROM pending_uploads WHERE id = ?",
            (session_id,)
        )
        conn.commit()

        logger.info(f"Cancelled upload: {session_id}")

        return {"status": "cancelled"}


@router.get("/dedupe/{game_id}/url")
async def get_dedupe_game_url(game_id: int):
    """
    Get a presigned URL for a deduplicated game video.

    This endpoint is for the new global game storage (user_games table).
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage not enabled"
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT blake3_hash FROM user_games WHERE id = ?",
            (game_id,)
        )
        game = cursor.fetchone()

        if not game:
            raise HTTPException(
                status_code=404,
                detail="Game not found"
            )

        r2_key = f"games/{game['blake3_hash']}.mp4"
        url = generate_presigned_url_global(r2_key, expires_in=14400)

        if not url:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate presigned URL"
            )

        return {"url": url}


@router.delete("/dedupe/{game_id}")
async def delete_dedupe_game(game_id: int):
    """
    Delete a deduplicated game from user's library.

    This decrements the ref_count on the global game object.
    When ref_count reaches 0, the actual R2 object is deleted.
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage not enabled"
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT blake3_hash FROM user_games WHERE id = ?",
            (game_id,)
        )
        game = cursor.fetchone()

        if not game:
            raise HTTPException(
                status_code=404,
                detail="Game not found"
            )

        blake3_hash = game['blake3_hash']
        r2_key = f"games/{blake3_hash}.mp4"

        # Decrement ref_count
        new_count = decrement_ref_count(r2_key)

        # If ref_count is 0, delete the actual file
        if new_count == 0:
            r2_delete_object_global(r2_key)
            logger.info(f"Deleted global game object (ref_count=0): {blake3_hash}")

        # Remove from user's library
        cursor.execute(
            "DELETE FROM user_games WHERE id = ?",
            (game_id,)
        )
        conn.commit()

        logger.info(
            f"Removed game from user library: game_id={game_id}, "
            f"hash={blake3_hash}, new_ref_count={new_count}"
        )

        return {
            "status": "deleted",
            "game_id": game_id,
            "ref_count_remaining": max(0, new_count)
        }


@router.get("/dedupe")
async def list_dedupe_games():
    """
    List all deduplicated games in user's library.

    Returns games from the user_games table (new global dedup storage).
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, blake3_hash, original_filename, display_name,
                   file_size, duration, width, height, fps, added_at
            FROM user_games
            ORDER BY added_at DESC
        """)
        rows = cursor.fetchall()

        games = []
        for row in rows:
            # Generate presigned URL if R2 is enabled
            video_url = None
            if R2_ENABLED:
                r2_key = f"games/{row['blake3_hash']}.mp4"
                video_url = generate_presigned_url_global(r2_key, expires_in=14400)

            games.append({
                'id': row['id'],
                'blake3_hash': row['blake3_hash'],
                'name': row['display_name'] or row['original_filename'],
                'original_filename': row['original_filename'],
                'file_size': row['file_size'],
                'duration': row['duration'],
                'width': row['width'],
                'height': row['height'],
                'fps': row['fps'],
                'video_url': video_url,
                'added_at': row['added_at']
            })

        return {'games': games}
