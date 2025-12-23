"""
Clip management endpoints.

Two types of clips:
1. Raw Clips - Extracted from Annotate mode (4+ star), stored in library
2. Working Clips - Assigned to projects for editing

Files are stored in:
- raw_clips/ - Clips from Annotate export
- uploads/ - Clips uploaded directly to projects
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import os
import uuid
import json
import logging

from app.database import (
    get_db_connection,
    RAW_CLIPS_PATH,
    UPLOADS_PATH
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/clips", tags=["clips"])


class RawClipResponse(BaseModel):
    id: int
    filename: str
    rating: int
    tags: List[str]
    name: Optional[str] = None
    notes: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    created_at: str


class WorkingClipCreate(BaseModel):
    raw_clip_id: Optional[int] = None  # If adding from library


class WorkingClipResponse(BaseModel):
    id: int
    project_id: int
    raw_clip_id: Optional[int]
    uploaded_filename: Optional[str]
    filename: str
    name: Optional[str] = None
    notes: Optional[str] = None
    progress: int
    sort_order: int
    crop_data: Optional[str] = None
    timing_data: Optional[str] = None
    segments_data: Optional[str] = None
    transform_data: Optional[str] = None


class WorkingClipUpdate(BaseModel):
    progress: Optional[int] = None
    sort_order: Optional[int] = None
    crop_data: Optional[str] = None
    timing_data: Optional[str] = None
    segments_data: Optional[str] = None
    transform_data: Optional[str] = None


# ============ RAW CLIPS (LIBRARY) ============

@router.get("/raw", response_model=List[RawClipResponse])
async def list_raw_clips():
    """List all raw clips in the library."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, filename, rating, tags, name, notes, start_time, end_time, created_at
            FROM raw_clips
            ORDER BY created_at DESC
        """)
        clips = cursor.fetchall()

        return [
            RawClipResponse(
                id=clip['id'],
                filename=clip['filename'],
                rating=clip['rating'],
                tags=json.loads(clip['tags']) if clip['tags'] else [],
                name=clip['name'],
                notes=clip['notes'],
                start_time=clip['start_time'],
                end_time=clip['end_time'],
                created_at=clip['created_at']
            )
            for clip in clips
        ]


@router.get("/raw/{clip_id}", response_model=RawClipResponse)
async def get_raw_clip(clip_id: int):
    """Get a single raw clip's metadata."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, filename, rating, tags, name, notes, start_time, end_time, created_at
            FROM raw_clips WHERE id = ?
        """, (clip_id,))
        clip = cursor.fetchone()

        if not clip:
            raise HTTPException(status_code=404, detail="Raw clip not found")

        return RawClipResponse(
            id=clip['id'],
            filename=clip['filename'],
            rating=clip['rating'],
            tags=json.loads(clip['tags']) if clip['tags'] else [],
            name=clip['name'],
            notes=clip['notes'],
            start_time=clip['start_time'],
            end_time=clip['end_time'],
            created_at=clip['created_at']
        )


@router.get("/raw/{clip_id}/file")
async def get_raw_clip_file(clip_id: int):
    """Stream a raw clip video file."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT filename FROM raw_clips WHERE id = ?", (clip_id,))
        clip = cursor.fetchone()

        if not clip:
            raise HTTPException(status_code=404, detail="Raw clip not found")

        file_path = RAW_CLIPS_PATH / clip['filename']
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Clip file not found")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=clip['filename']
        )


# ============ WORKING CLIPS (PROJECT CLIPS) ============

