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
from app.queries import latest_working_clips_subquery

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str
    aspect_ratio: str  # "16:9" or "9:16"


class ProjectFromClipsCreate(BaseModel):
    """Create a project pre-populated with filtered clips."""
    name: str
    aspect_ratio: str = "16:9"
    game_ids: List[int] = []  # Empty = all games
    min_rating: int = 1
    tags: List[str] = []  # Empty = all tags


class ClipsPreviewRequest(BaseModel):
    """Request body for previewing clips that would be included in a project."""
    game_ids: List[int] = []
    min_rating: int = 1
    tags: List[str] = []


class ClipsPreviewResponse(BaseModel):
    """Preview of clips matching the filter criteria."""
    clip_count: int
    total_duration: float  # In seconds
    clips: List[dict]  # Brief clip info for display


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
    name: Optional[str] = None  # Human-readable name from raw_clips
    notes: Optional[str] = None  # Notes from raw_clips
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
    """List all projects with progress information.

    Optimized to use a single query with JOINs instead of N+1 queries.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Single optimized query that fetches all project data with JOINs
        # - LEFT JOIN with clip_stats subquery for clip counts (latest versions only)
        # - LEFT JOIN with working_videos for overlay edit info
        # - LEFT JOIN with final_videos for completion status
        #
        # Optimization: Uses NOT EXISTS anti-join pattern instead of window functions
        # This is faster in SQLite as it can use indexes effectively
        cursor.execute("""
            SELECT
                p.id,
                p.name,
                p.aspect_ratio,
                p.working_video_id,
                p.final_video_id,
                p.created_at,
                p.current_mode,
                p.last_opened_at,
                -- Clip counts from subquery
                COALESCE(clip_stats.total, 0) as clip_count,
                COALESCE(clip_stats.exported, 0) as clips_exported,
                COALESCE(clip_stats.in_progress, 0) as clips_in_progress,
                -- Working video info (check if referenced working video exists)
                CASE WHEN wv.id IS NOT NULL THEN 1 ELSE 0 END as has_working_video,
                -- Check for overlay edits (highlights or text overlays with actual content)
                CASE WHEN (
                    (wv.highlights_data IS NOT NULL AND wv.highlights_data != '[]' AND wv.highlights_data != '') OR
                    (wv.text_overlays IS NOT NULL AND wv.text_overlays != '[]' AND wv.text_overlays != '')
                ) THEN 1 ELSE 0 END as has_overlay_edits,
                -- Final video info (check if referenced final video exists)
                CASE WHEN fv.id IS NOT NULL THEN 1 ELSE 0 END as has_final_video
            FROM projects p
            LEFT JOIN (
                -- Subquery for clip counts per project (latest version only)
                -- Uses NOT EXISTS pattern which is faster than window functions
                SELECT
                    wc.project_id,
                    COUNT(*) as total,
                    SUM(CASE WHEN wc.exported_at IS NOT NULL THEN 1 ELSE 0 END) as exported,
                    SUM(CASE WHEN wc.exported_at IS NULL AND (
                        wc.crop_data IS NOT NULL OR
                        wc.segments_data IS NOT NULL OR
                        wc.timing_data IS NOT NULL
                    ) THEN 1 ELSE 0 END) as in_progress
                FROM working_clips wc
                LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
                WHERE NOT EXISTS (
                    -- Exclude if there's a newer version of this same clip
                    SELECT 1 FROM working_clips wc2
                    LEFT JOIN raw_clips rc2 ON wc2.raw_clip_id = rc2.id
                    WHERE wc2.project_id = wc.project_id
                      AND wc2.version > wc.version
                      AND (
                          -- Same raw clip (identified by end_time)
                          (rc2.end_time IS NOT NULL AND rc.end_time IS NOT NULL AND rc2.end_time = rc.end_time)
                          -- OR same uploaded file
                          OR (wc2.raw_clip_id IS NULL AND wc.raw_clip_id IS NULL AND wc2.uploaded_filename = wc.uploaded_filename)
                      )
                )
                GROUP BY wc.project_id
            ) clip_stats ON p.id = clip_stats.project_id
            LEFT JOIN working_videos wv ON p.working_video_id = wv.id
            LEFT JOIN final_videos fv ON p.final_video_id = fv.id
            ORDER BY p.created_at DESC
        """)

        rows = cursor.fetchall()

        result = []
        for row in rows:
            result.append(ProjectListItem(
                id=row['id'],
                name=row['name'],
                aspect_ratio=row['aspect_ratio'],
                clip_count=row['clip_count'],
                clips_exported=row['clips_exported'],
                clips_in_progress=row['clips_in_progress'],
                has_working_video=bool(row['has_working_video']),
                has_overlay_edits=bool(row['has_overlay_edits']),
                has_final_video=bool(row['has_final_video']),
                created_at=row['created_at'],
                current_mode=row['current_mode'] or 'framing',
                last_opened_at=row['last_opened_at']
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


def _build_clips_filter_query(game_ids: List[int], min_rating: int, tags: List[str]):
    """Build SQL query and params for filtering raw clips."""
    # min_rating = 0 means "All clips" (include everything regardless of rating)
    if min_rating <= 0:
        query = """
            SELECT id, filename, rating, tags, name, notes, start_time, end_time, game_id
            FROM raw_clips
            WHERE 1=1
        """
        params = []
    else:
        query = """
            SELECT id, filename, rating, tags, name, notes, start_time, end_time, game_id
            FROM raw_clips
            WHERE COALESCE(rating, 0) >= ?
        """
        params = [min_rating]

    if game_ids:
        placeholders = ','.join(['?' for _ in game_ids])
        query += f" AND game_id IN ({placeholders})"
        params.extend(game_ids)

    # Tag filtering - clips must have ALL specified tags
    # Tags are stored as JSON array, so we need to check each tag
    if tags:
        for tag in tags:
            query += " AND tags LIKE ?"
            params.append(f'%"{tag}"%')

    query += " ORDER BY created_at DESC"
    return query, params


@router.post("/preview-clips", response_model=ClipsPreviewResponse)
async def preview_clips(request: ClipsPreviewRequest):
    """
    Preview clips that would be included in a project based on filter criteria.

    Returns clip count, total duration, and brief clip info for display.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        query, params = _build_clips_filter_query(
            request.game_ids, request.min_rating, request.tags
        )
        cursor.execute(query, params)
        clips = cursor.fetchall()

        total_duration = 0.0
        clips_info = []

        for clip in clips:
            start = clip['start_time'] or 0
            end = clip['end_time'] or 0
            duration = max(0, end - start)
            total_duration += duration

            tags = json.loads(clip['tags']) if clip['tags'] else []
            clips_info.append({
                'id': clip['id'],
                'name': clip['name'] or f"Clip {clip['id']}",
                'rating': clip['rating'],
                'tags': tags,
                'duration': duration,
                'game_id': clip['game_id']
            })

        return ClipsPreviewResponse(
            clip_count=len(clips),
            total_duration=total_duration,
            clips=clips_info
        )


