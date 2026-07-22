"""
Project management endpoints.

Projects organize clips for editing through Framing and Overlay modes.
Each project has an aspect ratio (16:9 or 9:16) and contains working clips.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from app.database import get_db_connection
from app.queries import derive_clip_name, latest_working_clips_subquery
from app.services.collection_metadata import compute_unified_clip_start
from app.storage import R2_ENABLED, generate_presigned_url
from app.user_context import get_current_user_id
from app.utils.encoding import decode_data, encode_data

logger = logging.getLogger(__name__)


def get_working_video_url(project_id: int, filename: str) -> str | None:
    """
    Return the URL the frontend should hand to its <video> element for a
    project's working video.

    Today this is the same-origin proxy at
    `/api/projects/{project_id}/working_video/stream`, NOT a presigned R2
    URL. Why: R2's S3-compat endpoint speaks HTTP/1.1, which Chrome caps at
    6 sockets per origin. With the warmer + previous loads occupying that
    pool, foreground fetches to R2 routinely sat in "Stalled" state forever.
    Routing through localhost lets the browser use unlimited connections;
    the backend (httpx) talks to R2 from a separate, server-side pool.

    The proxy forwards Range requests to R2 so seek/scrub still works.
    """
    if not R2_ENABLED or not filename:
        return None
    return f"/api/projects/{project_id}/working_video/stream"


def _generate_working_video_presigned_url(filename: str) -> str | None:
    """Internal: presigned R2 URL the proxy fetches from."""
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
    opponent_name: str | None,
    game_date: str | None,
    game_type: str | None,
    tournament_name: str | None,
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


def _generate_group_key(game_names: list[str], game_dates: list[str]) -> str | None:
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


class ProjectRename(BaseModel):
    """PUT /projects/{id} payload. Rename ONLY -- aspect_ratio is deliberately not
    accepted here. It has exactly one writer, POST /clips/projects/{id}/aspect-ratio
    (T3910), which re-fits every clip's crop keyframes when the ratio changes. Letting
    this PUT write a stale cached aspect_ratio (e.g. from a rename right after a ratio
    change) would leave crops shaped for the new ratio while the DB claims the old one,
    rendering wrong-shaped crops at export. See T4230."""
    name: str


class ProjectFromClipsCreate(BaseModel):
    """Create a project pre-populated with filtered clips."""
    name: str
    aspect_ratio: str = "16:9"
    game_ids: list[int] = []  # Empty = all games
    min_rating: int = 1
    tags: list[str] = []  # Empty = all tags
    clip_ids: list[int] | None = None  # If provided, use these specific clips instead of filters


class ClipsPreviewRequest(BaseModel):
    """Request body for previewing clips that would be included in a project."""
    game_ids: list[int] = []
    min_rating: int = 1
    tags: list[str] = []


class ClipsPreviewResponse(BaseModel):
    """Preview of clips matching the filter criteria."""
    clip_count: int
    total_duration: float  # In seconds
    clips: list[dict]  # Brief clip info for display


class ProjectResponse(BaseModel):
    id: int
    name: str
    aspect_ratio: str
    working_video_id: int | None
    final_video_id: int | None
    created_at: str


class ClipSummary(BaseModel):
    """Summary info for a clip in a project (for project card display)."""
    id: int
    name: str | None = None
    tags: list[str] = []
    rating: int | None = None


class ProjectListItem(BaseModel):
    id: int
    name: str
    aspect_ratio: str
    clip_count: int
    clips_exported: int  # Clips with exported_at IS NOT NULL (included in working video)
    clips_in_progress: int  # Clips with edits but not yet exported
    has_working_video: bool
    working_video_created_at: str | None = None
    has_overlay_edits: bool
    has_final_video: bool
    final_video_created_at: str | None = None
    final_video_id: int | None = None
    is_published: bool  # True if latest final video has been published to My Reels
    is_auto_created: bool  # True if project was auto-created for a 5-star clip
    created_at: str
    current_mode: str | None = 'framing'
    last_opened_at: str | None = None
    # Game grouping info
    game_ids: list[int] = []  # List of game IDs for clips in this project
    game_names: list[str] = []  # Display names for those games
    game_dates: list[str] = []  # Game dates (for season/year grouping)
    group_key: str | None = None  # Group key for hierarchical display
    # Clip details for card display
    clips: list[ClipSummary] = []  # Info about each clip in the project
    # Unified two-half in-match start (sec) for single-clip drafts; soccer-notation
    # card mark (T3920). Computed at read-time (drafts have no frozen final_video).
    # NULL for multi-clip drafts.
    clip_game_start_time: float | None = None


class WorkingClipResponse(BaseModel):
    id: int
    raw_clip_id: int | None
    uploaded_filename: str | None
    filename: str  # Resolved filename (from raw_clips or uploaded)
    name: str | None = None  # Human-readable name from raw_clips
    notes: str | None = None  # Notes from raw_clips
    tags: list[str] = []  # Tags from raw_clips (for auto-generated names)
    rating: int | None = None  # Rating from raw_clips (for auto-generated names)
    exported_at: str | None = None  # ISO timestamp when clip was exported
    sort_order: int


class ProjectDetailResponse(BaseModel):
    id: int
    name: str
    aspect_ratio: str
    working_video_id: int | None
    working_video_url: str | None = None  # Presigned R2 URL for streaming
    working_video_created_at: str | None = None
    final_video_id: int | None
    has_final_video: bool = False
    final_video_created_at: str | None = None
    clips: list[WorkingClipResponse]
    created_at: str
    is_auto_created: bool = False  # True if auto-created from 5-star clips


@router.get("", response_model=list[ProjectListItem])
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
                wv.created_at as working_video_created_at,
                -- Check for overlay edits (highlights or text overlays with actual content)
                CASE WHEN (
                    (wv.highlights_data IS NOT NULL AND wv.highlights_data != '[]' AND wv.highlights_data != '') OR
                    (wv.text_overlays IS NOT NULL AND wv.text_overlays != '[]' AND wv.text_overlays != '')
                ) THEN 1 ELSE 0 END as has_overlay_edits,
                -- Final video info (check if ANY final video exists for this project)
                CASE WHEN EXISTS (
                    SELECT 1 FROM final_videos WHERE project_id = p.id
                ) THEN 1 ELSE 0 END as has_final_video,
                (SELECT MAX(fv2.created_at) FROM final_videos fv2 WHERE fv2.project_id = p.id) as final_video_created_at,
                -- Published status (latest final video has published_at set)
                CASE WHEN EXISTS (
                    SELECT 1 FROM final_videos
                    WHERE project_id = p.id AND published_at IS NOT NULL
                ) THEN 1 ELSE 0 END as is_published,
                -- Check if project was auto-created for a 5-star clip
                CASE WHEN EXISTS (
                    SELECT 1 FROM raw_clips rc WHERE rc.auto_project_id = p.id
                ) THEN 1 ELSE 0 END as is_auto_created
            FROM projects p
            LEFT JOIN (
                -- Subquery for clip counts per project (latest version only)
                -- Uses ROW_NUMBER to handle duplicate clips at same version level
                -- Identity: COALESCE(rc.end_time, wc.uploaded_filename) - matches queries.py
                SELECT
                    project_id,
                    COUNT(*) as total,
                    SUM(CASE WHEN exported_at IS NOT NULL THEN 1 ELSE 0 END) as exported,
                    SUM(CASE WHEN exported_at IS NULL AND (
                        crop_data IS NOT NULL OR
                        segments_data IS NOT NULL OR
                        timing_data IS NOT NULL
                    ) THEN 1 ELSE 0 END) as in_progress
                FROM (
                    SELECT wc.*, ROW_NUMBER() OVER (
                        PARTITION BY wc.project_id, COALESCE(rc.end_time, wc.uploaded_filename)
                        ORDER BY wc.version DESC, wc.id DESC
                    ) as rn
                    FROM working_clips wc
                    LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
                ) latest_clips
                WHERE rn = 1
                GROUP BY project_id
            ) clip_stats ON p.id = clip_stats.project_id
            LEFT JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.archived_at IS NULL
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

        # Fetch clip details for each project (names, tags, rating)
        cursor.execute("""
            SELECT project_id, clip_id, name, tags, rating, sort_order, start_time
            FROM (
                SELECT rc.auto_project_id as project_id, rc.id as clip_id,
                    rc.name, rc.tags, rc.rating,
                    0 as sort_order, rc.start_time
                FROM raw_clips rc
                WHERE rc.auto_project_id IS NOT NULL

                UNION ALL

                SELECT wc.project_id as project_id, rc.id as clip_id,
                    rc.name, rc.tags, rc.rating,
                    wc.sort_order, rc.start_time
                FROM working_clips wc
                JOIN raw_clips rc ON rc.id = wc.raw_clip_id
            ) combined
            ORDER BY project_id, sort_order, clip_id
        """)
        clip_rows = cursor.fetchall()

        # Build a map of project_id -> list of clips, plus distinct source-clip
        # start_times (keyed by clip_id so the auto_project_id + working_clips
        # UNION can't double-count one clip) for the single-clip game time (T3920).
        project_clips = {}
        project_clip_starts = {}
        for clip_row in clip_rows:
            project_id = clip_row['project_id']
            if project_id not in project_clips:
                project_clips[project_id] = []
                project_clip_starts[project_id] = {}
            tags = decode_data(clip_row['tags']) or []
            project_clips[project_id].append(ClipSummary(
                id=clip_row['clip_id'],
                name=clip_row['name'],
                tags=tags,
                rating=clip_row['rating']
            ))
            project_clip_starts[project_id].setdefault(
                clip_row['clip_id'], clip_row['start_time'])

        result = []
        for row in rows:
            project_id = row['id']
            game_info = project_games.get(project_id, {
                'game_ids': [],
                'game_names': [],
                'game_dates': []
            })

            # Generate group key
            group_key = _generate_group_key(
                game_info['game_names'],
                game_info['game_dates']
            )

            # T3920: unified in-match start for single-clip drafts (the same
            # file-relative + prior-half offset frozen on export). Multi-clip or
            # clipless -> None. Keyed on distinct source clips, not clip_count
            # (auto-drafts have a raw_clip but no working_clips row).
            clip_game_start_time = None
            clip_starts = project_clip_starts.get(project_id, {})
            if len(clip_starts) == 1:
                source_clip_id, clip_start_time = next(iter(clip_starts.items()))
                clip_game_start_time = compute_unified_clip_start(
                    cursor, source_clip_id, clip_start_time)

            result.append(ProjectListItem(
                id=row['id'],
                name=row['name'],
                aspect_ratio=row['aspect_ratio'],
                clip_count=row['clip_count'],
                clips_exported=row['clips_exported'],
                clips_in_progress=row['clips_in_progress'],
                has_working_video=bool(row['has_working_video']),
                working_video_created_at=row['working_video_created_at'],
                has_overlay_edits=bool(row['has_overlay_edits']),
                has_final_video=bool(row['has_final_video']),
                final_video_created_at=row['final_video_created_at'],
                final_video_id=row['final_video_id'],
                is_published=bool(row['is_published']),
                is_auto_created=bool(row['is_auto_created']),
                created_at=row['created_at'],
                current_mode=row['current_mode'] or 'framing',
                clips=project_clips.get(project_id, []),
                last_opened_at=row['last_opened_at'],
                game_ids=game_info['game_ids'],
                game_names=game_info['game_names'],
                game_dates=game_info['game_dates'],
                group_key=group_key,
                clip_game_start_time=clip_game_start_time
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


def _build_clips_filter_query(game_ids: list[int], min_rating: int, tags: list[str]):
    """Build SQL query and params for filtering raw clips."""
    # min_rating = 0 means "All clips" (include everything regardless of rating)
    if min_rating <= 0:
        query = """
            SELECT rc.id, rc.filename, rc.rating, rc.tags, rc.name, rc.notes,
                   rc.start_time, rc.end_time, rc.game_id,
                   COALESCE(rc.boundaries_version, 1) as boundaries_version
            FROM raw_clips rc
            WHERE 1=1
        """
        params = []
    else:
        query = """
            SELECT rc.id, rc.filename, rc.rating, rc.tags, rc.name, rc.notes,
                   rc.start_time, rc.end_time, rc.game_id,
                   COALESCE(rc.boundaries_version, 1) as boundaries_version
            FROM raw_clips rc
            WHERE COALESCE(rc.rating, 0) >= ?
        """
        params = [min_rating]

    if game_ids:
        placeholders = ','.join(['?' for _ in game_ids])
        query += f" AND rc.game_id IN ({placeholders})"
        params.extend(game_ids)

    # Tag filtering - clips must have ALL specified tags
    # Tags are stored as JSON array, so we need to check each tag
    if tags:
        for tag in tags:
            query += " AND rc.tags LIKE ?"
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

            tags = decode_data(clip['tags']) or []
            clip_name = derive_clip_name(clip['name'], clip['rating'] or 0, tags, clip['notes'] or '') or f"Clip {clip['id']}"
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
                SELECT rc.id, rc.filename, rc.rating, rc.tags, rc.name, rc.notes,
                       rc.start_time, rc.end_time, rc.game_id,
                       COALESCE(rc.boundaries_version, 1) as boundaries_version
                FROM raw_clips rc
                WHERE rc.id IN ({placeholders})
            """, request.clip_ids)
            rows = cursor.fetchall()
            # Re-order rows to match the order of clip_ids
            clips_by_id = {row['id']: row for row in rows}
            clips = [clips_by_id[cid] for cid in request.clip_ids if cid in clips_by_id]
        else:
            # Use filter-based query (already joins with games)
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
        # T1500: copy width/height/fps from the parent game_video so the frontend
        # never has to probe — without this, every newly-created project re-creates
        # the dims-NULL gap that backfill keeps closing.
        from app.routers.clips import _insert_working_clip_with_dims
        for sort_order, clip in enumerate(clips):
            _insert_working_clip_with_dims(
                cursor,
                project_id=project_id,
                raw_clip_id=clip['id'],
                sort_order=sort_order,
                version=1,
                raw_clip_version=clip['boundaries_version'],
            )

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
                   p.is_auto_created, p.archived_at,
                   wv.filename as working_video_filename,
                   wv.created_at as working_video_created_at,
                   (SELECT MAX(fv.created_at) FROM final_videos fv WHERE fv.project_id = p.id) as final_video_created_at
            FROM projects p
            LEFT JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Get working clips with resolved filenames
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
                rc.rating as raw_rating
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
            raw_filename = clip['raw_filename'] or ''
            filename = raw_filename or clip['uploaded_filename'] or 'unknown'
            tags = decode_data(clip['raw_tags']) or []

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
                sort_order=clip['sort_order']
            ))

        # Hand the frontend the same-origin proxy URL (see get_working_video_url
        # for rationale — this is not a presigned R2 URL).
        working_video_url = None
        if project['working_video_filename']:
            working_video_url = get_working_video_url(project_id, project['working_video_filename'])

        return ProjectDetailResponse(
            id=project['id'],
            name=project['name'],
            aspect_ratio=project['aspect_ratio'],
            working_video_id=project['working_video_id'],
            working_video_url=working_video_url,
            working_video_created_at=project['working_video_created_at'],
            final_video_id=project['final_video_id'],
            has_final_video=project['final_video_created_at'] is not None,
            final_video_created_at=project['final_video_created_at'],
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

        # Clear auto_project_id from any raw_clips pointing to this project
        # (raw_clips.auto_project_id has ON DELETE SET NULL, but we clear explicitly
        # because the FK is on projects, and we want this visible in the code)
        cursor.execute("""
            UPDATE raw_clips SET auto_project_id = NULL WHERE auto_project_id = ?
        """, (project_id,))

        # Remove any final videos this project produced. A draft (archived_at NULL)
        # can carry an UNPUBLISHED final video — published exports live on archived
        # projects, never in Drafts, and the gallery only lists published_at rows.
        # final_videos.project_id lacks ON DELETE CASCADE (unlike working_clips /
        # working_videos / export_jobs), so with foreign_keys=ON the project delete
        # below would raise "FOREIGN KEY constraint failed" and surface to the user
        # as a failed delete. Clear the child rows explicitly, same as raw_clips above.
        cursor.execute("""
            DELETE FROM final_videos WHERE project_id = ?
        """, (project_id,))

        # Delete project — cascades to working_clips, working_videos, export_jobs
        # projects.working_video_id and final_video_id use ON DELETE SET NULL
        # so deleting working_videos/final_videos first would auto-null them,
        # but since we're deleting the project itself, order doesn't matter.
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()

        logger.info(f"Deleted project: {project_id}")
        return {"success": True, "deleted_id": project_id}


@router.put("/{project_id}")
async def update_project(project_id: int, project: ProjectRename):
    """Rename a project. Only the name is updated -- aspect_ratio is owned solely by
    POST /clips/projects/{id}/aspect-ratio (which re-fits crops). See T4230 / ProjectRename."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        cursor.execute("""
            UPDATE projects SET name = ? WHERE id = ?
        """, (project.name, project_id))

        # Clear auto_project_id link so the project is no longer treated as auto-created.
        # The fetch query computes is_auto_created dynamically via this link.
        cursor.execute("""
            UPDATE raw_clips SET auto_project_id = NULL WHERE auto_project_id = ?
        """, (project_id,))

        conn.commit()

        return {"success": True, "id": project_id}


@router.patch("/{project_id}/state")
async def update_project_state(
    project_id: int,
    current_mode: str | None = None,
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

        # If R2 enabled, redirect to presigned URL. (This /working-video endpoint
        # is the legacy direct-download path; the streaming proxy below is what
        # the player uses for in-browser playback.)
        if R2_ENABLED:
            presigned_url = _generate_working_video_presigned_url(row['filename'])
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


# Pooled R2 client for the working-video streaming proxy — reused across
# requests so the TLS / connection handshake to R2 is paid ONCE (kept warm),
# not on every range fetch. A fresh httpx.AsyncClient per request was paying a
# full R2 connection + TLS handshake each time (HAR showed ssl=500–1200ms per
# working_video/stream request). Mirrors downloads.py:_get_r2_stream_client
# (T4630 pooled-httpx precedent). Deliberately scoped to THIS endpoint only —
# unifying all four streaming proxies onto one shared client is its own task.
_working_video_r2_client = None


def _get_working_video_r2_client():
    import httpx
    global _working_video_r2_client
    if _working_video_r2_client is None or _working_video_r2_client.is_closed:
        _working_video_r2_client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=24, keepalive_expiry=30.0),
        )
    return _working_video_r2_client


@router.api_route("/{project_id}/working_video/stream", methods=["GET", "HEAD"])
async def stream_working_video(project_id: int, request: Request):
    """
    Same-origin streaming proxy for a project's working video.

    Why a proxy instead of a presigned R2 URL: R2's S3-compat endpoint serves
    HTTP/1.1 only, capping Chrome at 6 sockets per origin. Foreground video
    fetches were sitting indefinitely in "Stalled" state when the warmer or
    a previous load held those sockets. Proxying through localhost moves the
    browser request off the R2 origin entirely (the backend's httpx pool
    talks to R2 separately).

    Pass-through behavior: forwards the client's Range header to R2 in a SINGLE
    round-trip on a POOLED client and returns R2's status / Content-Range /
    Content-Length unchanged (200 for full file, 206 for partial). No byte
    windowing — working_videos are self-contained MP4s, so R2's own 206 +
    Content-Range is already correct. (Compare stream_working_clip_bounded in
    clips.py, which clamps bytes because clips are slices of GB-scale games.)

    T4773: previously this paid two R2 round-trips per request (a 1-byte size
    probe to compute Content-Length ourselves, then the stream) each on a fresh
    AsyncClient. Since we don't window, R2's own range headers are authoritative,
    so we drop the probe and reuse a pooled connection — the fresh-TLS + extra
    round-trip were most of the proxy TTFB.
    """
    from fastapi.responses import Response, StreamingResponse

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT wv.filename
            FROM projects p
            LEFT JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ?
        """, (project_id,))
        row = cursor.fetchone()

    if not row or not row['filename']:
        raise HTTPException(status_code=404, detail="Working video not found")

    presigned_url = _generate_working_video_presigned_url(row['filename'])
    if not presigned_url:
        raise HTTPException(status_code=404, detail="Failed to generate R2 URL")

    client = _get_working_video_r2_client()
    range_hdr = request.headers.get("range") or request.headers.get("Range")
    base_headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}

    # HEAD (videoMetadata.js) — return size headers only, via a 1-byte GET probe
    # on the pooled client. We can't HEAD upstream directly: generate_presigned_url
    # signs for get_object and sig v4 binds the method, so HEAD on a GET-signed
    # URL returns 403 SignatureDoesNotMatch. The Content-Range ("bytes 0-0/TOTAL")
    # yields the full size.
    if request.method == "HEAD":
        probe = await client.get(presigned_url, headers={"Range": "bytes=0-0"})
        if probe.status_code not in (200, 206):
            raise HTTPException(
                status_code=probe.status_code,
                detail=f"R2 probe returned {probe.status_code}",
            )
        headers = dict(base_headers)
        cr = probe.headers.get("content-range")
        if cr and "/" in cr and cr.rsplit("/", 1)[1].isdigit():
            headers["Content-Length"] = cr.rsplit("/", 1)[1]
        elif probe.headers.get("content-length"):
            headers["Content-Length"] = probe.headers["content-length"]
        logger.info(
            f"[working-video-stream] project_id={project_id} method=HEAD "
            f"status=200 content_length={headers.get('Content-Length', '?')}"
        )
        return Response(status_code=200, headers=headers, media_type="video/mp4")

    # GET: forward the client's Range straight to R2 in ONE round-trip and pass
    # R2's status / Content-Range / Content-Length back unchanged. Opening the
    # stream via build_request + send(stream=True) (not `async with .stream()`)
    # lets us peek at headers before returning while keeping the body iterable;
    # we close the upstream response in the generator's finally.
    upstream_headers = {"Range": range_hdr} if range_hdr else {}
    r2 = await client.send(
        client.build_request("GET", presigned_url, headers=upstream_headers),
        stream=True,
    )
    if r2.status_code not in (200, 206):
        error_body = ""
        try:
            raw = await r2.aread()
            error_body = raw[:500].decode("utf-8", errors="replace")
        except Exception:
            error_body = "(unreadable)"
        await r2.aclose()
        logger.error(
            f"[working-video-stream] R2 error project_id={project_id} "
            f"r2_status={r2.status_code} "
            f"r2_content_type={r2.headers.get('content-type', 'unknown')} "
            f"filename={row['filename']} range={range_hdr or 'full'} "
            f"body_snippet={error_body!r}"
        )
        raise HTTPException(
            status_code=r2.status_code,
            detail=f"R2 returned {r2.status_code}",
        )

    headers = dict(base_headers)
    for h in ("Content-Range", "Content-Length"):
        v = r2.headers.get(h.lower())
        if v:
            headers[h] = v
    media_type = r2.headers.get("content-type", "video/mp4")

    logger.info(
        f"[working-video-stream] project_id={project_id} method=GET "
        f"range={range_hdr or 'none'} status={r2.status_code} "
        f"content_length={headers.get('Content-Length', '?')}"
    )

    async def stream_body():
        try:
            async for chunk in r2.aiter_bytes(chunk_size=1024 * 1024):
                yield chunk
        finally:
            await r2.aclose()

    return StreamingResponse(
        stream_body(),
        status_code=r2.status_code,
        media_type=media_type,
        headers=headers,
    )


