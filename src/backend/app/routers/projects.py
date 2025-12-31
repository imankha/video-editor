"""
Project management endpoints.

Projects organize clips for editing through Framing and Overlay modes.
Each project has an aspect ratio (16:9 or 9:16) and contains working clips.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json
import logging

from app.database import get_db_connection

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str
    aspect_ratio: str  # "16:9" or "9:16"


class ProjectResponse(BaseModel):
    id: int
    name: str
    aspect_ratio: str
    working_video_id: Optional[int]
    final_video_id: Optional[int]
    created_at: str


class ProjectListItem(BaseModel):
    id: int
    name: str
    aspect_ratio: str
    clip_count: int
    clips_exported: int  # Clips with exported_at IS NOT NULL (included in working video)
    clips_in_progress: int  # Clips with edits but not yet exported
    has_working_video: bool
    has_overlay_edits: bool
    has_final_video: bool
    created_at: str
    current_mode: Optional[str] = 'framing'
    last_opened_at: Optional[str] = None


class WorkingClipResponse(BaseModel):
    id: int
    raw_clip_id: Optional[int]
    uploaded_filename: Optional[str]
    filename: str  # Resolved filename (from raw_clips or uploaded)
    exported_at: Optional[str] = None  # ISO timestamp when clip was exported
    sort_order: int


class ProjectDetailResponse(BaseModel):
    id: int
    name: str
    aspect_ratio: str
    working_video_id: Optional[int]
    final_video_id: Optional[int]
    clips: List[WorkingClipResponse]
    created_at: str


@router.get("", response_model=List[ProjectListItem])
async def list_projects():
    """List all projects with progress information."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get all projects
        cursor.execute("""
            SELECT id, name, aspect_ratio, working_video_id, final_video_id, created_at, current_mode, last_opened_at
            FROM projects
            ORDER BY created_at DESC
        """)
        projects = cursor.fetchall()

        result = []
        for project in projects:
            project_id = project['id']

            # Count clips by status (latest version of each clip only, grouped by end_time)
            # - exported: exported_at IS NOT NULL (included in working video export)
            # - in_progress: has framing edits but not yet exported (exported_at IS NULL with data)
            cursor.execute("""
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN exported_at IS NOT NULL THEN 1 ELSE 0 END) as exported,
                    SUM(CASE WHEN exported_at IS NULL AND (
                        (crop_data IS NOT NULL AND crop_data != '' AND crop_data != '[]') OR
                        (segments_data IS NOT NULL AND segments_data != '' AND segments_data != '{}') OR
                        (timing_data IS NOT NULL AND timing_data != '' AND timing_data != '{}')
                    ) THEN 1 ELSE 0 END) as in_progress
                FROM working_clips wc
                WHERE wc.project_id = ?
                AND wc.id IN (
                    SELECT id FROM (
                        SELECT wc2.id, ROW_NUMBER() OVER (
                            PARTITION BY COALESCE(rc2.end_time, wc2.uploaded_filename)
                            ORDER BY wc2.version DESC
                        ) as rn
                        FROM working_clips wc2
                        LEFT JOIN raw_clips rc2 ON wc2.raw_clip_id = rc2.id
                        WHERE wc2.project_id = ?
                    ) WHERE rn = 1
                )
            """, (project_id, project_id))
            counts = cursor.fetchone()

            clip_count = counts['total'] or 0
            clips_exported = counts['exported'] or 0
            clips_in_progress = counts['in_progress'] or 0

            # Check for working video and overlay edits (project references latest version)
            has_working = False
            has_overlay = False
            if project['working_video_id']:
                cursor.execute("""
                    SELECT id, highlights_data, text_overlays
                    FROM working_videos WHERE id = ?
                """, (project['working_video_id'],))
                wv_row = cursor.fetchone()
                if wv_row:
                    has_working = True
                    # Check if overlay edits exist (highlights or text overlays)
                    has_overlay = bool(
                        (wv_row['highlights_data'] and wv_row['highlights_data'] != '[]') or
                        (wv_row['text_overlays'] and wv_row['text_overlays'] != '[]')
                    )

            # Check for final video (project references latest version)
            has_final = False
            if project['final_video_id']:
                cursor.execute("""
                    SELECT id FROM final_videos WHERE id = ?
                """, (project['final_video_id'],))
                has_final = cursor.fetchone() is not None

            result.append(ProjectListItem(
                id=project_id,
                name=project['name'],
                aspect_ratio=project['aspect_ratio'],
                clip_count=clip_count,
                clips_exported=clips_exported,
                clips_in_progress=clips_in_progress,
                has_working_video=has_working,
                has_overlay_edits=has_overlay,
                has_final_video=has_final,
                created_at=project['created_at'],
                current_mode=project['current_mode'] or 'framing',
                last_opened_at=project['last_opened_at']
            ))

        return result


