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
    clips_framed: int
    has_working_video: bool
    has_final_video: bool
    created_at: str


class WorkingClipResponse(BaseModel):
    id: int
    raw_clip_id: Optional[int]
    uploaded_filename: Optional[str]
    filename: str  # Resolved filename (from raw_clips or uploaded)
    progress: int
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
            SELECT id, name, aspect_ratio, working_video_id, final_video_id, created_at
            FROM projects
            ORDER BY created_at DESC
        """)
        projects = cursor.fetchall()

        result = []
        for project in projects:
            project_id = project['id']

            # Count clips and framed clips
            cursor.execute("""
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN progress = 1 THEN 1 ELSE 0 END) as framed
                FROM working_clips
                WHERE project_id = ? AND abandoned = FALSE
            """, (project_id,))
            counts = cursor.fetchone()

            clip_count = counts['total'] or 0
            clips_framed = counts['framed'] or 0

            # Check for non-abandoned working video
            has_working = False
            if project['working_video_id']:
                cursor.execute("""
                    SELECT abandoned FROM working_videos WHERE id = ?
                """, (project['working_video_id'],))
                wv = cursor.fetchone()
                has_working = wv and not wv['abandoned']

            # Check for non-abandoned final video
            has_final = False
            if project['final_video_id']:
                cursor.execute("""
                    SELECT abandoned FROM final_videos WHERE id = ?
                """, (project['final_video_id'],))
                fv = cursor.fetchone()
                has_final = fv and not fv['abandoned']

            result.append(ProjectListItem(
                id=project_id,
                name=project['name'],
                aspect_ratio=project['aspect_ratio'],
                clip_count=clip_count,
                clips_framed=clips_framed,
                has_working_video=has_working,
                has_final_video=has_final,
                created_at=project['created_at']
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

        # Get working clips with resolved filenames
        cursor.execute("""
            SELECT
                wc.id,
                wc.raw_clip_id,
                wc.uploaded_filename,
                wc.progress,
                wc.sort_order,
                rc.filename as raw_filename
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.project_id = ? AND wc.abandoned = FALSE
            ORDER BY wc.sort_order
        """, (project_id,))
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
                progress=clip['progress'],
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

        # Delete working clips (soft delete by marking abandoned)
        cursor.execute("""
            UPDATE working_clips SET abandoned = TRUE WHERE project_id = ?
        """, (project_id,))

        # Mark working videos abandoned
        cursor.execute("""
            UPDATE working_videos SET abandoned = TRUE WHERE project_id = ?
        """, (project_id,))

        # Mark final videos abandoned
        cursor.execute("""
            UPDATE final_videos SET abandoned = TRUE WHERE project_id = ?
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