@router.get("/{project_id}/working_video/playback-url")
async def get_working_video_playback_url(project_id: int):
    """
    Return a presigned R2 URL for a project's working video so the browser can
    load it directly (no per-request auth).

    Why: the same-origin proxy (`/working_video/stream` above) requires the
    session cookie on every byte-range fetch. On staging/prod the frontend is
    cross-origin to the API (pages.dev -> fly.dev), and the overlay `<video>`
    element carries NO `crossOrigin` attribute, so its cross-origin range
    requests arrive WITHOUT the cookie and the auth middleware 401s them —
    which Chrome surfaces on a media element as "Format error" (T5642).

    Mirrors the Framing clip path (`clips.py:get_clip_playback_url`): this
    authenticated endpoint hands back an anonymous presigned R2 URL (a
    DIFFERENT origin that needs no auth), and the frontend sets `<video src>`
    to it. The stream proxy stays for back-compat.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT wv.filename
            FROM projects p
            LEFT JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ?
        """, (project_id,))
        row = cursor.fetchone()

    if not row or not row['filename']:
        raise HTTPException(status_code=404, detail="Working video not found")

    presigned_url = _generate_working_video_presigned_url(row['filename'])
    if not presigned_url:
        raise HTTPException(status_code=404, detail="Failed to generate R2 URL")

    return {"url": presigned_url, "expires_in": 3600}


