"""
Downloads API endpoints.

Provides access to final videos that have been exported from Overlay mode.
Users can list, download, and delete their final videos.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse, RedirectResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os
import re
import json
import logging

from app.database import get_db_connection, get_final_videos_path
from app.queries import latest_final_videos_subquery
from app.user_context import get_current_user_id
from app.storage import R2_ENABLED, generate_presigned_url, file_exists_in_r2
from app.services.project_archive import restore_project, is_project_archived
from app.constants import SourceType

logger = logging.getLogger(__name__)


def get_download_file_url(filename: str, verify_exists: bool = False) -> Optional[str]:
    """
    Get presigned URL for download/final video if R2 is enabled.

    Args:
        filename: The filename of the download
        verify_exists: If True, verify the file exists in R2 before generating URL
                      (adds latency but catches missing files early)

    Returns None (fallback to local proxy) if:
    - R2 is not enabled
    - No filename provided
    - verify_exists=True and file doesn't exist in R2
    """
    if not R2_ENABLED or not filename:
        return None

    user_id = get_current_user_id()
    r2_path = f"final_videos/{filename}"

    # Optionally verify file exists in R2 (helps debug NoSuchKey errors)
    if verify_exists and not file_exists_in_r2(user_id, r2_path):
        logger.warning(f"[get_download_file_url] File NOT FOUND in R2: user={user_id}, path={r2_path}")
        return None  # Return None to trigger error in endpoint

    # Files are stored in final_videos/ directory in R2 (not downloads/)
    url = generate_presigned_url(
        user_id=user_id,
        relative_path=r2_path,
        expires_in=3600,
        content_type="video/mp4"
    )
    logger.debug(f"[get_download_file_url] Generated URL for: user={user_id}, path={r2_path}")
    return url


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
    Generate a group key based on games.

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
        return " / ".join(game_names[:2]) + ("..." if len(game_names) > 2 else "")

    years_list = sorted(years)

    if len(years_list) == 1:
        year = years_list[0]
        seasons = seasons_by_year.get(year, set())
        if len(seasons) == 1:
            return f"{list(seasons)[0]} {year}"
        return str(year)
    else:
        return f"{min(years_list)}-{max(years_list)}"


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
    file_url: Optional[str] = None  # Presigned R2 URL or None (use local proxy)
    created_at: str
    file_size: Optional[int]  # Size in bytes
    duration: Optional[float] = None  # Duration in seconds (T56)
    source_type: Optional[str]  # 'brilliant_clip' | 'custom_project' | 'annotated_game' | None
    game_id: Optional[int]  # For annotated_game exports, the source game ID
    rating_counts: Optional[RatingCounts] = None  # Rating breakdown for annotated games
    # Game grouping info
    game_ids: List[int] = []  # List of game IDs (single for annotated, multiple possible for projects)
    game_names: List[str] = []  # Display names for those games
    game_dates: List[str] = []  # Game dates (for season/year grouping)
    group_key: Optional[str] = None  # Group key for hierarchical display


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

        # Collect unique game_ids and project_ids for batch lookups
        game_ids_to_fetch = set()
        project_ids_to_fetch = set()
        for row in rows:
            if row['game_id']:
                game_ids_to_fetch.add(row['game_id'])
            if row['project_id'] and row['project_id'] != 0:
                project_ids_to_fetch.add(row['project_id'])

        # Fetch raw_clip data for brilliant_clip exports
        # For brilliant_clips, raw_clip.name IS the source of truth (project.name is a copy)
        # Also need game_id for grouping since brilliant_clips don't have working_clips
        brilliant_clip_data = {}
        brilliant_project_ids = [
            row['project_id'] for row in rows
            if row['source_type'] == SourceType.BRILLIANT_CLIP.value
            and row['project_id'] and row['project_id'] != 0
        ]
        if brilliant_project_ids:
            placeholders = ','.join(['?' for _ in brilliant_project_ids])
            cursor.execute(f"""
                SELECT auto_project_id, name, game_id
                FROM raw_clips
                WHERE auto_project_id IN ({placeholders})
            """, brilliant_project_ids)
            for rc_row in cursor.fetchall():
                brilliant_clip_data[rc_row['auto_project_id']] = {
                    'name': rc_row['name'],
                    'game_id': rc_row['game_id']
                }
                if rc_row['game_id']:
                    game_ids_to_fetch.add(rc_row['game_id'])

        # Fetch game info for annotated exports AND brilliant_clip game associations
        # Include all detail columns for proper display name generation
        games_info = {}
        if game_ids_to_fetch:
            placeholders = ','.join(['?' for _ in game_ids_to_fetch])
            cursor.execute(f"""
                SELECT id, name, game_date, opponent_name, game_type, tournament_name
                FROM games
                WHERE id IN ({placeholders})
            """, list(game_ids_to_fetch))
            for game_row in cursor.fetchall():
                # Generate display name from game details (not stored name which may be filename)
                display_name = _generate_game_display_name(
                    game_row['opponent_name'],
                    game_row['game_date'],
                    game_row['game_type'],
                    game_row['tournament_name'],
                    game_row['name'] or f"Game {game_row['id']}"
                )
                games_info[game_row['id']] = {
                    'name': display_name,
                    'date': game_row['game_date'] or ''
                }

        # Fetch game info for project exports (via working_clips -> raw_clips -> games)
        # Include all detail columns for proper display name generation
        project_games = {}
        if project_ids_to_fetch:
            placeholders = ','.join(['?' for _ in project_ids_to_fetch])
            cursor.execute(f"""
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
                WHERE wc.project_id IN ({placeholders}) AND rc.game_id IS NOT NULL
                ORDER BY wc.project_id, g.game_date
            """, list(project_ids_to_fetch))
            for game_row in cursor.fetchall():
                project_id = game_row['project_id']
                if project_id not in project_games:
                    project_games[project_id] = {
                        'game_ids': [],
                        'game_names': [],
                        'game_dates': []
                    }
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

        # T56: Batch fetch durations from working_videos (latest version per project)
        project_durations = {}
        if project_ids_to_fetch:
            placeholders = ','.join(['?' for _ in project_ids_to_fetch])
            cursor.execute(f"""
                SELECT project_id, duration FROM (
                    SELECT project_id, duration, ROW_NUMBER() OVER (
                        PARTITION BY project_id ORDER BY version DESC
                    ) as rn
                    FROM working_videos
                    WHERE project_id IN ({placeholders}) AND duration IS NOT NULL
                ) WHERE rn = 1
            """, list(project_ids_to_fetch))
            for dur_row in cursor.fetchall():
                project_durations[dur_row['project_id']] = dur_row['duration']

            # Fallback: for brilliant clips without working_videos, get from raw_clips.auto_project_id
            missing_ids = [pid for pid in project_ids_to_fetch if pid not in project_durations]
            if missing_ids:
                placeholders = ','.join(['?' for _ in missing_ids])
                cursor.execute(f"""
                    SELECT auto_project_id, (end_time - start_time) as duration
                    FROM raw_clips
                    WHERE auto_project_id IN ({placeholders})
                """, missing_ids)
                for dur_row in cursor.fetchall():
                    if dur_row['auto_project_id'] not in project_durations:
                        project_durations[dur_row['auto_project_id']] = dur_row['duration']

        # T56: Batch fetch durations for annotated game exports (sum of rated clip durations)
        game_durations = {}
        if game_ids_to_fetch:
            placeholders = ','.join(['?' for _ in game_ids_to_fetch])
            cursor.execute(f"""
                SELECT game_id, SUM(end_time - start_time) as total_duration
                FROM raw_clips
                WHERE game_id IN ({placeholders}) AND rating >= 3
                GROUP BY game_id
            """, list(game_ids_to_fetch))
            for dur_row in cursor.fetchall():
                game_durations[dur_row['game_id']] = dur_row['total_duration']

        downloads = []
        for row in rows:
            # Get file size if file exists
            file_path = get_final_videos_path() / row['filename']
            file_size = None
            if file_path.exists():
                file_size = file_path.stat().st_size

            # Parse stored rating counts for annotated games (frozen at export time)
            rating_counts = None
            if row['source_type'] == SourceType.ANNOTATED_GAME.value and row['rating_counts']:
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

            # Determine game info based on source type
            game_ids = []
            game_names = []
            game_dates = []

            if row['source_type'] == SourceType.ANNOTATED_GAME.value and row['game_id']:
                # Annotated export: single game from game_id
                game_info = games_info.get(row['game_id'])
                if game_info:
                    game_ids = [row['game_id']]
                    game_names = [game_info['name']]
                    game_dates = [game_info['date']]
            elif row['source_type'] == SourceType.BRILLIANT_CLIP.value:
                # For brilliant_clips, get game info from raw_clip (no working_clips exist)
                bc_data = brilliant_clip_data.get(row['project_id'])
                if bc_data and bc_data['game_id']:
                    game_info = games_info.get(bc_data['game_id'])
                    if game_info:
                        game_ids = [bc_data['game_id']]
                        game_names = [game_info['name']]
                        game_dates = [game_info['date']]
            elif row['project_id'] and row['project_id'] != 0:
                # Custom project export: games from project's working_clips
                pg = project_games.get(row['project_id'], {})
                game_ids = pg.get('game_ids', [])
                game_names = pg.get('game_names', [])
                game_dates = pg.get('game_dates', [])

            # Generate group key from game info, or fallback to date-based grouping
            group_key = _generate_group_key(game_names, game_dates)
            if not group_key:
                # Fallback: group by month/year from created_at (e.g., "January 2026")
                try:
                    created_dt = datetime.fromisoformat(row['created_at'].replace('Z', '+00:00'))
                    group_key = created_dt.strftime("%B %Y")  # e.g., "January 2026"
                except (ValueError, AttributeError):
                    group_key = "Other"

            # Determine display name
            display_name = None

            if row['source_type'] == SourceType.ANNOTATED_GAME.value and game_names:
                # Annotated games: use generated game name
                display_name = game_names[0]
            elif row['source_type'] == SourceType.BRILLIANT_CLIP.value:
                # For brilliant_clips, raw_clip.name IS the source of truth
                bc_data = brilliant_clip_data.get(row['project_id'])
                if bc_data and bc_data['name']:
                    display_name = bc_data['name']
                elif row['project_name']:
                    # Fallback to project name if raw_clip not found
                    display_name = row['project_name']
            elif row['project_name']:
                # Custom projects: use project name
                display_name = row['project_name']

            # Final fallbacks if no name found
            if not display_name:
                if game_names:
                    display_name = game_names[0]
                else:
                    try:
                        source_type_enum = SourceType(row['source_type'])
                        display_name = source_type_enum.display_label
                    except (ValueError, TypeError):
                        display_name = f"Video {row['id']}"

            # T56: Calculate duration on the fly (not stored - derivable data)
            if row['source_type'] == SourceType.ANNOTATED_GAME.value and row['game_id']:
                # Annotated game: sum of rated clip durations
                duration = game_durations.get(row['game_id'])
            else:
                # Project: duration from working_video
                duration = project_durations.get(row['project_id'])

            # Append 'Z' to indicate UTC so JavaScript parses correctly
            # SQLite stores as 'YYYY-MM-DD HH:MM:SS' but JS needs timezone info
            created_at_utc = row['created_at']
            if created_at_utc and not created_at_utc.endswith('Z'):
                # Convert space to 'T' for ISO format and append 'Z' for UTC
                created_at_utc = created_at_utc.replace(' ', 'T') + 'Z'

            downloads.append(DownloadItem(
                id=row['id'],
                project_id=row['project_id'],
                project_name=display_name,
                filename=row['filename'],
                file_url=get_download_file_url(row['filename']),
                created_at=created_at_utc,
                file_size=file_size,
                duration=duration,
                source_type=row['source_type'],
                game_id=row['game_id'],
                rating_counts=rating_counts,
                game_ids=game_ids,
                game_names=game_names,
                game_dates=game_dates,
                group_key=group_key
            ))

        # Log single warning for missing projects (data integrity issue from past R2 sync bug)
        missing_project_ids = [
            row['project_id'] for row in rows
            if row['source_type'] == SourceType.BRILLIANT_CLIP.value
            and row['project_id'] and row['project_id'] != 0
            and not row['project_name']
        ]
        if missing_project_ids:
            logger.warning(
                f"[Downloads] {len(missing_project_ids)} brilliant_clip exports have missing projects "
                f"(project_ids: {missing_project_ids[:5]}{'...' if len(missing_project_ids) > 5 else ''}). "
                f"This is a historical data integrity issue."
            )

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
    Download/stream a final video file. Redirects to R2 when enabled.
    Returns the video file for download with project name as filename.
    """
    from fastapi.responses import RedirectResponse

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

        # If R2 enabled, stream through backend to avoid CORS issues with fetch API
        if R2_ENABLED:
            import httpx

            # verify_exists=True to check file exists and log warning if not
            presigned_url = get_download_file_url(row['filename'], verify_exists=True)
            if not presigned_url:
                logger.error(f"[Download] R2 enabled but failed to generate presigned URL for: {row['filename']} - file may not exist in R2")
                raise HTTPException(status_code=404, detail="Video file not found in storage")

            logger.info(f"[Download] Streaming from R2 through backend proxy")

            # Generate download filename from project name
            download_filename = generate_download_filename(row['project_name'])

            async def stream_from_r2():
                async with httpx.AsyncClient() as client:
                    async with client.stream("GET", presigned_url) as response:
                        if response.status_code != 200:
                            raise HTTPException(
                                status_code=response.status_code,
                                detail=f"R2 returned {response.status_code}"
                            )
                        async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):  # 1MB chunks
                            yield chunk

            return StreamingResponse(
                stream_from_r2(),
                media_type="video/mp4",
                headers={
                    "Content-Disposition": f'attachment; filename="{download_filename}"',
                    "Cache-Control": "no-cache"
                }
            )

        # Local mode only: serve from filesystem
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

        # Clear the project's final_video_id reference before deleting (FK constraint)
        cursor.execute("""
            UPDATE projects SET final_video_id = NULL
            WHERE final_video_id = ?
        """, (download_id,))

        # Delete the record from database
        cursor.execute("""
            DELETE FROM final_videos WHERE id = ?
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


@router.post("/{download_id}/restore-project")
async def restore_project_from_archive(download_id: int):
    """
    Restore a project from archive (T66).

    When a project is exported, it gets archived to R2 and removed from the DB.
    This endpoint restores the project back to the DB so the user can edit it.

    Args:
        download_id: The final_video ID (used as download_id in gallery)

    Returns:
        project_id for navigation to the project
    """
    user_id = get_current_user_id()

    # Get the project_id from the final_video
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT project_id FROM final_videos WHERE id = ?
        """, (download_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Download not found")

        project_id = row['project_id']

        # Check if project already exists in DB (not archived)
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if cursor.fetchone():
            # Project is already in DB, just return its ID
            logger.info(f"Project {project_id} already in DB, no restore needed")
            return {"project_id": project_id, "restored": False}

    # Check if archive exists
    if not is_project_archived(project_id, user_id):
        raise HTTPException(
            status_code=404,
            detail=f"Project archive not found. Project {project_id} may not have been archived."
        )

    # Restore from archive
    if not restore_project(project_id, user_id):
        raise HTTPException(
            status_code=500,
            detail="Failed to restore project from archive"
        )

    logger.info(f"Restored project {project_id} from archive for user {user_id}")
    return {"project_id": project_id, "restored": True}
