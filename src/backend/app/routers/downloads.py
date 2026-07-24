"""
Downloads API endpoints.

Provides access to final videos that have been exported from Overlay mode.
Users can list, download, and delete their final videos.
"""

import asyncio
import logging
import os
import re
import tempfile
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.constants import SourceType
from app.database import get_db_connection, get_final_videos_path, sync_db_to_r2_explicit
from app.middleware.db_sync import DURABLE_SYNC_FAILED_RESPONSE, durable_sync
from app.profile_context import get_current_profile_id
from app.queries import exclude_teammate_reels_clause, latest_final_videos_subquery
from app.services.collection_metadata import ORDER_BY_RANK, route_collection
from app.services.materialization import _open_profile_db, ensure_profile_db_local
from app.services.poster import generate_poster_at_publish, poster_basename, poster_rel_path
from app.services.project_archive import archive_project, is_project_archived, restore_project
from app.storage import (
    R2_ENABLED,
    copy_profile_object,
    delete_profile_object,
    file_exists_in_r2,
    generate_presigned_url,
    profile_object_exists,
)
from app.user_context import get_current_req_id, get_current_user_id
from app.utils.encoding import decode_data

logger = logging.getLogger(__name__)


def get_download_file_url(filename: str, verify_exists: bool = False) -> str | None:
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
            return f"{next(iter(seasons))} {year}"
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
    weighted_average: float | None = None  # Weighted average rating


class DownloadItem(BaseModel):
    id: int
    project_id: int | None = None
    project_name: str
    filename: str
    file_url: str | None = None  # Presigned R2 URL or None (use local proxy)
    created_at: str
    file_size: int | None  # Size in bytes
    duration: float | None = None  # Frozen at export-finalize (T3600); NULL until v007 backfill
    aspect_ratio: str | None = None  # Frozen at export-finalize (T3600), e.g. '9:16'
    tags: list[str] = []  # Distinct clip tags frozen at export-finalize (T3600)
    source_type: str | None  # 'brilliant_clip' | 'custom_project' | 'annotated_game' | None
    game_id: int | None  # For annotated_game exports, the source game ID
    rating_counts: RatingCounts | None = None  # Rating breakdown for annotated games
    rating: float | None = None  # Glicko rating (T3630); primary ordering key, NULL until seeded
    quality_score: float | None = None  # Frozen single-clip star (T3630); seed + secondary ordering
    clip_count: int | None = None  # Distinct constituent clips (T3630); 1 = collection-eligible
    clip_game_start_time: float | None = None  # Unified two-half in-match start (sec) for single-clip reels; soccer-notation card mark (T3920). NULL for multi-clip reels.
    # Game grouping info
    watched_at: str | None = None  # ISO timestamp when first played in gallery
    game_ids: list[int] = []  # List of game IDs (single for annotated, multiple possible for projects)
    game_names: list[str] = []  # Display names for those games
    game_dates: list[str] = []  # Game dates (for season/year grouping)
    group_key: str | None = None  # Group key for hierarchical display


class DownloadListResponse(BaseModel):
    downloads: list[DownloadItem]
    total_count: int