async def _serve_draft_poster_jpeg(rel_path: str):
    """Proxy a draft poster object with a FRESH presign per request.

    Mirrors `shares.py::_serve_poster_jpeg`, but the key is PROFILE-scoped (the
    draft's owner), resolved through `generate_presigned_url` (current-context
    profile prefix). 404 when the object/presign is absent; 502 on an R2 fetch
    failure. `private` cache (session-authed, user-specific) with a short TTL so
    a first-clip change surfaces on the tile without a hard reload.
    """
    import httpx
    from fastapi.responses import Response

    user_id = get_current_user_id()
    url = generate_presigned_url(user_id, rel_path, expires_in=3600, content_type="image/jpeg")
    if not url:
        raise HTTPException(status_code=404, detail="No poster for this draft")
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        resp = await client.get(url)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Poster fetch failed")
    return Response(
        content=resp.content,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/{project_id}/poster.jpg")
async def get_draft_poster(project_id: int):
    """Poster thumbnail for a reel DRAFT (T5671).

    Cache-first from R2 (`posters/drafts/{project_id}.jpg`, per-profile);
    generated on first request from the draft's first clip's source video
    (clearest frame in the clip's region). Session-authed by the same middleware
    as every other `/api/projects` route.

    404 when the project has no clips OR the source video is expired/missing --
    the frontend renders its no-poster fallback tile; we never fabricate an image
    (no-silent-fallback rule). Poster generation is best-effort and never fails
    a parent operation.
    """
    from app.services.poster import ensure_draft_poster

    user_id = get_current_user_id()
    rel_path = ensure_draft_poster(project_id, user_id)
    if not rel_path:
        raise HTTPException(status_code=404, detail="No poster for this draft")
    return await _serve_draft_poster_jpeg(rel_path)


class OutdatedClipInfo(BaseModel):
    working_clip_id: int
    raw_clip_id: int
    clip_name: str
    framed_version: int
    current_version: int
    boundaries_updated_at: str | None = None


class OutdatedClipsResponse(BaseModel):
    has_outdated_clips: bool
    outdated_clips: list[OutdatedClipInfo]


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
                rc.tags,
                rc.notes
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
                tags = decode_data(row['tags']) or []
                clip_name = derive_clip_name(
                    row['clip_name'],
                    row['rating'] or 3,
                    tags,
                    row['notes'] or ''
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
    working_clip_ids: list[int]


class RefreshClipsResponse(BaseModel):
    success: bool
    refreshed_count: int


@router.post("/{project_id}/refresh-outdated-clips", response_model=RefreshClipsResponse)
async def refresh_outdated_clips(project_id: int, request: RefreshClipsRequest, background_tasks: BackgroundTasks):
    """
    Refresh outdated working clips to use latest annotation boundaries.

    Rescales crop keyframes and segment boundaries to fit the new clip duration.
    This preserves the user's crop animation within the new time range.

    Rescaling: if old duration was 30s and new is 20s, a keyframe at frame 450 (15s @ 30fps)
    maps to frame 300 (10s) — all frames multiplied by (newDuration / oldDuration).
    """

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        refreshed_count = 0

        for working_clip_id in request.working_clip_ids:
            cursor.execute("""
                SELECT wc.id, wc.raw_clip_id, wc.crop_data, wc.segments_data,
                       rc.boundaries_version, rc.start_time, rc.end_time
                FROM working_clips wc
                JOIN raw_clips rc ON wc.raw_clip_id = rc.id
                WHERE wc.id = ? AND wc.project_id = ?
            """, (working_clip_id, project_id))

            row = cursor.fetchone()
            if not row:
                logger.warning(f"Working clip {working_clip_id} not found in project {project_id}")
                continue

            current_boundaries_version = row['boundaries_version'] or 1
            new_duration = (row['end_time'] or 0) - (row['start_time'] or 0)

            # Rescale crop keyframes and segment boundaries. If decode or the
            # rescale math fails for this clip, log at ERROR and SKIP the clip
            # entirely -- keep the existing crop_data/segments_data and do NOT bump
            # raw_clip_version. Writing NULL here (the old behavior) permanently
            # destroyed the user's framing on any transient error. Never reset user
            # data on failure; fail visibly and leave it intact for recovery.
            # The except is narrowed to the data-shaped errors decode + rescale can
            # raise; genuine code bugs propagate to the endpoint error handler.
            try:
                # Default to existing data so the "no rescale needed" branches write
                # it back unchanged.
                new_crop_data = row['crop_data']
                if row['crop_data']:
                    crop_keyframes = decode_data(row['crop_data'])
                    if crop_keyframes and len(crop_keyframes) >= 2:
                        # Old duration derived from last permanent keyframe's frame number
                        # Keyframes are frame-based; last keyframe is at the old end frame
                        old_end_frame = crop_keyframes[-1].get('frame', 0)
                        framerate = 30  # T-audit C7: hardcoded framerate, tracked separately
                        new_end_frame = round(new_duration * framerate)

                        if old_end_frame > 0 and new_end_frame > 0:
                            scale = new_end_frame / old_end_frame
                            rescaled = []
                            for kf in crop_keyframes:
                                new_kf = {**kf, 'frame': round(kf['frame'] * scale)}
                                rescaled.append(new_kf)
                            # Ensure first frame is 0 and last frame is new_end_frame
                            rescaled[0]['frame'] = 0
                            rescaled[-1]['frame'] = new_end_frame
                            new_crop_data = encode_data(rescaled)
                            logger.info(f"Rescaled {len(rescaled)} keyframes for clip {working_clip_id}: "
                                       f"old_end={old_end_frame} new_end={new_end_frame} scale={scale:.3f}")
                        # else: keep as-is (new_crop_data already = row['crop_data'])

                new_segments_data = row['segments_data']
                if row['segments_data']:
                    seg_data = decode_data(row['segments_data'])
                    # Get old duration from segment boundaries (last boundary = old duration)
                    boundaries = seg_data.get('boundaries', [])
                    old_duration = boundaries[-1] if boundaries else 0

                    if old_duration > 0 and new_duration > 0:
                        scale = new_duration / old_duration
                        # Rescale boundaries
                        new_boundaries = [round(b * scale, 3) for b in boundaries]
                        new_boundaries[0] = 0
                        new_boundaries[-1] = round(new_duration, 3)
                        seg_data['boundaries'] = new_boundaries

                        # Rescale trim range if present
                        if seg_data.get('trimRange'):
                            tr = seg_data['trimRange']
                            seg_data['trimRange'] = {
                                'start': round(tr.get('start', 0) * scale, 3),
                                'end': round(tr.get('end', old_duration) * scale, 3),
                            }

                        # Rescale user splits
                        if seg_data.get('userSplits'):
                            seg_data['userSplits'] = [round(s * scale, 3) for s in seg_data['userSplits']]

                        new_segments_data = encode_data(seg_data)
                    # else: keep as-is (new_segments_data already = row['segments_data'])
            except (ValueError, TypeError, KeyError, IndexError) as e:
                logger.error(
                    f"[Refresh] Failed to rescale working clip {working_clip_id} "
                    f"(raw_clip_id={row['raw_clip_id']}): {e}. Skipping this clip -- "
                    f"keeping existing crop_data/segments_data intact, not bumping version.",
                    exc_info=True,
                )
                continue

            # Update working clip with rescaled data and new version
            cursor.execute("""
                UPDATE working_clips
                SET crop_data = ?,
                    segments_data = ?,
                    raw_clip_version = ?,
                    exported_at = NULL
                WHERE id = ?
            """, (new_crop_data, new_segments_data, current_boundaries_version, working_clip_id))

            refreshed_count += 1
            logger.info(f"Refreshed working clip {working_clip_id} to boundaries version {current_boundaries_version}")

        conn.commit()

        # Clear project working/final video since boundaries changed
        if refreshed_count > 0:
            cursor.execute("""
                UPDATE projects
                SET working_video_id = NULL, final_video_id = NULL
                WHERE id = ?
            """, (project_id,))
            conn.commit()
            logger.info(f"Cleared working/final video for project {project_id} after refreshing clips")

    # T740: No re-extraction needed — framing reads game video directly

    return RefreshClipsResponse(
        success=True,
        refreshed_count=refreshed_count
    )