@router.post("/from-clips", response_model=ProjectResponse)
async def create_project_from_clips(request: ProjectFromClipsCreate):
    """
    Create a project pre-populated with filtered clips from the library.

    Filters clips by:
    - game_ids: List of game IDs to include (empty = all games)
    - min_rating: Minimum rating (1-5)
    - tags: List of tags that clips must have (empty = all tags)
    """
    # Validate aspect ratio
    if request.aspect_ratio not in ['16:9', '9:16', '4:3', '1:1']:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid aspect ratio: {request.aspect_ratio}"
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get filtered clips
        query, params = _build_clips_filter_query(
            request.game_ids, request.min_rating, request.tags
        )
        cursor.execute(query, params)
        clips = cursor.fetchall()

        if not clips:
            raise HTTPException(
                status_code=400,
                detail="No clips match the specified filters"
            )

        # Create the project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES (?, ?)
        """, (request.name, request.aspect_ratio))
        project_id = cursor.lastrowid

        # Add all filtered clips as working clips
        for sort_order, clip in enumerate(clips):
            cursor.execute("""
                INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version)
                VALUES (?, ?, ?, 1)
            """, (project_id, clip['id'], sort_order))

        conn.commit()

        # Calculate total duration for logging
        total_duration = sum(
            max(0, (clip['end_time'] or 0) - (clip['start_time'] or 0))
            for clip in clips
        )

        logger.info(
            f"Created project {project_id} with {len(clips)} clips "
            f"(total duration: {total_duration:.1f}s)"
        )

        return ProjectResponse(
            id=project_id,
            name=request.name,
            aspect_ratio=request.aspect_ratio,
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
        cursor.execute(f"""
            SELECT
                wc.id,
                wc.raw_clip_id,
                wc.uploaded_filename,
                wc.exported_at,
                wc.sort_order,
                rc.filename as raw_filename,
                rc.name as raw_name,
                rc.notes as raw_notes
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.project_id = ?
            AND wc.id IN ({latest_working_clips_subquery()})
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
                name=clip['raw_name'],
                notes=clip['raw_notes'],
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
    - Have exported_at IS NULL (not exported)
    - Have version > 1 (are newer versions of exported clips)

    After deletion, the previous exported version becomes the "latest" again.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # Find and delete uncommitted versions (exported_at IS NULL, version > 1)
        # These are newer versions of clips that were previously exported
        cursor.execute("""
            DELETE FROM working_clips
            WHERE project_id = ? AND exported_at IS NULL AND version > 1
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
    from app.database import get_working_videos_path

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

        video_path = get_working_videos_path() / row['filename']
        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Working video file not found on disk")

        return FileResponse(
            video_path,
            media_type="video/mp4",
            filename=row['filename']
        )