@router.get("", response_model=DownloadListResponse)
async def list_downloads(
    source_type: str | None = None,
    game_id: int | None = None,
    aspect_ratio: str | None = None,
    mixes: bool = False,
    tags: str | None = None,
):
    """
    List all final videos with metadata.
    Returns videos grouped with project information.

    Args:
        source_type: Filter by source type ('brilliant_clip', 'custom_project', 'annotated_game').
        game_id: Restrict to reels whose frozen game_ids route to this single game
                 (Collections member fetch). Mutually exclusive with `mixes`.
        aspect_ratio: Restrict to a single ratio ('9:16' / '16:9'); index-backed.
        mixes: Restrict to reels that route to the Mixes bucket (multi-game or
               game-less). Mutually exclusive with `game_id`.
        tags: Comma-separated tag names; returns reels carrying ANY of them
              (OR, deduped) — the smart-collection member fetch (T3670).
        If no filter is provided, returns all published videos.
    """
    if game_id is not None and mixes:
        raise HTTPException(
            status_code=400,
            detail="game_id and mixes are mutually exclusive",
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # rating_counts is a JSON snapshot frozen at export time (not live).
        # game_ids is the frozen msgpack BLOB used for game_id/mixes routing.
        conditions = []
        params: list = []
        if source_type:
            conditions.append("fv.source_type = ?")
            params.append(source_type)
        if aspect_ratio:
            # Index-backed (idx_final_videos_published_ratio).
            conditions.append("fv.aspect_ratio = ?")
            params.append(aspect_ratio)
        extra = (" AND " + " AND ".join(conditions)) if conditions else ""

        base_query = f"""
            SELECT
                fv.id,
                fv.project_id,
                fv.filename,
                fv.created_at,
                fv.version,
                fv.source_type,
                fv.game_id,
                fv.game_ids,
                fv.rating_counts,
                fv.watched_at,
                fv.duration as fv_duration,
                fv.aspect_ratio,
                fv.tags,
                fv.name as fv_name,
                fv.rating,
                fv.quality_score,
                fv.clip_count,
                fv.clip_game_start_time
            FROM final_videos fv
            WHERE fv.id IN ({latest_final_videos_subquery()})
            AND fv.published_at IS NOT NULL{extra}
            {exclude_teammate_reels_clause()}
            ORDER BY {ORDER_BY_RANK}
        """
        cursor.execute(base_query, params)
        rows = cursor.fetchall()

        # game_id / mixes filter via the shared router helper (T3630: collections
        # are SINGLE-CLIP reels only -- route_collection sends multi-clip reels to
        # Mixes). SAME routing as GET /api/collections/summary, so member counts
        # always equal summary counts (small published set, <= ~500 rows).
        if game_id is not None:
            rows = [r for r in rows if route_collection(r["game_ids"], r["clip_count"]) == game_id]
        elif mixes:
            rows = [r for r in rows if route_collection(r["game_ids"], r["clip_count"]) is None]

        # tags filter (OR semantics) on the frozen tags BLOB — smart-collection
        # member fetch. Smart collections are single-clip only (clip_count == 1).
        if tags:
            wanted = {t.strip() for t in tags.split(",") if t.strip()}
            if wanted:
                rows = [r for r in rows
                        if r["clip_count"] == 1
                        and (wanted & set(decode_data(r["tags"]) or []))]

        # Collect unique game_ids and project_ids for batch lookups. For
        # brilliant_clip reels also pull the reel's FROZEN game_ids (v008, T3605)
        # -- T4190 makes those the PRIMARY grouping source since they survive the
        # source clip's draft being re-created (auto_project_id repoints away,
        # breaking the raw_clips chain below).
        game_ids_to_fetch = set()
        project_ids_to_fetch = set()
        for row in rows:
            if row['game_id']:
                game_ids_to_fetch.add(row['game_id'])
            if row['project_id']:
                project_ids_to_fetch.add(row['project_id'])
            if row['source_type'] == SourceType.BRILLIANT_CLIP.value:
                for gid in decode_data(row['game_ids']) or []:
                    game_ids_to_fetch.add(gid)

        # The auto_project chain (raw_clips.auto_project_id -> game_id) is kept
        # only as a fallback for pre-v008 brilliant reels whose frozen blob is empty.
        brilliant_project_ids = [
            row['project_id'] for row in rows
            if row['source_type'] == SourceType.BRILLIANT_CLIP.value
            and row['project_id']
        ]
        brilliant_clip_games = {}  # auto_project_id -> game_id (fallback only)
        if brilliant_project_ids:
            placeholders = ','.join(['?' for _ in brilliant_project_ids])
            cursor.execute(f"""
                SELECT auto_project_id, game_id
                FROM raw_clips
                WHERE auto_project_id IN ({placeholders})
            """, brilliant_project_ids)
            for rc_row in cursor.fetchall():
                if rc_row['game_id']:
                    game_ids_to_fetch.add(rc_row['game_id'])
                    brilliant_clip_games[rc_row['auto_project_id']] = rc_row['game_id']

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
                    c = decode_data(row['rating_counts'])
                    if c:
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
                except (KeyError, TypeError):
                    pass

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
                # T4190: prefer the reel's FROZEN game_ids (survives the clip's
                # draft being re-created); fall back to the auto_project chain
                # only for pre-v008 reels whose frozen blob is empty (T3920 needs
                # the game name for the player header).
                frozen_ids = decode_data(row['game_ids']) or []
                bgame_ids = frozen_ids or (
                    [brilliant_clip_games[row['project_id']]]
                    if row['project_id'] in brilliant_clip_games else []
                )
                for bgame_id in bgame_ids:
                    game_info = games_info.get(bgame_id)
                    if game_info:
                        game_ids.append(bgame_id)
                        game_names.append(game_info['name'])
                        game_dates.append(game_info['date'])
            elif row['project_id']:
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

            # fv.name is the single source of truth for display name
            display_name = row['fv_name']
            if not display_name:
                logger.warning(
                    f"[Downloads] final_video id={row['id']} has NULL name — re-export to fix."
                )
                display_name = f"Video {row['id']}"

            # T3600: duration/aspect_ratio/tags are frozen at export-finalize.
            # NULL means the row predates v007 and could not be backfilled —
            # render it anyway, downstream excludes NULLs from math.
            duration = row['fv_duration']
            tag_list = decode_data(row['tags']) or []

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
                aspect_ratio=row['aspect_ratio'],
                tags=tag_list,
                source_type=row['source_type'],
                game_id=row['game_id'],
                rating_counts=rating_counts,
                rating=row['rating'],
                quality_score=row['quality_score'],
                clip_count=row['clip_count'],
                clip_game_start_time=row['clip_game_start_time'],
                watched_at=row['watched_at'],
                game_ids=game_ids,
                game_names=game_names,
                game_dates=game_dates,
                group_key=group_key
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
    Download a final video file with the branded outro burned in at serve time.

    T3950: the outro is appended on-the-fly via ffmpeg concat so stored files
    carry no outro and existing reels automatically get attribution. The card is
    cached per resolution/fps in the system temp dir so repeat downloads are fast.
    Non-fatal: any card/concat failure logs loudly and serves the original file --
    a download must never break because of branding.
    """
    import shutil as _shutil

    logger.info(f"[Download] Request for download_id={download_id}")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT fv.filename, fv.name as project_name
            FROM final_videos fv
            WHERE fv.id = ?
        """, (download_id,))
        row = cursor.fetchone()

        if not row:
            logger.warning(f"[Download] Not found: download_id={download_id}")
            raise HTTPException(status_code=404, detail="Download not found")

        logger.info(f"[Download] Found: stored_filename={row['filename']}, project_name={row['project_name']}")

        from app.analytics import record_milestone
        record_milestone(get_current_user_id(), "video_downloaded", {"video_id": download_id})

        download_filename = generate_download_filename(row['project_name'])
        dl_headers = {
            "Content-Disposition": f'attachment; filename="{download_filename}"',
            "Cache-Control": "no-cache",
        }

        # ---- R2 path: download to temp, append outro, stream result ----
        if R2_ENABLED:
            import httpx

            presigned_url = get_download_file_url(row['filename'], verify_exists=True)
            if not presigned_url:
                logger.error(
                    f"[Download] R2 presigned URL failed for: {row['filename']}"
                )
                raise HTTPException(status_code=404, detail="Video file not found in storage")

            logger.info("[Download] Streaming from R2 with branded outro")

            async def _stream_with_outro_r2():
                tmp_dir = tempfile.mkdtemp(prefix="rb_dl_outro_")
                try:
                    original_path = os.path.join(tmp_dir, "original.mp4")
                    out_path = os.path.join(tmp_dir, "with_outro.mp4")

                    async with httpx.AsyncClient(
                        timeout=httpx.Timeout(120.0, connect=10.0)
                    ) as client, client.stream("GET", presigned_url) as response:
                        if response.status_code != 200:
                            raise HTTPException(
                                status_code=response.status_code,
                                detail=f"R2 returned {response.status_code}",
                            )
                        with open(original_path, "wb") as fout:
                            async for chunk in response.aiter_bytes(1024 * 1024):
                                fout.write(chunk)

                    serve_path = original_path
                    try:
                        from app.services.branded_outro import append_branded_outro
                        if await asyncio.to_thread(append_branded_outro, original_path, out_path):
                            serve_path = out_path
                    except Exception as exc:
                        logger.error(
                            f"[Download] Outro append failed for download_id={download_id}: {exc}"
                        )

                    with open(serve_path, "rb") as fin:
                        while True:
                            chunk = fin.read(1024 * 1024)
                            if not chunk:
                                break
                            yield chunk
                finally:
                    _shutil.rmtree(tmp_dir, ignore_errors=True)

            return StreamingResponse(
                _stream_with_outro_r2(),
                media_type="video/mp4",
                headers=dl_headers,
            )

        # ---- Local path: append outro to temp file, stream result ----
        file_path = get_final_videos_path() / row['filename']
        if not file_path.exists():
            logger.error(f"[Download] File missing: {file_path}")
            raise HTTPException(status_code=404, detail="Video file not found")

        logger.info(f"[Download] Serving local file as: {download_filename}")

        async def _stream_with_outro_local():
            tmp_dir = tempfile.mkdtemp(prefix="rb_dl_outro_")
            try:
                out_path = os.path.join(tmp_dir, "with_outro.mp4")
                serve_path = str(file_path)
                try:
                    from app.services.branded_outro import append_branded_outro
                    if await asyncio.to_thread(append_branded_outro, str(file_path), out_path):
                        serve_path = out_path
                except Exception as exc:
                    logger.error(
                        f"[Download] Outro append failed for download_id={download_id}: {exc}"
                    )

                with open(serve_path, "rb") as fin:
                    while True:
                        chunk = fin.read(1024 * 1024)
                        if not chunk:
                            break
                        yield chunk
            finally:
                _shutil.rmtree(tmp_dir, ignore_errors=True)

        return StreamingResponse(
            _stream_with_outro_local(),
            media_type="video/mp4",
            headers=dl_headers,
        )


