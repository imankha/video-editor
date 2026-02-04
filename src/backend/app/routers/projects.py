"""
Project management endpoints.

Projects organize clips for editing through Framing and Overlay modes.
Each project has an aspect ratio (16:9 or 9:16) and contains working clips.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json
import logging

from app.database import get_db_connection
from app.queries import latest_working_clips_subquery, derive_clip_name
from app.user_context import get_current_user_id
from app.storage import R2_ENABLED, generate_presigned_url

logger = logging.getLogger(__name__)


def get_working_video_url(filename: str) -> Optional[str]:
    """Get presigned URL for working video if R2 is enabled."""
    if not R2_ENABLED or not filename:
        return None

    user_id = get_current_user_id()
    return generate_presigned_url(
        user_id=user_id,
        relative_path=f"working_videos/{filename}",
        expires_in=3600,
        content_type="video/mp4"
    )


def _get_season_for_month(month: int) -> str:
    """Get season name for a given month (1-12)."""
    if month in (9, 10, 11, 12):  # Sep-Dec
        return "Fall"
    elif month in (1, 2, 3, 4, 5):  # Jan-May
        return "Spring"
    else:  # Jun-Aug
        return "Summer"


def _generate_game_display_name(
    opponent_name: Optional[str],
    game_date: Optional[str],
    game_type: Optional[str],
    tournament_name: Optional[str],
    fallback_name: str
) -> str:
    """
    Generate a display name for a game based on its details.

    Format:
    - Home: "Vs <Opponent> <Date>"
    - Away: "at <Opponent> <Date>"
    - Tournament: "<Tournament>: Vs <Opponent> <Date>"
    """
    if not opponent_name:
        return fallback_name

    # Format date as "Mon D" (e.g., "Dec 6")
    date_str = ""
    if game_date:
        try:
            dt = datetime.strptime(game_date, "%Y-%m-%d")
            date_str = dt.strftime("%b %d").lstrip("0").replace(" 0", " ")  # Remove leading zeros
        except (ValueError, Exception):
            date_str = game_date

    # Build the name based on game type
    if game_type == 'tournament' and tournament_name:
        prefix = f"{tournament_name}: Vs"
    elif game_type == 'away':
        prefix = "at"
    else:  # home or default
        prefix = "Vs"

    parts = [prefix, opponent_name]
    if date_str:
        parts.append(date_str)

    return " ".join(parts)


def _generate_group_key(game_names: List[str], game_dates: List[str]) -> Optional[str]:
    """
    Generate a group key for a project based on its games.

    - Single game: Use game's display name
    - Multiple games from same season/year: Use "Fall 2025" format
    - Multiple games spanning years: Use "2024-2025" format
    - No games: Return None
    """
    if not game_names:
        return None

    if len(game_names) == 1:
        return game_names[0]

    # Parse dates to extract years and seasons
    years = set()
    seasons_by_year = {}

    for date_str in game_dates:
        if not date_str:
            continue
        try:
            # Parse ISO date format (YYYY-MM-DD)
            parts = date_str.split('-')
            if len(parts) >= 2:
                year = int(parts[0])
                month = int(parts[1])
                years.add(year)
                season = _get_season_for_month(month)
                if year not in seasons_by_year:
                    seasons_by_year[year] = set()
                seasons_by_year[year].add(season)
        except (ValueError, IndexError):
            continue

    if not years:
        # No valid dates, fall back to listing game names
        return " / ".join(game_names[:2]) + ("..." if len(game_names) > 2 else "")

    years_list = sorted(years)

    if len(years_list) == 1:
        year = years_list[0]
        seasons = seasons_by_year.get(year, set())
        if len(seasons) == 1:
            return f"{list(seasons)[0]} {year}"
        return str(year)
    else:
        # Multiple years
        return f"{min(years_list)}-{max(years_list)}"


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
    clip_ids: Optional[List[int]] = None  # If provided, use these specific clips instead of filters


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


class ClipSummary(BaseModel):
    """Summary info for a clip in a project (for project card display)."""
    id: int
    name: Optional[str] = None
    tags: List[str] = []
    rating: Optional[int] = None
    is_extracted: bool = True
    is_extracting: bool = False


class ProjectListItem(BaseModel):
    id: int
    name: str
    aspect_ratio: str
    clip_count: int
    clips_exported: int  # Clips with exported_at IS NOT NULL (included in working video)
    clips_in_progress: int  # Clips with edits but not yet exported
    clips_extracted: int  # Clips with video file ready (filename IS NOT NULL)
    clips_extracting: int  # Clips currently being extracted (modal_tasks running)
    clips_pending_extraction: int  # Clips waiting to be extracted (modal_tasks pending)
    has_working_video: bool
    has_overlay_edits: bool
    has_final_video: bool
    is_auto_created: bool  # True if project was auto-created for a 5-star clip
    created_at: str
    current_mode: Optional[str] = 'framing'
    last_opened_at: Optional[str] = None
    # Game grouping info
    game_ids: List[int] = []  # List of game IDs for clips in this project
    game_names: List[str] = []  # Display names for those games
    game_dates: List[str] = []  # Game dates (for season/year grouping)
    group_key: Optional[str] = None  # Group key for hierarchical display
    # Clip details for card display
    clips: List[ClipSummary] = []  # Info about each clip in the project


class WorkingClipResponse(BaseModel):
    id: int
    raw_clip_id: Optional[int]
    uploaded_filename: Optional[str]
    filename: str  # Resolved filename (from raw_clips or uploaded)
    name: Optional[str] = None  # Human-readable name from raw_clips
    notes: Optional[str] = None  # Notes from raw_clips
    tags: List[str] = []  # Tags from raw_clips (for auto-generated names)
    rating: Optional[int] = None  # Rating from raw_clips (for auto-generated names)
    exported_at: Optional[str] = None  # ISO timestamp when clip was exported
    sort_order: int
    # Extraction status
    is_extracted: bool = True  # True if video file is ready (filename exists)
    is_extracting: bool = False  # True if extraction is in progress
    extraction_status: Optional[str] = None  # 'pending', 'running', 'completed', 'failed', or None


class ProjectDetailResponse(BaseModel):
    id: int
    name: str
    aspect_ratio: str
    working_video_id: Optional[int]
    working_video_url: Optional[str] = None  # Presigned R2 URL for streaming
    final_video_id: Optional[int]
    clips: List[WorkingClipResponse]
    created_at: str
    is_auto_created: bool = False  # True if auto-created from 5-star clips


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
                CASE WHEN fv.id IS NOT NULL THEN 1 ELSE 0 END as has_final_video,
                -- Check if project was auto-created for a 5-star clip
                CASE WHEN EXISTS (
                    SELECT 1 FROM raw_clips rc WHERE rc.auto_project_id = p.id
                ) THEN 1 ELSE 0 END as is_auto_created
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

        # Fetch game info for all projects in one query
        # This traces: project -> working_clips -> raw_clips -> games
        # Fetch all game detail columns for proper display name generation
        cursor.execute("""
            SELECT DISTINCT
                wc.project_id,
                g.id as game_id,
                g.name as game_name,
                g.game_date,
                g.opponent_name,
                g.game_type,
                g.tournament_name
            FROM working_clips wc
            JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            JOIN games g ON rc.game_id = g.id
            WHERE rc.game_id IS NOT NULL
            ORDER BY wc.project_id, g.game_date
        """)
        game_rows = cursor.fetchall()

        # Build a map of project_id -> game info
        project_games = {}
        for game_row in game_rows:
            project_id = game_row['project_id']
            if project_id not in project_games:
                project_games[project_id] = {
                    'game_ids': [],
                    'game_names': [],
                    'game_dates': []
                }
            # Avoid duplicates (can happen with multiple clips from same game)
            if game_row['game_id'] not in project_games[project_id]['game_ids']:
                project_games[project_id]['game_ids'].append(game_row['game_id'])
                # Generate display name from game details (not stored name which may be filename)
                display_name = _generate_game_display_name(
                    game_row['opponent_name'],
                    game_row['game_date'],
                    game_row['game_type'],
                    game_row['tournament_name'],
                    game_row['game_name'] or f"Game {game_row['game_id']}"
                )
                project_games[project_id]['game_names'].append(display_name)
                project_games[project_id]['game_dates'].append(game_row['game_date'] or '')

        # Fetch extraction status for all projects
        # Counts clips that are: extracted (have filename), extracting (running task), pending (pending task)
        # Uses UNION to count clips for both:
        #   1. Auto-created projects (via auto_project_id)
        #   2. Manual projects (via working_clips.project_id)
        # A clip can appear in multiple projects, so we use UNION ALL then aggregate
        cursor.execute("""
            SELECT project_id,
                SUM(is_extracted) as extracted,
                SUM(is_extracting) as extracting,
                SUM(is_pending) as pending
            FROM (
                -- Auto-created projects: clips linked via auto_project_id
                SELECT
                    rc.auto_project_id as project_id,
                    CASE WHEN rc.filename IS NOT NULL AND rc.filename != '' THEN 1 ELSE 0 END as is_extracted,
                    CASE WHEN mt.status = 'running' THEN 1 ELSE 0 END as is_extracting,
                    CASE WHEN mt.status = 'pending' THEN 1 ELSE 0 END as is_pending
                FROM raw_clips rc
                LEFT JOIN modal_tasks mt ON mt.raw_clip_id = rc.id AND mt.task_type = 'clip_extraction' AND mt.status IN ('pending', 'running')
                WHERE rc.auto_project_id IS NOT NULL

                UNION ALL

                -- Manual projects: clips linked via working_clips
                SELECT
                    wc.project_id as project_id,
                    CASE WHEN rc.filename IS NOT NULL AND rc.filename != '' THEN 1 ELSE 0 END as is_extracted,
                    CASE WHEN mt.status = 'running' THEN 1 ELSE 0 END as is_extracting,
                    CASE WHEN mt.status = 'pending' THEN 1 ELSE 0 END as is_pending
                FROM working_clips wc
                JOIN raw_clips rc ON rc.id = wc.raw_clip_id
                LEFT JOIN modal_tasks mt ON mt.raw_clip_id = rc.id AND mt.task_type = 'clip_extraction' AND mt.status IN ('pending', 'running')
            ) combined
            GROUP BY project_id
        """)
        extraction_rows = cursor.fetchall()

        # Build a map of project_id -> extraction status
        project_extraction = {}
        for ext_row in extraction_rows:
            project_extraction[ext_row['project_id']] = {
                'extracted': ext_row['extracted'] or 0,
                'extracting': ext_row['extracting'] or 0,
                'pending': ext_row['pending'] or 0
            }

        # Fetch clip details for each project (names, tags, extraction status)
        # Uses UNION to get clips for both auto-created and manual projects
        cursor.execute("""
            SELECT project_id, clip_id, name, tags, rating, is_extracted, is_extracting, sort_order
            FROM (
                -- Auto-created projects: clips linked via auto_project_id
                SELECT
                    rc.auto_project_id as project_id,
                    rc.id as clip_id,
                    rc.name,
                    rc.tags,
                    rc.rating,
                    CASE WHEN rc.filename IS NOT NULL AND rc.filename != '' THEN 1 ELSE 0 END as is_extracted,
                    CASE WHEN mt.status = 'running' THEN 1 ELSE 0 END as is_extracting,
                    0 as sort_order
                FROM raw_clips rc
                LEFT JOIN modal_tasks mt ON mt.raw_clip_id = rc.id AND mt.task_type = 'clip_extraction' AND mt.status IN ('pending', 'running')
                WHERE rc.auto_project_id IS NOT NULL

                UNION ALL

                -- Manual projects: clips linked via working_clips
                SELECT
                    wc.project_id as project_id,
                    rc.id as clip_id,
                    rc.name,
                    rc.tags,
                    rc.rating,
                    CASE WHEN rc.filename IS NOT NULL AND rc.filename != '' THEN 1 ELSE 0 END as is_extracted,
                    CASE WHEN mt.status = 'running' THEN 1 ELSE 0 END as is_extracting,
                    wc.sort_order
                FROM working_clips wc
                JOIN raw_clips rc ON rc.id = wc.raw_clip_id
                LEFT JOIN modal_tasks mt ON mt.raw_clip_id = rc.id AND mt.task_type = 'clip_extraction' AND mt.status IN ('pending', 'running')
            ) combined
            ORDER BY project_id, sort_order, clip_id
        """)
        clip_rows = cursor.fetchall()

        # Build a map of project_id -> list of clips
        project_clips = {}
        for clip_row in clip_rows:
            project_id = clip_row['project_id']
            if project_id not in project_clips:
                project_clips[project_id] = []
            # Parse tags JSON if present
            tags = []
            if clip_row['tags']:
                try:
                    tags = json.loads(clip_row['tags']) if isinstance(clip_row['tags'], str) else clip_row['tags']
                except:
                    tags = []
            project_clips[project_id].append(ClipSummary(
                id=clip_row['clip_id'],
                name=clip_row['name'],
                tags=tags,
                rating=clip_row['rating'],
                is_extracted=bool(clip_row['is_extracted']),
                is_extracting=bool(clip_row['is_extracting'])
            ))

        result = []
        for row in rows:
            project_id = row['id']
            game_info = project_games.get(project_id, {
                'game_ids': [],
                'game_names': [],
                'game_dates': []
            })
            extraction_info = project_extraction.get(project_id, {
                'extracted': 0,
                'extracting': 0,
                'pending': 0
            })

            # Generate group key
            group_key = _generate_group_key(
                game_info['game_names'],
                game_info['game_dates']
            )

            result.append(ProjectListItem(
                id=row['id'],
                name=row['name'],
                aspect_ratio=row['aspect_ratio'],
                clip_count=row['clip_count'],
                clips_exported=row['clips_exported'],
                clips_in_progress=row['clips_in_progress'],
                clips_extracted=extraction_info['extracted'],
                clips_extracting=extraction_info['extracting'],
                clips_pending_extraction=extraction_info['pending'],
                has_working_video=bool(row['has_working_video']),
                has_overlay_edits=bool(row['has_overlay_edits']),
                has_final_video=bool(row['has_final_video']),
                is_auto_created=bool(row['is_auto_created']),
                created_at=row['created_at'],
                current_mode=row['current_mode'] or 'framing',
                clips=project_clips.get(project_id, []),
                last_opened_at=row['last_opened_at'],
                game_ids=game_info['game_ids'],
                game_names=game_info['game_names'],
                game_dates=game_info['game_dates'],
                group_key=group_key
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
            SELECT id, filename, rating, tags, name, notes, start_time, end_time, game_id,
                   COALESCE(boundaries_version, 1) as boundaries_version
            FROM raw_clips
            WHERE 1=1
        """
        params = []
    else:
        query = """
            SELECT id, filename, rating, tags, name, notes, start_time, end_time, game_id,
                   COALESCE(boundaries_version, 1) as boundaries_version
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
            clip_name = derive_clip_name(clip['name'], clip['rating'] or 0, tags) or f"Clip {clip['id']}"
            clips_info.append({
                'id': clip['id'],
                'name': clip_name,
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

    If clip_ids is provided, use those specific clips (in order).
    Otherwise, filter clips by:
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

        # Get clips - either by specific IDs or by filters
        if request.clip_ids is not None and len(request.clip_ids) > 0:
            # Use specific clip IDs (preserves order)
            placeholders = ','.join(['?' for _ in request.clip_ids])
            cursor.execute(f"""
                SELECT id, filename, rating, tags, name, notes, start_time, end_time, game_id,
                       COALESCE(boundaries_version, 1) as boundaries_version
                FROM raw_clips
                WHERE id IN ({placeholders})
            """, request.clip_ids)
            rows = cursor.fetchall()
            # Re-order rows to match the order of clip_ids
            clips_by_id = {row['id']: row for row in rows}
            clips = [clips_by_id[cid] for cid in request.clip_ids if cid in clips_by_id]
        else:
            # Use filter-based query
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
        # Capture the raw_clip's current boundaries_version for change detection
        for sort_order, clip in enumerate(clips):
            cursor.execute("""
                INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version, raw_clip_version)
                VALUES (?, ?, ?, 1, ?)
            """, (project_id, clip['id'], sort_order, clip['boundaries_version']))

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

        # Get project with working video filename for URL generation
        cursor.execute("""
            SELECT p.id, p.name, p.aspect_ratio, p.working_video_id, p.final_video_id, p.created_at,
                   p.is_auto_created,
                   wv.filename as working_video_filename
            FROM projects p
            LEFT JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Get working clips with resolved filenames and extraction status
        # (latest version of each clip only, grouped by end_time)
        cursor.execute(f"""
            SELECT
                wc.id,
                wc.raw_clip_id,
                wc.uploaded_filename,
                wc.exported_at,
                wc.sort_order,
                rc.filename as raw_filename,
                rc.name as raw_name,
                rc.notes as raw_notes,
                rc.tags as raw_tags,
                rc.rating as raw_rating,
                mt.status as extraction_status
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            LEFT JOIN modal_tasks mt ON mt.raw_clip_id = rc.id
                AND mt.task_type = 'clip_extraction'
                AND mt.status IN ('pending', 'running')
            WHERE wc.project_id = ?
            AND wc.id IN ({latest_working_clips_subquery()})
            ORDER BY wc.sort_order
        """, (project_id, project_id))
        clips_rows = cursor.fetchall()

        clips = []
        for clip in clips_rows:
            # Resolve filename
            raw_filename = clip['raw_filename'] or ''
            filename = raw_filename or clip['uploaded_filename'] or 'unknown'
            # Extraction status
            is_extracted = bool(raw_filename) or bool(clip['uploaded_filename'])
            extraction_status = clip['extraction_status']
            is_extracting = extraction_status == 'running'
            # Parse tags JSON
            tags = []
            if clip['raw_tags']:
                try:
                    tags = json.loads(clip['raw_tags'])
                except json.JSONDecodeError:
                    tags = []

            clips.append(WorkingClipResponse(
                id=clip['id'],
                raw_clip_id=clip['raw_clip_id'],
                uploaded_filename=clip['uploaded_filename'],
                filename=filename,
                name=clip['raw_name'],
                notes=clip['raw_notes'],
                tags=tags,
                rating=clip['raw_rating'],
                exported_at=clip['exported_at'],
                sort_order=clip['sort_order'],
                is_extracted=is_extracted,
                is_extracting=is_extracting,
                extraction_status=extraction_status
            ))

        # Generate presigned URL for working video if it exists
        working_video_url = None
        if project['working_video_filename']:
            working_video_url = get_working_video_url(project['working_video_filename'])

        return ProjectDetailResponse(
            id=project['id'],
            name=project['name'],
            aspect_ratio=project['aspect_ratio'],
            working_video_id=project['working_video_id'],
            working_video_url=working_video_url,
            final_video_id=project['final_video_id'],
            clips=clips,
            created_at=project['created_at'],
            is_auto_created=bool(project['is_auto_created'])
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
    Get the working video file for a project. Redirects to R2 when enabled.
    Returns the video file if it exists, 404 otherwise.
    """
    from fastapi.responses import FileResponse, RedirectResponse
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

        # If R2 enabled, redirect to presigned URL
        if R2_ENABLED:
            presigned_url = get_working_video_url(row['filename'])
            if presigned_url:
                return RedirectResponse(url=presigned_url, status_code=302)
            raise HTTPException(status_code=404, detail="Failed to generate R2 URL")

        # Local mode: serve from filesystem
        video_path = get_working_videos_path() / row['filename']
        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Working video file not found on disk")

        return FileResponse(
            video_path,
            media_type="video/mp4",
            filename=row['filename']
        )


class OutdatedClipInfo(BaseModel):
    working_clip_id: int
    raw_clip_id: int
    clip_name: str
    framed_version: int
    current_version: int
    boundaries_updated_at: Optional[str] = None


class OutdatedClipsResponse(BaseModel):
    has_outdated_clips: bool
    outdated_clips: List[OutdatedClipInfo]


@router.get("/{project_id}/outdated-clips", response_model=OutdatedClipsResponse)
async def check_outdated_clips(project_id: int):
    """
    Check if any working clips in a project have outdated annotation boundaries.

    Compares each working_clip's raw_clip_version (captured when framing was done)
    against the raw_clip's current boundaries_version. If they differ, it means
    the annotation boundaries (start/end time) were changed after framing.

    Returns a list of outdated clips so the frontend can prompt the user to
    either use the latest clip boundaries or continue with original framing.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # Get latest version of each working clip and compare with raw_clip boundaries
        cursor.execute(f"""
            SELECT
                wc.id as working_clip_id,
                wc.raw_clip_id,
                wc.raw_clip_version,
                rc.boundaries_version,
                rc.boundaries_updated_at,
                rc.start_time,
                rc.end_time,
                rc.name as clip_name,
                rc.rating,
                rc.tags
            FROM working_clips wc
            JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.id IN ({latest_working_clips_subquery()})
              AND wc.project_id = ?
        """, (project_id, project_id))

        rows = cursor.fetchall()
        outdated_clips = []

        for row in rows:
            framed_version = row['raw_clip_version'] or 1
            current_version = row['boundaries_version'] or 1

            if framed_version < current_version:
                # Derive a display name for the clip
                tags = json.loads(row['tags']) if row['tags'] else []
                clip_name = derive_clip_name(
                    row['clip_name'],
                    row['rating'] or 3,
                    tags
                )

                outdated_clips.append(OutdatedClipInfo(
                    working_clip_id=row['working_clip_id'],
                    raw_clip_id=row['raw_clip_id'],
                    clip_name=clip_name,
                    framed_version=framed_version,
                    current_version=current_version,
                    boundaries_updated_at=row['boundaries_updated_at']
                ))

        return OutdatedClipsResponse(
            has_outdated_clips=len(outdated_clips) > 0,
            outdated_clips=outdated_clips
        )


class RefreshClipsRequest(BaseModel):
    working_clip_ids: List[int]


class RefreshClipsResponse(BaseModel):
    success: bool
    refreshed_count: int
    extraction_triggered: bool = False


@router.post("/{project_id}/refresh-outdated-clips", response_model=RefreshClipsResponse)
async def refresh_outdated_clips(project_id: int, request: RefreshClipsRequest, background_tasks: BackgroundTasks):
    """
    Refresh outdated working clips to use latest annotation boundaries.

    This resets the framing data (crop_data, timing_data, segments_data) for the
    specified working clips and updates their raw_clip_version to match the current
    boundaries_version of the raw clip.

    Also clears the raw_clip filename and triggers re-extraction with new boundaries.

    Use this when the user chooses "Use Latest Clips" after being informed that
    some clips have outdated annotation boundaries.
    """
    from app.services.modal_queue import enqueue_clip_extraction, run_queue_processor_sync

    clips_to_extract = []

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        refreshed_count = 0

        for working_clip_id in request.working_clip_ids:
            # Verify clip belongs to project and get raw_clip info for extraction
            cursor.execute("""
                SELECT wc.id, wc.raw_clip_id, rc.boundaries_version,
                       rc.start_time, rc.end_time, rc.game_id, g.video_filename
                FROM working_clips wc
                JOIN raw_clips rc ON wc.raw_clip_id = rc.id
                LEFT JOIN games g ON rc.game_id = g.id
                WHERE wc.id = ? AND wc.project_id = ?
            """, (working_clip_id, project_id))

            row = cursor.fetchone()
            if not row:
                logger.warning(f"Working clip {working_clip_id} not found in project {project_id}")
                continue

            current_boundaries_version = row['boundaries_version'] or 1

            # Reset framing data and update raw_clip_version
            cursor.execute("""
                UPDATE working_clips
                SET crop_data = NULL,
                    timing_data = NULL,
                    segments_data = NULL,
                    raw_clip_version = ?,
                    exported_at = NULL
                WHERE id = ?
            """, (current_boundaries_version, working_clip_id))

            # Clear raw_clip filename to mark for re-extraction
            cursor.execute("""
                UPDATE raw_clips SET filename = '' WHERE id = ?
            """, (row['raw_clip_id'],))

            # Collect info for extraction if we have game video
            if row['game_id'] and row['video_filename']:
                clips_to_extract.append({
                    'clip_id': row['raw_clip_id'],
                    'start_time': row['start_time'],
                    'end_time': row['end_time'],
                    'game_id': row['game_id'],
                    'video_filename': row['video_filename'],
                    'project_id': project_id,
                })

            refreshed_count += 1
            logger.info(f"Refreshed working clip {working_clip_id} to boundaries version {current_boundaries_version}")

        conn.commit()

        # If any clips were refreshed, clear project working video since framing is now incomplete
        if refreshed_count > 0:
            cursor.execute("""
                UPDATE projects
                SET working_video_id = NULL, final_video_id = NULL
                WHERE id = ?
            """, (project_id,))
            conn.commit()
            logger.info(f"Cleared working/final video for project {project_id} after refreshing clips")

    # Trigger extraction for clips with updated boundaries (outside DB connection)
    user_id = get_current_user_id()
    for clip_info in clips_to_extract:
        enqueue_clip_extraction(
            clip_id=clip_info['clip_id'],
            project_id=clip_info['project_id'],
            game_id=clip_info['game_id'],
            video_filename=clip_info['video_filename'],
            start_time=clip_info['start_time'],
            end_time=clip_info['end_time'],
            user_id=user_id,
        )

    if clips_to_extract:
        background_tasks.add_task(run_queue_processor_sync)
        logger.info(f"Enqueued {len(clips_to_extract)} clips for re-extraction after boundary update")

    return RefreshClipsResponse(
        success=True,
        refreshed_count=refreshed_count,
        extraction_triggered=len(clips_to_extract) > 0
    )
