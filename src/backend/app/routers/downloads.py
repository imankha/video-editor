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
import logging

from app.database import get_db_connection, FINAL_VIDEOS_PATH

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/downloads", tags=["downloads"])


class DownloadItem(BaseModel):
    id: int
    project_id: int
    project_name: str
    filename: str
    created_at: str
    file_size: Optional[int]  # Size in bytes


class DownloadListResponse(BaseModel):
    downloads: List[DownloadItem]
    total_count: int


@router.get("", response_model=DownloadListResponse)
async def list_downloads():
    """
    List all final videos with metadata.
    Returns videos grouped with project information.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get only the latest version of final videos per project
        cursor.execute("""
            SELECT
                fv.id,
                fv.project_id,
                fv.filename,
                fv.created_at,
                fv.version,
                p.name as project_name
            FROM final_videos fv
            JOIN projects p ON fv.project_id = p.id
            WHERE fv.id IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (
                        PARTITION BY project_id
                        ORDER BY version DESC
                    ) as rn
                    FROM final_videos
                ) WHERE rn = 1
            )
            ORDER BY fv.created_at DESC
        """)
        rows = cursor.fetchall()

        downloads = []
        for row in rows:
            # Get file size if file exists
            file_path = FINAL_VIDEOS_PATH / row['filename']
            file_size = None
            if file_path.exists():
                file_size = file_path.stat().st_size

            downloads.append(DownloadItem(
                id=row['id'],
                project_id=row['project_id'],
                project_name=row['project_name'],
                filename=row['filename'],
                created_at=row['created_at'],
                file_size=file_size
            ))

        return DownloadListResponse(
            downloads=downloads,
            total_count=len(downloads)
        )


@router.get("/{download_id}/file")
async def download_file(download_id: int):
    """
    Download/stream a final video file.
    Returns the video file for download.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT filename FROM final_videos
            WHERE id = ?
        """, (download_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Download not found")

        file_path = FINAL_VIDEOS_PATH / row['filename']
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=row['filename']
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
            file_path = FINAL_VIDEOS_PATH / row['filename']
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
    Get count of available downloads.
    Useful for showing badge count in header.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT COUNT(*) as count FROM final_videos
        """)
        row = cursor.fetchone()

        return {"count": row['count'] if row else 0}