@router.get("/projects/{project_id}/clips", response_model=List[WorkingClipResponse])
async def list_project_clips(project_id: int):
    """List all working clips for a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # Get working clips with resolved filenames and metadata
        cursor.execute("""
            SELECT
                wc.id,
                wc.project_id,
                wc.raw_clip_id,
                wc.uploaded_filename,
                wc.progress,
                wc.sort_order,
                wc.crop_data,
                wc.timing_data,
                wc.segments_data,
                wc.transform_data,
                rc.filename as raw_filename,
                rc.name as raw_name,
                rc.notes as raw_notes
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.project_id = ? AND wc.abandoned = FALSE
            ORDER BY wc.sort_order
        """, (project_id,))
        clips = cursor.fetchall()

        return [
            WorkingClipResponse(
                id=clip['id'],
                project_id=clip['project_id'],
                raw_clip_id=clip['raw_clip_id'],
                uploaded_filename=clip['uploaded_filename'],
                filename=clip['raw_filename'] or clip['uploaded_filename'] or 'unknown',
                name=clip['raw_name'],
                notes=clip['raw_notes'],
                progress=clip['progress'],
                sort_order=clip['sort_order'],
                crop_data=clip['crop_data'],
                timing_data=clip['timing_data'],
                segments_data=clip['segments_data'],
                transform_data=clip['transform_data']
            )
            for clip in clips
        ]


@router.post("/projects/{project_id}/clips", response_model=WorkingClipResponse)
async def add_clip_to_project(
    project_id: int,
    raw_clip_id: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None)
):
    """
    Add a clip to a project.

    Either provide:
    - raw_clip_id: to add a clip from the library
    - file: to upload a new clip directly
    """
    if raw_clip_id is None and file is None:
        raise HTTPException(
            status_code=400,
            detail="Must provide either raw_clip_id or file"
        )

    if raw_clip_id is not None and file is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot provide both raw_clip_id and file"
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # Get next sort order
        cursor.execute("""
            SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order
            FROM working_clips
            WHERE project_id = ? AND abandoned = FALSE
        """, (project_id,))
        next_order = cursor.fetchone()['next_order']

        uploaded_filename = None
        raw_filename = None

        if raw_clip_id is not None:
            # Adding from library
            cursor.execute("SELECT filename FROM raw_clips WHERE id = ?", (raw_clip_id,))
            raw_clip = cursor.fetchone()
            if not raw_clip:
                raise HTTPException(status_code=404, detail="Raw clip not found")
            raw_filename = raw_clip['filename']

            cursor.execute("""
                INSERT INTO working_clips (project_id, raw_clip_id, sort_order)
                VALUES (?, ?, ?)
            """, (project_id, raw_clip_id, next_order))

        else:
            # Uploading new file
            # Generate unique filename
            ext = os.path.splitext(file.filename)[1] or '.mp4'
            uploaded_filename = f"{uuid.uuid4().hex}{ext}"
            file_path = UPLOADS_PATH / uploaded_filename

            # Save file
            content = await file.read()
            with open(file_path, 'wb') as f:
                f.write(content)

            cursor.execute("""
                INSERT INTO working_clips (project_id, uploaded_filename, sort_order)
                VALUES (?, ?, ?)
            """, (project_id, uploaded_filename, next_order))

        conn.commit()
        clip_id = cursor.lastrowid

        logger.info(f"Added clip {clip_id} to project {project_id}")

        return WorkingClipResponse(
            id=clip_id,
            project_id=project_id,
            raw_clip_id=raw_clip_id,
            uploaded_filename=uploaded_filename,
            filename=raw_filename or uploaded_filename,
            progress=0,
            sort_order=next_order
        )


@router.put("/projects/{project_id}/clips/reorder")
async def reorder_clips(project_id: int, clip_ids: List[int]):
    """Reorder clips by providing the new order of clip IDs."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        for index, clip_id in enumerate(clip_ids):
            cursor.execute("""
                UPDATE working_clips
                SET sort_order = ?
                WHERE id = ? AND project_id = ? AND abandoned = FALSE
            """, (index, clip_id, project_id))

        conn.commit()
        return {"success": True}


@router.get("/projects/{project_id}/clips/{clip_id}/file")
async def get_working_clip_file(project_id: int, clip_id: int):
    """Stream a working clip video file."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT wc.raw_clip_id, wc.uploaded_filename, rc.filename as raw_filename
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.id = ? AND wc.project_id = ? AND wc.abandoned = FALSE
        """, (clip_id, project_id))
        clip = cursor.fetchone()

        if not clip:
            raise HTTPException(status_code=404, detail="Working clip not found")

        # Determine file path
        if clip['raw_clip_id']:
            file_path = RAW_CLIPS_PATH / clip['raw_filename']
            filename = clip['raw_filename']
        else:
            file_path = UPLOADS_PATH / clip['uploaded_filename']
            filename = clip['uploaded_filename']

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Clip file not found")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=filename
        )


@router.put("/projects/{project_id}/clips/{clip_id}")
async def update_working_clip(
    project_id: int,
    clip_id: int,
    update: WorkingClipUpdate
):
    """Update a working clip's progress, sort order, or framing edits."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id FROM working_clips
            WHERE id = ? AND project_id = ? AND abandoned = FALSE
        """, (clip_id, project_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Working clip not found")

        updates = []
        params = []
        if update.progress is not None:
            updates.append("progress = ?")
            params.append(update.progress)
        if update.sort_order is not None:
            updates.append("sort_order = ?")
            params.append(update.sort_order)
        if update.crop_data is not None:
            updates.append("crop_data = ?")
            params.append(update.crop_data)
        if update.timing_data is not None:
            updates.append("timing_data = ?")
            params.append(update.timing_data)
        if update.segments_data is not None:
            updates.append("segments_data = ?")
            params.append(update.segments_data)
        if update.transform_data is not None:
            updates.append("transform_data = ?")
            params.append(update.transform_data)

        if updates:
            params.append(clip_id)
            cursor.execute(f"""
                UPDATE working_clips SET {', '.join(updates)} WHERE id = ?
            """, params)
            conn.commit()

        return {"success": True}


@router.delete("/projects/{project_id}/clips/{clip_id}")
async def remove_clip_from_project(project_id: int, clip_id: int):
    """Remove a clip from a project (soft delete)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id FROM working_clips
            WHERE id = ? AND project_id = ? AND abandoned = FALSE
        """, (clip_id, project_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Working clip not found")

        cursor.execute("""
            UPDATE working_clips SET abandoned = TRUE WHERE id = ?
        """, (clip_id,))
        conn.commit()

        logger.info(f"Removed clip {clip_id} from project {project_id}")
        return {"success": True}