# Shared R2 client for streaming proxies -- reused across requests so the TLS /
# connection handshake is paid ONCE instead of per request (a fresh client per
# request was a big chunk of the stream TTFB).
_r2_stream_client = None


def _get_r2_stream_client():
    import httpx
    global _r2_stream_client
    if _r2_stream_client is None or _r2_stream_client.is_closed:
        _r2_stream_client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=24, keepalive_expiry=30.0),
        )
    return _r2_stream_client


@router.api_route("/{download_id}/stream", methods=["GET", "HEAD"])
async def stream_download(download_id: int, request: Request):
    """Same-origin streaming proxy for gallery video playback.

    Proxies R2 through localhost (avoids Chrome's 6-socket-per-origin HTTP/1.1
    limit). GET forwards the client's Range straight to R2 in a SINGLE round-trip
    on a pooled connection and passes R2's status / Content-Range / Content-Length
    back unchanged -- no separate size probe. The old probe + per-request client
    cost two extra R2 round-trips (with fresh TLS each) on every request, which
    was most of the ~7s TTFB.
    """
    from fastapi.responses import Response, StreamingResponse

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT filename FROM final_videos WHERE id = ?", (download_id,))
        row = cursor.fetchone()
    if not row or not row['filename']:
        raise HTTPException(status_code=404, detail="Download not found")

    presigned_url = get_download_file_url(row['filename'])
    if not presigned_url:
        raise HTTPException(status_code=404, detail="Failed to generate R2 URL")

    client = _get_r2_stream_client()
    range_hdr = request.headers.get("range") or request.headers.get("Range")
    # A final-video filename is immutable, so let the browser cache it: repeat
    # plays and the blur/sharp layers serve from cache instead of re-hitting R2.
    base_headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}

    if request.method == "HEAD":
        probe = await client.get(presigned_url, headers={"Range": "bytes=0-0"})
        if probe.status_code not in (200, 206):
            raise HTTPException(status_code=probe.status_code, detail=f"R2 probe returned {probe.status_code}")
        headers = dict(base_headers)
        cr = probe.headers.get("content-range")
        if cr and "/" in cr:
            tail = cr.rsplit("/", 1)[1]
            if tail.isdigit():
                headers["Content-Length"] = tail
        return Response(status_code=200, headers=headers, media_type="video/mp4")

    upstream_headers = {"Range": range_hdr} if range_hdr else {}
    r2 = await client.send(
        client.build_request("GET", presigned_url, headers=upstream_headers),
        stream=True,
    )
    if r2.status_code not in (200, 206):
        await r2.aclose()
        raise HTTPException(status_code=r2.status_code, detail=f"R2 returned {r2.status_code}")

    headers = dict(base_headers)
    for h in ("Content-Range", "Content-Length"):
        v = r2.headers.get(h.lower())
        if v:
            headers[h] = v
    media_type = r2.headers.get("content-type", "video/mp4")

    async def stream_body():
        try:
            async for chunk in r2.aiter_bytes(chunk_size=1024 * 1024):
                yield chunk
        finally:
            await r2.aclose()

    return StreamingResponse(
        stream_body(), status_code=r2.status_code, media_type=media_type, headers=headers,
    )


