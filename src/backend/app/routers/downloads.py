"""
Downloads API endpoints.

Provides access to final videos that have been exported from Overlay mode.
Users can list, download, and delete their final videos.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os
import re
import json
import logging

from app.database import get_db_connection, get_final_videos_path
from app.queries import latest_final_videos_subquery

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/downloads", tags=["downloads"])


class RatingCounts(BaseModel):
    """Rating counts for annotated games"""
    brilliant: int = 0   # Rating 5 (!!)
    good: int = 0        # Rating 4 (!)
    interesting: int = 0 # Rating 3 (!?)
    mistake: int = 0     # Rating 2 (?)
    blunder: int = 0     # Rating 1 (??)
    total: int = 0
    weighted_average: Optional[float] = None  # Weighted average rating


class DownloadItem(BaseModel):
    id: int
    project_id: int
    project_name: str
    filename: str
    created_at: str
    file_size: Optional[int]  # Size in bytes
    source_type: Optional[str]  # 'brilliant_clip' | 'custom_project' | 'annotated_game' | None
    game_id: Optional[int]  # For annotated_game exports, the source game ID
    rating_counts: Optional[RatingCounts] = None  # Rating breakdown for annotated games


class DownloadListResponse(BaseModel):
    downloads: List[DownloadItem]
    total_count: int


@router.get("", response_model=DownloadListResponse)
async def list_downloads(source_type: Optional[str] = None):
    """
    List all final videos with metadata.
    Returns videos grouped with project information.

    Args:
        source_type: Filter by source type ('brilliant_clip', 'custom_project', 'annotated_game')
                    If not provided, returns all videos.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Build query with optional source_type filter
        # LEFT JOIN to handle annotated exports (project_id = 0, no real project)
        # rating_counts is stored as JSON snapshot at export time (frozen, not live)
        # COALESCE uses fv.name for annotated exports, p.name for project exports
        base_query = f"""
            SELECT
                fv.id,
                fv.project_id,
                fv.filename,
                fv.created_at,
                fv.version,
                fv.source_type,
                fv.game_id,
                fv.rating_counts,
                COALESCE(fv.name, p.name) as project_name
            FROM final_videos fv
            LEFT JOIN projects p ON fv.project_id = p.id AND fv.project_id != 0
            WHERE fv.id IN ({latest_final_videos_subquery()})
        """

        if source_type:
            base_query += " AND fv.source_type = ?"
            base_query += " ORDER BY fv.created_at DESC"
            cursor.execute(base_query, (source_type,))
        else:
            base_query += " ORDER BY fv.created_at DESC"
            cursor.execute(base_query)

        rows = cursor.fetchall()

        downloads = []
        for row in rows:
            # Get file size if file exists
            file_path = get_final_videos_path() / row['filename']
            file_size = None
            if file_path.exists():
                file_size = file_path.stat().st_size

            # Parse stored rating counts for annotated games (frozen at export time)
            rating_counts = None
            if row['source_type'] == 'annotated_game' and row['rating_counts']:
                try:
                    c = json.loads(row['rating_counts'])
                    brilliant = c.get('brilliant', 0)
                    good = c.get('good', 0)
                    interesting = c.get('interesting', 0)
                    mistake = c.get('mistake', 0)
                    blunder = c.get('blunder', 0)
                    total = brilliant + good + interesting + mistake + blunder
                    weighted_sum = (brilliant * 5) + (good * 4) + (interesting * 3) + (mistake * 2) + (blunder * 1)
                    weighted_average = round(weighted_sum / total, 2) if total > 0 else None
                    rating_counts = RatingCounts(
                        brilliant=brilliant,
                        good=good,
                        interesting=interesting,
                        mistake=mistake,
                        blunder=blunder,
                        total=total,
                        weighted_average=weighted_average
                    )
                except (json.JSONDecodeError, KeyError):
                    pass  # Invalid JSON, skip rating counts

            downloads.append(DownloadItem(
                id=row['id'],
                project_id=row['project_id'],
                project_name=row['project_name'],
                filename=row['filename'],
                created_at=row['created_at'],
                file_size=file_size,
                source_type=row['source_type'],
                game_id=row['game_id'],
                rating_counts=rating_counts
            ))

        return DownloadListResponse(
            downloads=downloads,
            total_count=len(downloads)
        )


def generate_download_filename(project_name: str) -> str:
    """
    Generate a sanitized download filename from project name.
    This is the SINGLE SOURCE OF TRUTH for final video filenames.

    Args:
        project_name: The project name (can be None)

    Returns:
        Sanitized filename like "Project_Name_final.mp4"
    """
    name = project_name or 'video'
    # Remove special characters, keep alphanumeric, spaces, hyphens, underscores
    safe_name = re.sub(r'[^\w\s-]', '', name).strip()
    # Replace spaces with underscores
    safe_name = re.sub(r'[\s]+', '_', safe_name)
    if not safe_name:
        safe_name = 'video'
    return f"{safe_name}_final.mp4"


@router.get("/{download_id}/file")
async def download_file(download_id: int):
    """
    Download/stream a final video file.
    Returns the video file for download with project name as filename.
    """
    logger.info(f"[Download] Request for download_id={download_id}")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT fv.filename, COALESCE(fv.name, p.name) as project_name
            FROM final_videos fv
            LEFT JOIN projects p ON fv.project_id = p.id AND fv.project_id != 0
            WHERE fv.id = ?
        """, (download_id,))
        row = cursor.fetchone()

        if not row:
            logger.warning(f"[Download] Not found: download_id={download_id}")
            raise HTTPException(status_code=404, detail="Download not found")

        logger.info(f"[Download] Found: stored_filename={row['filename']}, project_name={row['project_name']}")

        file_path = get_final_videos_path() / row['filename']
        if not file_path.exists():
            logger.error(f"[Download] File missing: {file_path}")
            raise HTTPException(status_code=404, detail="Video file not found")

        # Generate download filename from project name (single source of truth)
        download_filename = generate_download_filename(row['project_name'])
        logger.info(f"[Download] Serving file as: {download_filename}")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=download_filename
        )


@router.delete("/{download_id}")
async def delete_download(download_id: int, remove_file: bool = False):
    """
    Delete a download entry.

    Args:
        download_id: ID of the download to delete
        remove_file: If True, also delete the video file from disk
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get the download info
        cursor.execute("""
            SELECT id, filename, project_id FROM final_videos
            WHERE id = ?
        """, (download_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Download not found")

        # Delete the record from database
        cursor.execute("""
            DELETE FROM final_videos WHERE id = ?
        """, (download_id,))

        # Clear the project's final_video_id reference if it points to this video
        cursor.execute("""
            UPDATE projects SET final_video_id = NULL
            WHERE final_video_id = ?
        """, (download_id,))

        conn.commit()

        # Optionally remove the file
        if remove_file:
            file_path = get_final_videos_path() / row['filename']
            if file_path.exists():
                try:
                    os.remove(file_path)
                    logger.info(f"Deleted file: {file_path}")
                except Exception as e:
                    logger.error(f"Failed to delete file {file_path}: {e}")

        logger.info(f"Deleted download: {download_id}")
        return {"success": True, "deleted_id": download_id}


@router.get("/count")
async def get_download_count():
    """
    Get count of available downloads (latest version per project only).
    Useful for showing badge count in header.
    Must match the same filtering logic as the list endpoint.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Count only latest version per project (same logic as list endpoint)
        cursor.execute(f"""
            SELECT COUNT(*) as count FROM final_videos
            WHERE id IN ({latest_final_videos_subquery()})
        """)
        row = cursor.fetchone()

        return {"count": row['count'] if row else 0}
