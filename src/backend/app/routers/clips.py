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
from app.queries import latest_working_clips_subquery, derive_clip_name

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/clips", tags=["clips"])


def normalize_json_data(value: Optional[str]) -> Optional[str]:
    """Convert empty JSON to NULL for consistent storage.

    This ensures we don't have multiple representations of 'no data'
    (NULL, '', '[]', '{}') which complicates queries.
    """
    if value is None:
        return None
    if value in ('', '[]', '{}', 'null'):
        return None
    return value


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
    exported_at: Optional[str] = None  # ISO timestamp when clip was exported (NULL = not exported)
    sort_order: int
    crop_data: Optional[str] = None
    timing_data: Optional[str] = None
    segments_data: Optional[str] = None
    transform_data: Optional[str] = None


class WorkingClipUpdate(BaseModel):
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

        result = []
        for clip in clips:
            tags = json.loads(clip['tags']) if clip['tags'] else []
            result.append(RawClipResponse(
                id=clip['id'],
                filename=clip['filename'],
                rating=clip['rating'],
                tags=tags,
                name=derive_clip_name(clip['name'], clip['rating'], tags),
                notes=clip['notes'],
                start_time=clip['start_time'],
                end_time=clip['end_time'],
                created_at=clip['created_at']
            ))
        return result


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

        tags = json.loads(clip['tags']) if clip['tags'] else []
        return RawClipResponse(
            id=clip['id'],
            filename=clip['filename'],
            rating=clip['rating'],
            tags=tags,
            name=derive_clip_name(clip['name'], clip['rating'], tags),
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
        # Only show the latest version of each clip (grouped by end_time)
        cursor.execute(f"""
            SELECT
                wc.id,
                wc.project_id,
                wc.raw_clip_id,
                wc.uploaded_filename,
                wc.exported_at,
                wc.sort_order,
                wc.crop_data,
                wc.timing_data,
                wc.segments_data,
                wc.transform_data,
                rc.filename as raw_filename,
                rc.name as raw_name,
                rc.notes as raw_notes,
                rc.rating as raw_rating,
                rc.tags as raw_tags
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.project_id = ?
            AND wc.id IN ({latest_working_clips_subquery()})
            ORDER BY wc.sort_order
        """, (project_id, project_id))
        clips = cursor.fetchall()

        result = []
        for clip in clips:
            tags = json.loads(clip['raw_tags']) if clip['raw_tags'] else []
            rating = clip['raw_rating'] or 3
            result.append(WorkingClipResponse(
                id=clip['id'],
                project_id=clip['project_id'],
                raw_clip_id=clip['raw_clip_id'],
                uploaded_filename=clip['uploaded_filename'],
                filename=clip['raw_filename'] or clip['uploaded_filename'] or 'unknown',
                name=derive_clip_name(clip['raw_name'], rating, tags),
                notes=clip['raw_notes'],
                exported_at=clip['exported_at'],
                sort_order=clip['sort_order'],
                crop_data=clip['crop_data'],
                timing_data=clip['timing_data'],
                segments_data=clip['segments_data'],
                transform_data=clip['transform_data']
            ))
        return result


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
            WHERE project_id = ?
        """, (project_id,))
        next_order = cursor.fetchone()['next_order']

        uploaded_filename = None
        raw_filename = None
        next_version = 1

        if raw_clip_id is not None:
            # Adding from library
            cursor.execute("SELECT filename, end_time FROM raw_clips WHERE id = ?", (raw_clip_id,))
            raw_clip = cursor.fetchone()
            if not raw_clip:
                raise HTTPException(status_code=404, detail="Raw clip not found")
            raw_filename = raw_clip['filename']
            end_time = raw_clip['end_time']

            # Get next version for clips with THIS specific end_time
            # Clips are identified by their end timestamp
            cursor.execute("""
                SELECT COALESCE(MAX(wc.version), 0) + 1 as next_version
                FROM working_clips wc
                JOIN raw_clips rc ON wc.raw_clip_id = rc.id
                WHERE wc.project_id = ? AND rc.end_time = ?
            """, (project_id, end_time))
            next_version = cursor.fetchone()['next_version']

            cursor.execute("""
                INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version)
                VALUES (?, ?, ?, ?)
            """, (project_id, raw_clip_id, next_order, next_version))

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

            # For uploaded files, each upload is version 1 (unique filename)
            # No version history for uploaded clips since filename is unique
            cursor.execute("""
                INSERT INTO working_clips (project_id, uploaded_filename, sort_order, version)
                VALUES (?, ?, ?, ?)
            """, (project_id, uploaded_filename, next_order, 1))

        conn.commit()
        clip_id = cursor.lastrowid

        logger.info(f"Added clip {clip_id} to project {project_id}")

        return WorkingClipResponse(
            id=clip_id,
            project_id=project_id,
            raw_clip_id=raw_clip_id,
            uploaded_filename=uploaded_filename,
            filename=raw_filename or uploaded_filename,
            exported_at=None,
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
                WHERE id = ? AND project_id = ?
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
            WHERE wc.id = ? AND wc.project_id = ?
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
    """Update a working clip's sort order or framing edits.

    Version creation logic:
    - If the clip was previously exported (exported_at IS NOT NULL) AND this update contains
      framing changes (crop_data, timing_data, or segments_data), a NEW version
      is created instead of updating the existing clip.
    - Otherwise, the existing clip is updated in place.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Fetch current clip data
        cursor.execute("""
            SELECT id, project_id, raw_clip_id, uploaded_filename, exported_at, sort_order, version,
                   crop_data, timing_data, segments_data, transform_data
            FROM working_clips
            WHERE id = ? AND project_id = ?
        """, (clip_id, project_id))
        current_clip = cursor.fetchone()

        if not current_clip:
            raise HTTPException(status_code=404, detail="Working clip not found")

        # Check if this is a framing change on an exported clip
        is_framing_change = (
            update.crop_data is not None or
            update.timing_data is not None or
            update.segments_data is not None
        )
        was_exported = current_clip['exported_at'] is not None

        # Check if data actually changed (avoid creating new versions for no-op saves)
        data_actually_changed = False
        if is_framing_change:
            if update.crop_data is not None and update.crop_data != current_clip['crop_data']:
                data_actually_changed = True
            if update.timing_data is not None and update.timing_data != current_clip['timing_data']:
                data_actually_changed = True
            if update.segments_data is not None and update.segments_data != current_clip['segments_data']:
                data_actually_changed = True

        if is_framing_change and was_exported and data_actually_changed:
            # Create a NEW version of this clip instead of updating
            new_version = current_clip['version'] + 1

            logger.info(f"Creating new version {new_version} of clip {clip_id} (was exported)")

            cursor.execute("""
                INSERT INTO working_clips (
                    project_id, raw_clip_id, uploaded_filename, sort_order, version,
                    crop_data, timing_data, segments_data, transform_data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                project_id,
                current_clip['raw_clip_id'],
                current_clip['uploaded_filename'],
                current_clip['sort_order'],
                new_version,
                normalize_json_data(update.crop_data if update.crop_data is not None else current_clip['crop_data']),
                normalize_json_data(update.timing_data if update.timing_data is not None else current_clip['timing_data']),
                normalize_json_data(update.segments_data if update.segments_data is not None else current_clip['segments_data']),
                update.transform_data if update.transform_data is not None else current_clip['transform_data'],
                # exported_at defaults to NULL for new version (not exported yet)
            ))
            conn.commit()

            new_clip_id = cursor.lastrowid
            logger.info(f"Created new clip version: {new_clip_id} (version {new_version})")

            # Tell client the new clip ID so it can switch to it
            return {
                "success": True,
                "refresh_required": True,
                "new_clip_id": new_clip_id,
                "new_version": new_version
            }

        # Regular update (no versioning needed)
        updates = []
        params = []
        if update.sort_order is not None:
            updates.append("sort_order = ?")
            params.append(update.sort_order)
        if update.crop_data is not None:
            updates.append("crop_data = ?")
            params.append(normalize_json_data(update.crop_data))
        if update.timing_data is not None:
            updates.append("timing_data = ?")
            params.append(normalize_json_data(update.timing_data))
        if update.segments_data is not None:
            updates.append("segments_data = ?")
            params.append(normalize_json_data(update.segments_data))
        if update.transform_data is not None:
            updates.append("transform_data = ?")
            params.append(update.transform_data)

        if updates:
            params.append(clip_id)
            cursor.execute(f"""
                UPDATE working_clips SET {', '.join(updates)} WHERE id = ?
            """, params)
            conn.commit()

        # No refresh needed - client already has the data they just sent
        return {"success": True, "refresh_required": False}


@router.delete("/projects/{project_id}/clips/{clip_id}")
async def remove_clip_from_project(project_id: int, clip_id: int):
    """Remove a clip from a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id FROM working_clips
            WHERE id = ? AND project_id = ?
        """, (clip_id, project_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Working clip not found")

        # Delete the clip from the database
        cursor.execute("""
            DELETE FROM working_clips WHERE id = ?
        """, (clip_id,))
        conn.commit()

        logger.info(f"Removed clip {clip_id} from project {project_id}")
        return {"success": True}