@router.delete("/{download_id}")
async def delete_download(
    download_id: int,
    remove_file: bool = False,
    _durable: None = Depends(durable_sync),
):
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


@router.patch("/{download_id}/watched")
async def mark_watched(download_id: int):
    """Mark a download as watched (first play in gallery)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE final_videos SET watched_at = CURRENT_TIMESTAMP WHERE id = ? AND watched_at IS NULL",
            (download_id,),
        )
        conn.commit()
        return {"success": True}


@router.patch("/{download_id}/name")
async def rename_download(download_id: int, body: dict):
    """Rename a reel in My Reels."""
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE final_videos SET name = ? WHERE id = ? AND published_at IS NOT NULL",
            (name, download_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Download not found")
        conn.commit()
        return {"success": True, "name": name}


async def _serve_reel_poster_jpeg(rel_path: str):
    """Proxy a published reel's poster object with a FRESH presign per request.

    Per-profile (the owner's current profile prefix), resolved through
    `generate_presigned_url`. Mirrors `projects._serve_draft_poster_jpeg`. The
    caller verifies object existence first, so a missing poster is a clean 404
    upstream rather than a 502 from a signed GET of a nonexistent key. `private`
    cache (session-authed, user-specific) with a short TTL.
    """
    import httpx
    from fastapi.responses import Response

    url = generate_presigned_url(
        get_current_user_id(), rel_path, expires_in=3600, content_type="image/jpeg"
    )
    if not url:
        raise HTTPException(status_code=404, detail="No poster for this reel")
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        resp = await client.get(url)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Poster fetch failed")
    return Response(
        content=resp.content,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/{download_id}/poster.jpg")
async def get_reel_poster(download_id: int):
    """Poster thumbnail for a PUBLISHED reel (T5673).

    Serves the T5280/T4890 publish poster -- captured at publish time and frozen
    on the `final_videos` row -- at `final_videos/posters/{filename}.jpg`, in the
    owner's current profile prefix. Session-authed by the same middleware as every
    other `/api/downloads` route. The key is derived from the reel's stored
    filename (`poster_basename`), the same scheme the share-unfurl path uses.

    404 when the reel row is missing OR has no poster object (pre-T5280 reels;
    poster generation was best-effort and never fabricated) -> the drawer renders
    its branded fallback tile. We never fabricate an image (no-silent-fallback
    rule, CLAUDE.md).
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT filename FROM final_videos WHERE id = ?", (download_id,))
        row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Reel not found")

    rel_path = poster_rel_path(poster_basename(row["filename"]))

    # Existence check under the current profile prefix: a poster-less reel must be
    # a clean 404 (branded fallback), NOT a 502 from signing a nonexistent object.
    if not profile_object_exists(get_current_user_id(), get_current_profile_id(), rel_path):
        raise HTTPException(status_code=404, detail="No poster for this reel")

    return await _serve_reel_poster_jpeg(rel_path)


class MoveToProfileRequest(BaseModel):
    video_ids: list[int]
    target_profile_id: str


# Columns copied verbatim from the source reel into the target profile. These are
# the FROZEN, self-contained metadata that make a published reel play + display
# without any editing lineage (T3600/T3605 freeze). Lineage-scoped columns
# (project_id, game_id, game_ids, source_clip_id) and per-profile ranking columns
# (rating, rd, match_count, watched_at) are handled explicitly in the move, NOT
# copied — see _build_moved_reel_row.
_MOVED_REEL_CARRY_COLUMNS = (
    "filename", "version", "duration", "source_type", "name", "rating_counts",
    "created_at", "aspect_ratio", "tags", "clip_count", "quality_score",
    "clip_start_time", "clip_game_start_time",
    # T4890: the first-frame poster is per-profile media too; carry the frozen ref
    # and copy the object (below) so the moved reel's share link still unfurls.
    "poster_filename",
)


def _build_moved_reel_row(src_row) -> dict:
    """Map a source-profile final_videos row to the target-profile INSERT values.

    Decision 1 (published-reel-only MOVE): only the frozen metadata that lets the
    reel play + rank + display moves; editing lineage stays in the source profile.
    Decision 4 (enter target as new): reset every per-profile reference so the reel
    joins the target profile's pool clean, with no dangling cross-profile ids.

    - project_id / game_id / game_ids: NULL/None. They reference SOURCE-profile
      projects+games that do not exist in the target; keeping them would dangle
      (violates the no-orphan-refs criterion) and would fabricate a phantom
      "Game N" collection in the target (collections.py resolves a routed-but-
      missing game to a 'Game N' fallback). Cleared -> the reel routes to Mixes /
      date-fallback grouping, honestly unattributed in its new profile.
    - source_clip_id: NULL. It points at a SOURCE raw_clip; a collision with a
      target raw_clip id could wrongly twin-sync ratings or exclude the reel as a
      teammate reel. Cleared -> the moved reel is an individual ranking contestant.
    - rating/rd/match_count: re-seeded exactly as a fresh export would (single-clip
      reels re-seed from their frozen quality_score; multi-clip / unrated reels
      stay NULL and never rank). match_count -> 0 discards source ranking history.
    - watched_at: NULL so the reel shows as NEW in the target's My Reels.
    """
    from app.services.glicko import RD_MAX, seed_rating

    row = {col: src_row[col] for col in _MOVED_REEL_CARRY_COLUMNS}
    row["project_id"] = None
    row["game_id"] = None
    row["game_ids"] = None
    row["source_clip_id"] = None
    row["watched_at"] = None
    row["published_at"] = src_row["published_at"]
    # Re-seed ranking: only reels that were rankable in the source (rating set)
    # re-enter the target pool; preserve the never-rank state of multi-clip reels.
    if src_row["rating"] is not None:
        row["rating"] = seed_rating(src_row["quality_score"])
        row["rd"] = RD_MAX
    else:
        row["rating"] = None
        row["rd"] = None
    row["match_count"] = 0
    return row


@router.post("/move-to-profile")
async def move_reels_to_profile(
    body: MoveToProfileRequest,
    _durable: None = Depends(durable_sync),
):
    """Move one or more PUBLISHED reels from the current profile to a sibling
    profile of the SAME user (T4850, multi-athlete accounts).

    Batch-atomic and all-or-nothing: every id is validated first; a single
    offender (unknown id, unpublished/draft, wrong profile) rejects the whole
    batch with 400 and nothing moves.

    R2 media objects are PER-PROFILE (r2_key embeds profile_id), so the reel's
    final_videos/{filename} MUST be server-side copied from the source-profile
    prefix to the target-profile prefix — the sqlite row alone would 404 on
    playback/download in the target. Ordering (all-or-nothing, target-first for
    durability):
      Phase 0: copy media object(s) source->target prefix (fail -> 502, nothing moved)
      Phase 1: insert target rows + durable-sync target DB
               (sync fail -> roll back target rows + copied objects, 503, source intact)
      Phase 2: delete source rows (source rides `durable_sync` -> 503 on its sync fail)
      Phase 3: delete SOURCE-prefix objects LAST (fail -> logged orphan, never gated)
    A machine death mid-op can leave the reel briefly in BOTH profiles (a visible
    duplicate the user can re-move) but NEVER in neither (data loss).
    """
    user_id = get_current_user_id()
    source_profile_id = get_current_profile_id()
    req_id = get_current_req_id()
    target_profile_id = body.target_profile_id

    # --- Validate the target profile belongs to this user and is a sibling ---
    from app.services.user_db import get_profiles
    profile_ids = {p["id"] for p in get_profiles(user_id)}
    if target_profile_id not in profile_ids:
        raise HTTPException(status_code=404, detail="Target profile not found")
    if target_profile_id == source_profile_id:
        raise HTTPException(
            status_code=400, detail="Target profile must differ from the current profile"
        )

    video_ids = list(dict.fromkeys(body.video_ids))  # de-dupe, preserve order
    if not video_ids:
        raise HTTPException(status_code=400, detail="No reels selected")

    logger.info(
        f"[MoveReels] start ids={video_ids} {source_profile_id}->{target_profile_id} "
        f"user={user_id} req_id={req_id}"
    )

    carry_cols = ", ".join(_MOVED_REEL_CARRY_COLUMNS)

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # --- Fetch + validate ALL requested reels up front (all-or-nothing) ---
        placeholders = ",".join("?" for _ in video_ids)
        cursor.execute(
            f"""
            SELECT {carry_cols}, id, project_id, game_id, game_ids,
                   source_clip_id, published_at, rating
            FROM final_videos
            WHERE id IN ({placeholders})
            """,
            video_ids,
        )
        rows_by_id = {r["id"]: r for r in cursor.fetchall()}

        missing = [vid for vid in video_ids if vid not in rows_by_id]
        unpublished = [
            vid for vid in video_ids
            if vid in rows_by_id and rows_by_id[vid]["published_at"] is None
        ]
        if missing or unpublished:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Some reels cannot be moved.",
                    "not_found": missing,
                    "not_published": unpublished,
                },
            )

        source_rows = [rows_by_id[vid] for vid in video_ids]

        # R2 media objects are PER-PROFILE (r2_key embeds profile_id), so the reel's
        # final_videos/{filename} lives under the SOURCE prefix. The move MUST copy
        # each object to the TARGET prefix or the target-profile presign 404s. The
        # `filename` is a per-user hash so two reels never collide on it.
        # T4890: the poster object (final_videos/posters/{poster_filename}) rides the
        # SAME all-or-nothing copy/rollback/delete list when the reel has one, so the
        # moved reel's share link unfurls under the target profile prefix. The poster
        # is a best-effort cosmetic asset everywhere else in T4890, so a set-but-missing
        # poster object must NOT abort a legitimate reel move: HEAD-probe it first and
        # only relocate (and carry the ref) when the object actually exists. Missing ->
        # move the reel WITHOUT the poster (ref nulled below) so nothing dangles.
        media_paths = []
        posters_moved: set[int] = set()  # final_video ids whose poster object relocates
        for r in source_rows:
            media_paths.append(f"final_videos/{r['filename']}")
            pf = r["poster_filename"]
            if not pf:
                continue
            rel = poster_rel_path(pf)
            if await asyncio.to_thread(
                profile_object_exists, user_id, source_profile_id, rel
            ):
                media_paths.append(rel)
                posters_moved.add(r["id"])
            else:
                logger.warning(
                    f"[MoveReels] poster object missing for fv={r['id']} ({rel}); "
                    f"moving reel WITHOUT poster req_id={req_id}"
                )

        # --- Phase 0: server-side COPY the media to the TARGET prefix FIRST ---
        # Nothing is deleted until the target reel is fully durable (row + object),
        # so a failure here leaves the source 100% intact.
        copied_paths: list[str] = []
        for rel_path in media_paths:
            ok = await asyncio.to_thread(
                copy_profile_object, user_id, source_profile_id, target_profile_id, rel_path
            )
            if not ok:
                # Roll back the objects we already copied into the target prefix so a
                # failed move leaves no orphan there, then fail visibly (nothing moved).
                for done in copied_paths:
                    await asyncio.to_thread(
                        delete_profile_object, user_id, target_profile_id, done
                    )
                logger.error(
                    f"[MoveReels] R2 copy FAILED for {rel_path} "
                    f"{source_profile_id}->{target_profile_id} req_id={req_id} -> 502"
                )
                raise HTTPException(
                    status_code=502,
                    detail={
                        "message": "Could not copy reel media to the target profile. Nothing was moved.",
                        "code": "media_copy_failed",
                        "retryable": True,
                    },
                )
            copied_paths.append(rel_path)

        # --- Phase 1: write + durably sync the TARGET profile DB -------------
        ensure_profile_db_local(user_id, target_profile_id)
        target_conn = _open_profile_db(user_id, target_profile_id)
        if target_conn is None:
            # Target has no local/R2 DB yet -> materialize an empty schema for it.
            _ensure_empty_profile_db(target_profile_id)
            target_conn = _open_profile_db(user_id, target_profile_id)
        if target_conn is None:
            _cleanup_target_objects(user_id, target_profile_id, copied_paths)
            raise HTTPException(status_code=500, detail="Could not open target profile database")

        insert_cols = (*_MOVED_REEL_CARRY_COLUMNS,
            "project_id", "game_id", "game_ids", "source_clip_id",
            "watched_at", "published_at", "rating", "rd", "match_count",
        )
        insert_sql = (
            f"INSERT INTO final_videos ({', '.join(insert_cols)}) "
            f"VALUES ({', '.join('?' for _ in insert_cols)})"
        )
        inserted_target_ids: list[int] = []
        try:
            tcur = target_conn.cursor()
            for src_row in source_rows:
                new_row = _build_moved_reel_row(src_row)
                # T4890: don't carry a poster ref whose object we did NOT relocate
                # (missing source object) -- keeps the moved row from dangling.
                if src_row["poster_filename"] and src_row["id"] not in posters_moved:
                    new_row["poster_filename"] = None
                tcur.execute(insert_sql, [new_row[c] for c in insert_cols])
                inserted_target_ids.append(tcur.lastrowid)
            target_conn.commit()

            target_synced = await asyncio.to_thread(
                sync_db_to_r2_explicit, user_id, target_profile_id
            )
            if not target_synced:
                # Roll back the exact rows we just inserted AND the copied objects so a
                # failed move leaves NOTHING behind in the target, then surface the
                # retryable 503. The source is still 100% untouched at this point.
                ph = ",".join("?" for _ in inserted_target_ids)
                tcur.execute(
                    f"DELETE FROM final_videos WHERE id IN ({ph})", inserted_target_ids
                )
                target_conn.commit()
                _cleanup_target_objects(user_id, target_profile_id, copied_paths)
                logger.warning(
                    f"[MoveReels] target R2 sync FAILED, rolled back target ids="
                    f"{inserted_target_ids} + {len(copied_paths)} object(s) req_id={req_id} -> 503"
                )
                raise HTTPException(status_code=503, detail=DURABLE_SYNC_FAILED_RESPONSE)
        except HTTPException:
            raise
        except Exception:
            target_conn.rollback()
            _cleanup_target_objects(user_id, target_profile_id, copied_paths)
            logger.exception(
                f"[MoveReels] target insert failed ids={video_ids} req_id={req_id}"
            )
            raise HTTPException(status_code=500, detail="Failed to write target profile")
        finally:
            target_conn.close()

        # --- Phase 2: target is fully durable -> remove reels from the SOURCE --
        # before_after_tracks cascade via ON DELETE CASCADE (foreign_keys=ON);
        # NULL the project pointer first, mirroring delete_download's FK cleanup.
        for vid in video_ids:
            cursor.execute(
                "UPDATE projects SET final_video_id = NULL WHERE final_video_id = ?", (vid,)
            )
            cursor.execute("DELETE FROM final_videos WHERE id = ?", (vid,))
        conn.commit()

    # --- Phase 3: delete the SOURCE-prefix media objects LAST ---------------
    # The target reel is now fully durable (object + row + synced DB); the source
    # DB row is gone. Only now do we drop the source-prefix objects. A failure here
    # is a harmless orphan (logged loudly), NEVER data loss — do not gate the 200.
    for rel_path in media_paths:
        deleted = await asyncio.to_thread(
            delete_profile_object, user_id, source_profile_id, rel_path
        )
        if not deleted:
            logger.error(
                f"[MoveReels] ORPHAN: failed to delete source object {rel_path} under "
                f"profile={source_profile_id} user={user_id} req_id={req_id} — "
                f"target copy is durable, safe to sweep later"
            )

    logger.info(
        f"[MoveReels] moved {len(video_ids)} reel(s) {source_profile_id}->"
        f"{target_profile_id} user={user_id} req_id={req_id} "
        f"(source R2 sync pending via durable_sync)"
    )
    # durable_sync dependency makes the middleware AWAIT the source-profile R2 sync
    # inside the write lock and convert failure into a 503 (never a lying 200).
    return {"success": True, "moved_ids": video_ids, "target_profile_id": target_profile_id}