@router.post("", response_model=ProjectResponse)
async def create_project(project: ProjectCreate):
    """Create a new empty project."""
    # Validate aspect ratio
    if project.aspect_ratio not in ['16:9', '9:16', '4:3', '1:1']:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid aspect ratio: {project.aspect_ratio}"
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES (?, ?)
        """, (project.name, project.aspect_ratio))
        conn.commit()

        project_id = cursor.lastrowid
        logger.info(f"Created project: {project_id} - {project.name}")

        return ProjectResponse(
            id=project_id,
            name=project.name,
            aspect_ratio=project.aspect_ratio,
            working_video_id=None,
            final_video_id=None,
            created_at=datetime.now().isoformat()
        )


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(project_id: int):
    """Get project details including all working clips."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get project
        cursor.execute("""
            SELECT id, name, aspect_ratio, working_video_id, final_video_id, created_at
            FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Get working clips with resolved filenames (latest version of each clip only, grouped by end_time)
        cursor.execute("""
            SELECT
                wc.id,
                wc.raw_clip_id,
                wc.uploaded_filename,
                wc.exported_at,
                wc.sort_order,
                rc.filename as raw_filename
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.project_id = ?
            AND wc.id IN (
                SELECT id FROM (
                    SELECT wc2.id, ROW_NUMBER() OVER (
                        PARTITION BY COALESCE(rc2.end_time, wc2.uploaded_filename)
                        ORDER BY wc2.version DESC
                    ) as rn
                    FROM working_clips wc2
                    LEFT JOIN raw_clips rc2 ON wc2.raw_clip_id = rc2.id
                    WHERE wc2.project_id = ?
                ) WHERE rn = 1
            )
            ORDER BY wc.sort_order
        """, (project_id, project_id))
        clips_rows = cursor.fetchall()

        clips = []
        for clip in clips_rows:
            # Resolve filename
            filename = clip['raw_filename'] or clip['uploaded_filename'] or 'unknown'
            clips.append(WorkingClipResponse(
                id=clip['id'],
                raw_clip_id=clip['raw_clip_id'],
                uploaded_filename=clip['uploaded_filename'],
                filename=filename,
                exported_at=clip['exported_at'],
                sort_order=clip['sort_order']
            ))

        return ProjectDetailResponse(
            id=project['id'],
            name=project['name'],
            aspect_ratio=project['aspect_ratio'],
            working_video_id=project['working_video_id'],
            final_video_id=project['final_video_id'],
            clips=clips,
            created_at=project['created_at']
        )


@router.delete("/{project_id}")
async def delete_project(project_id: int):
    """Delete a project and all its working clips."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Check project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # Delete working clips (all versions for this project)
        cursor.execute("""
            DELETE FROM working_clips WHERE project_id = ?
        """, (project_id,))

        # Delete working videos (all versions for this project)
        cursor.execute("""
            DELETE FROM working_videos WHERE project_id = ?
        """, (project_id,))

        # Delete final videos (all versions for this project)
        cursor.execute("""
            DELETE FROM final_videos WHERE project_id = ?
        """, (project_id,))

        # Delete project
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()

        logger.info(f"Deleted project: {project_id}")
        return {"success": True, "deleted_id": project_id}


@router.put("/{project_id}")
async def update_project(project_id: int, project: ProjectCreate):
    """Update project name and/or aspect ratio."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        cursor.execute("""
            UPDATE projects SET name = ?, aspect_ratio = ? WHERE id = ?
        """, (project.name, project.aspect_ratio, project_id))
        conn.commit()

        return {"success": True, "id": project_id}


@router.patch("/{project_id}/state")
async def update_project_state(
    project_id: int,
    current_mode: Optional[str] = None,
    update_last_opened: bool = False
):
    """
    Update project state (current mode and/or last opened timestamp).

    - current_mode: 'annotate' | 'framing' | 'overlay'
    - update_last_opened: Set to true to update last_opened_at to current time
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        updates = []
        params = []

        if current_mode is not None:
            if current_mode not in ['annotate', 'framing', 'overlay']:
                raise HTTPException(status_code=400, detail="Invalid mode")
            updates.append("current_mode = ?")
            params.append(current_mode)

        if update_last_opened:
            updates.append("last_opened_at = CURRENT_TIMESTAMP")

        if not updates:
            return {"success": True, "message": "No updates requested"}

        params.append(project_id)
        query = f"UPDATE projects SET {', '.join(updates)} WHERE id = ?"
        cursor.execute(query, params)
        conn.commit()

        return {"success": True, "id": project_id}


@router.post("/{project_id}/discard-uncommitted")
async def discard_uncommitted_changes(project_id: int):
    """
    Discard all uncommitted framing changes for a project.

    This deletes any clip versions that:
    - Have progress = 0 (not exported)
    - Have version > 1 (are newer versions of exported clips)

    After deletion, the previous exported version becomes the "latest" again.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # Find and delete uncommitted versions (progress=0, version>1)
        # These are newer versions of clips that were previously exported
        cursor.execute("""
            DELETE FROM working_clips
            WHERE project_id = ? AND progress = 0 AND version > 1
        """, (project_id,))

        deleted_count = cursor.rowcount
        conn.commit()

        logger.info(f"Discarded {deleted_count} uncommitted clip versions for project {project_id}")
        return {"success": True, "discarded_count": deleted_count}


@router.get("/{project_id}/working-video")
async def get_working_video(project_id: int):
    """
    Get the working video file for a project.
    Returns the video file if it exists, 404 otherwise.
    """
    from fastapi.responses import FileResponse
    from app.database import WORKING_VIDEOS_PATH

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get project and its working video (latest version)
        cursor.execute("""
            SELECT p.working_video_id, wv.filename
            FROM projects p
            LEFT JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ?
        """, (project_id,))

        row = cursor.fetchone()
        if not row or not row['filename']:
            raise HTTPException(status_code=404, detail="Working video not found")

        video_path = WORKING_VIDEOS_PATH / row['filename']
        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Working video file not found on disk")

        return FileResponse(
            video_path,
            media_type="video/mp4",
            filename=row['filename']
        )