def _cleanup_target_objects(user_id: str, target_profile_id: str, rel_paths: list[str]) -> None:
    """Best-effort delete of objects already copied into the target prefix when a
    move aborts after Phase 0 — keeps a failed move from orphaning target media."""
    for rel_path in rel_paths:
        try:
            delete_profile_object(user_id, target_profile_id, rel_path)
        except Exception:
            logger.exception(
                f"[MoveReels] failed to clean up target object {rel_path} "
                f"profile={target_profile_id}"
            )


def _ensure_empty_profile_db(profile_id: str) -> None:
    """Create an empty, schema-current profile.sqlite for a target profile that has
    never been opened (no local file, nothing in R2). Reuses ensure_database via a
    temporary profile-context swap (same pattern as materialization helpers)."""
    from app.database import ensure_database
    from app.profile_context import reset_profile_id_token, set_current_profile_id
    token = set_current_profile_id(profile_id)
    try:
        ensure_database()
    finally:
        reset_profile_id_token(token)


@router.post("/publish/{project_id}")
async def publish_to_my_reels(
    project_id: int,
    _durable: None = Depends(durable_sync),
):
    """Publish a project's latest final video to My Reels.

    Sets published_at on the latest final_video for the given project,
    making it visible in the downloads/gallery list. Also archives the
    project's working data to R2 to keep the database small.
    """
    user_id = get_current_user_id()
    req_id = get_current_req_id()
    # T4050 publish tracing: this gesture commits published_at + archived_at to the
    # LOCAL profile.sqlite, but the R2 upload of that file is fired fire-and-forget by
    # the middleware AFTER this response returns (see _background_sync in db_sync.py).
    # If the machine is replaced or the upload lock times out before that background
    # task completes, the local commit never reaches R2 and a later session_init pulls
    # the pre-publish snapshot back down -> published_at/archived_at revert to NULL.
    # These [Publish] markers let a real attempt be traced end-to-end against the
    # middleware's "[SYNC] POST /api/downloads/publish/... -> R2 sync OK/FAILED" line
    # (chain by req_id).
    logger.info(f"[Publish] start project={project_id} user={user_id} req_id={req_id}")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, filename, slowmo_section_start, slowmo_section_end
            FROM final_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        row = cursor.fetchone()

        if not row:
            logger.warning(
                f"[Publish] no final_video for project={project_id} user={user_id} "
                f"req_id={req_id} - returning 404, nothing persisted"
            )
            raise HTTPException(status_code=404, detail="No final video found for this project")

        # T5260: the name is frozen once at render time (overlay.py INSERT), but the
        # draft stays renameable in Reel Drafts right up until this gesture. Publish
        # is the correct freeze point (post-publish rename goes through the gallery
        # endpoint at /{download_id}/name instead) -- re-read the CURRENT project name
        # here so a rename-after-render isn't silently lost in My Reels.
        cursor.execute("SELECT name FROM projects WHERE id = ?", (project_id,))
        project_row = cursor.fetchone()
        current_name = project_row['name'] if project_row else None

        if current_name:
            cursor.execute(
                "UPDATE final_videos SET published_at = CURRENT_TIMESTAMP, watched_at = NULL, "
                "name = ? WHERE id = ?",
                (current_name, row['id']),
            )
        else:
            # No silent NULL over an existing name (CLAUDE.md: no silent fallbacks for
            # internal data) -- keep the render-time frozen name and surface why.
            cursor.execute(
                "UPDATE final_videos SET published_at = CURRENT_TIMESTAMP, watched_at = NULL WHERE id = ?",
                (row['id'],),
            )
            logger.info(
                f"[Publish] project name missing or empty for project={project_id} "
                f"final_video_id={row['id']} user={user_id} req_id={req_id} - keeping "
                f"existing frozen final_video name, not overwriting with NULL"
            )
        conn.commit()
        logger.info(
            f"[Publish] published_at committed LOCALLY project={project_id} "
            f"final_video_id={row['id']} user={user_id} req_id={req_id} "
            f"(R2 sync still pending - runs in middleware background task)"
        )

    # T5280: capture the share poster HERE (the publish gesture), not at render.
    # Runs BEFORE archive_project prunes working_clips, so a reel whose slow-mo
    # section columns are unfrozen (pre-v025) can still reconstruct from live clips.
    # Blocking ffmpeg+R2 runs off the event loop but WITHIN the request, so the
    # poster object + poster_filename land before this endpoint's durable-sync
    # barrier (T4110) -- NOT fire-and-forget. Poster failure NEVER fails publish
    # (generate_poster_at_publish is best-effort and never raises).
    poster_fn = await asyncio.to_thread(
        generate_poster_at_publish,
        user_id, row['id'], row['filename'], project_id,
        row['slowmo_section_start'], row['slowmo_section_end'],
    )
    logger.info(
        f"[Publish] poster capture project={project_id} final_video_id={row['id']} "
        f"user={user_id} req_id={req_id} poster={poster_fn or 'none'}"
    )

    archived = await asyncio.to_thread(archive_project, project_id, user_id)
    if archived:
        from app.routers.auth import mark_user_archived
        mark_user_archived(user_id)
        logger.info(
            f"[Publish] archived LOCALLY project={project_id} user={user_id} "
            f"req_id={req_id} - archive/{project_id}.msgpack uploaded to R2, working "
            f"data deleted locally; profile.sqlite R2 sync still pending (background)"
        )
    else:
        logger.warning(
            f"[Publish] archive FAILED project={project_id} "
            f"(user={user_id}, final_video_id={row['id']}, req_id={req_id}) - working "
            f"data retained, card stays in Drafts with In My Reels badge; see preceding "
            f"archive/R2 errors for root cause"
        )

    logger.info(
        f"[Publish] returning 200 project={project_id} final_video_id={row['id']} "
        f"archived={archived} user={user_id} req_id={req_id} - watch for the "
        f"matching [SYNC] ... R2 sync OK/FAILED line to confirm durability"
    )
    return {"success": True, "final_video_id": row['id'], "archived": archived}


@router.get("/count")
async def get_download_count():
    """
    Get count of available downloads (latest version per project only).
    Useful for showing badge count in header.
    Must match the same filtering logic as the list endpoint.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute(f"""
            SELECT
                COUNT(*) as count,
                SUM(CASE WHEN watched_at IS NULL THEN 1 ELSE 0 END) as unwatched_count
            FROM final_videos
            WHERE id IN ({latest_final_videos_subquery()})
            AND published_at IS NOT NULL
            {exclude_teammate_reels_clause("final_videos")}
        """)
        row = cursor.fetchone()

        return {
            "count": row['count'] if row else 0,
            "unwatched_count": row['unwatched_count'] if row else 0,
        }


@router.post("/{download_id}/restore-project")
async def restore_project_from_archive(
    download_id: int,
    _durable: None = Depends(durable_sync),
):
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
            SELECT project_id, name FROM final_videos WHERE id = ?
        """, (download_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Download not found")

        project_id = row['project_id']
        fv_name = row['name']

        # Unpublish: moving back to draft removes from My Reels
        cursor.execute(
            "UPDATE final_videos SET published_at = NULL WHERE project_id = ?",
            (project_id,),
        )
        conn.commit()

        # Check if project is in DB and not archived (has working data)
        cursor.execute("SELECT id, name, archived_at FROM projects WHERE id = ?", (project_id,))
        project_row = cursor.fetchone()
        needs_archive_restore = not project_row or project_row['archived_at']

        logger.info(
            f"[Restore] download_id={download_id} project_id={project_id} "
            f"fv_name={fv_name!r} project_name={project_row['name'] if project_row else None!r} "
            f"needs_archive_restore={needs_archive_restore}"
        )

    if needs_archive_restore:
        if not is_project_archived(project_id, user_id):
            raise HTTPException(
                status_code=404,
                detail=f"Project archive not found. Project {project_id} may not have been archived."
            )

        if not restore_project(project_id, user_id):
            raise HTTPException(
                status_code=500,
                detail="Failed to restore project from archive"
            )

    # Propagate reel name to project (user may have renamed in gallery)
    if fv_name:
        with get_db_connection() as conn:
            conn.cursor().execute(
                "UPDATE projects SET name = ? WHERE id = ?",
                (fv_name, project_id),
            )
            conn.commit()
            logger.info(f"[Restore] Updated project {project_id} name to {fv_name!r}")

    logger.info(f"[Restore] Complete: project_id={project_id} restored={needs_archive_restore}")
    return {"project_id": project_id, "restored": needs_archive_restore}
