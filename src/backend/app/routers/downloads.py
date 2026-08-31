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
from app.database import column_exists, get_db_connection, get_final_videos_path, sync_db_to_r2_explicit
from app.middleware.db_sync import (
    DURABLE_SYNC_FAILED_RESPONSE,
    durable_sync,
    set_durable_sync_failure_response,
)
from app.migrations import MigrationBlocked
from app.profile_context import get_current_profile_id
from app.queries import exclude_teammate_reels_clause, latest_final_videos_subquery
from app.services.collection_metadata import ORDER_BY_RANK, route_collection
from app.services.intro_cards import (
    load_profile_cards,
    resolve_intro_card,
    resolve_intro_card_id,
)
from app.services.materialization import (
    ProfileDBRefreshFailed,
    RecipientProfileBelowHead,
    _open_profile_db,
    ensure_game_reference,
    ensure_profile_db_local,
)
from app.services.poster import poster_basename, poster_rel_path
from app.services.project_archive import archive_project, is_project_archived, restore_project
from app.services.user_db import get_intro_consent
from app.storage import (
    R2_ENABLED,
    VideoServeOutcome,
    copy_profile_object,
    delete_profile_object,
    file_exists_in_r2,
    generate_presigned_url,
    log_video_resolution,
    profile_object_exists,
    r2_key,
    video_outcome_for_status,
)
from app.user_context import get_current_req_id, get_current_user_id
from app.utils.encoding import decode_data, encode_data

logger = logging.getLogger(__name__)


def _reel_video_r2_key(filename: str) -> str:
    """Fully-qualified (env-prefixed, per-user) R2 key for a final/reel video --
    the key that would be probed by hand during triage (T6330)."""
    return r2_key(get_current_user_id(), f"final_videos/{filename}")


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
    season_rank: int | None = None  # T5679: 1-indexed rank among ACTUALLY-RANKED reels (match_count > 0), top-20 only. NULL for unranked (seeded-only) or rank > 20 reels.
    leading_reel_id: int | None = None  # Representative reel id for collapsed rows (T5673 item 2)
    intro_card_id: int | None = None  # RAW stored attachment (T5215): 0 = opted out, NULL = inherit default, <id> = explicit. NOT the resolved id -- the picker needs the raw value to preselect the current choice.
    intro_card_name: str | None = None  # RESOLVED card name -- what will actually play (accounts for the duration gate); None if nothing will play
    resolved_intro_has_photo: bool = False  # T5220 Scope F: the RESOLVED card has a photo -- ShareModal's public-exposure notice gate
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

        # T5215: intro_card_id landed in v034; guarded (not assumed present) the
        # same way every other new-column hot read in this file is -- a profile
        # DB in the deploy->migrate window must not 500 the gallery.
        _has_intro = column_exists(cursor, "final_videos", "intro_card_id")
        intro_select = ", fv.intro_card_id" if _has_intro else ""

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
                fv.clip_game_start_time,
                fv.match_count{intro_select}
            FROM final_videos fv
            WHERE fv.id IN ({latest_final_videos_subquery()})
            AND fv.published_at IS NOT NULL{extra}
            {exclude_teammate_reels_clause()}
            ORDER BY {ORDER_BY_RANK}
        """
        cursor.execute(base_query, params)
        rows = cursor.fetchall()

        # T5215: batch-load the card map ONCE for the whole list (no N+1 per
        # tile) -- resolution happens in memory below, per row, via the SAME
        # resolve_intro_card_id every other consumer uses. T6680 dropped the
        # default/threshold batch-load: there is no profile default to inherit.
        intro_card_map = load_profile_cards(cursor) if _has_intro else {}

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

        # Compute season_rank (T5679): position among ACTUALLY-RANKED reels only
        # (match_count > 0 -- has been through >= 1 Glicko matchup). A reel whose
        # rating is merely SEEDED from quality_score (match_count == 0, rd == RD_MAX)
        # has never been ranked by the user and must get no badge, even though it
        # carries a rating and sorts high via ORDER_BY_RANK's quality-score fallback.
        # `rows` is already in ORDER_BY_RANK order, so a running counter over the
        # match_count > 0 subsequence gives the correct 1-indexed rank; unranked
        # rows are skipped without consuming a rank slot. Track leading_reel_id
        # per bucket alongside (T5673 item 2: leading poster).
        leading_reel_ids = {}  # bucket_key -> first_reel_id
        ranked_counter = 0

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

            # T5215: raw stored attachment (for the picker's preselection) +
            # in-memory resolution via the SAME single resolution order every
            # consumer uses (no per-tile query -- intro_card_map was
            # batch-loaded once above). T6680: NULL no longer inherits a
            # profile default, so resolution no longer needs the reel's
            # duration -- kept unused as `duration` above for the tile payload.
            raw_intro_card_id = row['intro_card_id'] if _has_intro else None
            resolved_intro_id = (
                resolve_intro_card_id(raw_intro_card_id) if _has_intro else None
            )
            intro_card_info = (
                intro_card_map.get(resolved_intro_id) if resolved_intro_id is not None else None
            )
            if resolved_intro_id is not None and intro_card_info is None:
                logger.warning(
                    "[intro] reel id=%s resolved to missing intro_card id=%s -- "
                    "showing no intro", row['id'], resolved_intro_id,
                )
            intro_card_name = intro_card_info['name'] if intro_card_info else None
            resolved_intro_has_photo = bool(intro_card_info and intro_card_info.get('has_photo'))

            # Append 'Z' to indicate UTC so JavaScript parses correctly
            # SQLite stores as 'YYYY-MM-DD HH:MM:SS' but JS needs timezone info
            created_at_utc = row['created_at']
            if created_at_utc and not created_at_utc.endswith('Z'):
                # Convert space to 'T' for ISO format and append 'Z' for UTC
                created_at_utc = created_at_utc.replace(' ', 'T') + 'Z'

            # season_rank: only for actually-ranked reels (match_count > 0);
            # top-20 of that ranked subsequence only (T5679).
            season_rank = None
            if (row['match_count'] or 0) > 0:
                ranked_counter += 1
                if ranked_counter <= 20:
                    season_rank = ranked_counter

            # Track leading_reel_id per group for collapsed rows (T5673)
            if group_key and group_key not in leading_reel_ids:
                leading_reel_ids[group_key] = row['id']

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
                season_rank=season_rank,
                leading_reel_id=leading_reel_ids.get(group_key),
                watched_at=row['watched_at'],
                game_ids=game_ids,
                game_names=game_names,
                game_dates=game_dates,
                group_key=group_key,
                intro_card_id=raw_intro_card_id,
                intro_card_name=intro_card_name,
                resolved_intro_has_photo=resolved_intro_has_photo,
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


def _stamp_download(
    serve_path: str, tmp_dir: str, meta: dict,
    user_id: str, profile_id: str,
) -> str:
    """T6360: download the reel's cover-art poster (when it has one) into
    `tmp_dir`, then run the metadata/cover-art stamping pass over `serve_path`
    (the composed `[intro?][reel][outro?]` file). Returns the path to stream:
    the stamped file on success, `serve_path` unchanged on any skip/failure.
    Blocking (ffmpeg + R2); callers wrap it in `asyncio.to_thread`. Never raises."""
    from app.services.download_metadata import apply_download_metadata, fetch_owner_cover

    poster_basename = meta.get("poster_basename") if meta else None
    if poster_basename:
        cover_local = os.path.join(tmp_dir, "cover.jpg")
        if fetch_owner_cover(user_id, profile_id, poster_basename, cover_local):
            meta["cover_path"] = cover_local
        else:
            # Pre-T5280 reels (and any transient miss) simply have no cover: the
            # tags still ship (no-silent-fallback -- never a fabricated image).
            logger.info(
                f"[Download] no cover art for poster={poster_basename}; stamping tags only"
            )
    return apply_download_metadata(serve_path, tmp_dir, meta)


@router.get("/{download_id}/file")
async def download_file(download_id: int):
    """
    Download a final video file with the player intro + branded outro composed
    at serve time.

    T3950 shipped the outro this way; T5220 (Scope A/E) folds the player intro
    into the SAME single ffmpeg concat pass via `compose_serve_time` --
    `[intro?][reel][outro?]`, not two sequential passes. Stored files carry
    neither card baked in; both are resolved LIVE from this profile's current
    attachment on every download, so changing the attached card changes the
    NEXT download with no re-export. Non-fatal at every rung (design §4.2): any
    card/concat failure logs loudly and still serves a playable file -- a
    download must never break because of branding.
    """
    import shutil as _shutil

    logger.info(f"[Download] Request for download_id={download_id}")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT fv.filename, fv.name as project_name, fv.intro_card_id, fv.duration
            FROM final_videos fv
            WHERE fv.id = ?
        """, (download_id,))
        row = cursor.fetchone()

        if not row:
            logger.warning(f"[Download] Not found: download_id={download_id}")
            raise HTTPException(status_code=404, detail="Download not found")

        logger.info(f"[Download] Found: stored_filename={row['filename']}, project_name={row['project_name']}")

        from app.analytics import record_milestone
        user_id = get_current_user_id()
        profile_id = get_current_profile_id()
        record_milestone(user_id, "video_downloaded", {"video_id": download_id})

        download_filename = generate_download_filename(row['project_name'])
        dl_headers = {
            "Content-Disposition": f'attachment; filename="{download_filename}"',
            "Cache-Control": "no-cache",
        }
        intro_card_id = row['intro_card_id']
        reel_duration = row['duration']

        def _resolve_download_intro():
            # Resolves its OWN read-only profile connection (never the ambient
            # `conn` above -- that closes when this `with` block exits, well
            # before a StreamingResponse's generator body actually runs).
            from app.services.intro_egress import resolve_intro_for_reel
            return resolve_intro_for_reel(
                user_id, profile_id, intro_card_id, reel_duration, download_id,
            )

        # T6360: assemble the metadata field map + poster ref NOW, over the still-
        # open `conn` (it closes before the streaming generator runs). The cover
        # is downloaded + stamped INSIDE the generator (after the outro/intro
        # compose), so a stamping failure ships the composed-but-unstamped file.
        from app.services.download_metadata import build_download_metadata
        dl_meta = build_download_metadata(conn, download_id, user_id, profile_id)

        # ---- R2 path: download to temp, append outro, stream result ----
        if R2_ENABLED:
            import httpx

            presigned_url = get_download_file_url(row['filename'], verify_exists=True)
            if not presigned_url:
                logger.error(
                    f"[Download] R2 presigned URL failed for: {row['filename']}"
                )
                # verify_exists=True already HEAD-probed the object -> a None here
                # with R2 on means the object is absent (head_found=false).
                log_video_resolution(
                    logger, kind="reel_video", outcome=VideoServeOutcome.MISSING,
                    key=_reel_video_r2_key(row['filename']), entity_id=download_id,
                    user_id=get_current_user_id(), profile_id=get_current_profile_id(),
                    head_found=(False if R2_ENABLED else None),
                    reason="presign_verify_failed",
                )
                raise HTTPException(status_code=404, detail="Video file not found in storage")

            logger.info("[Download] Streaming from R2 with composed intro/outro")

            async def _stream_composed_r2():
                tmp_dir = tempfile.mkdtemp(prefix="rb_dl_compose_")
                try:
                    original_path = os.path.join(tmp_dir, "original.mp4")
                    out_path = os.path.join(tmp_dir, "composed.mp4")

                    async with httpx.AsyncClient(
                        timeout=httpx.Timeout(120.0, connect=10.0)
                    ) as client, client.stream("GET", presigned_url) as response:
                        if response.status_code != 200:
                            log_video_resolution(
                                logger, kind="reel_video",
                                outcome=video_outcome_for_status(response.status_code),
                                key=_reel_video_r2_key(row['filename']),
                                entity_id=download_id, user_id=get_current_user_id(),
                                profile_id=get_current_profile_id(),
                                reason=f"r2_status_{response.status_code}",
                            )
                            raise HTTPException(
                                status_code=response.status_code,
                                detail=f"R2 returned {response.status_code}",
                            )
                        with open(original_path, "wb") as fout:
                            async for chunk in response.aiter_bytes(1024 * 1024):
                                fout.write(chunk)

                    serve_path = original_path
                    intro = await asyncio.to_thread(_resolve_download_intro)
                    try:
                        # T7090 Phase 3: dispatch the compose (Modal when enabled,
                        # local otherwise). `user_id` owns the reel/intro R2 scratch.
                        from app.services.serve_time_video import compose_serve_time_dispatched
                        if await asyncio.to_thread(
                            compose_serve_time_dispatched, original_path, out_path,
                            user_id=user_id, intro=intro, outro=True,
                        ):
                            serve_path = out_path
                    except Exception as exc:
                        logger.error(
                            f"[Download] Compose failed for download_id={download_id}: {exc}"
                        )
                    finally:
                        if intro is not None:
                            intro.cleanup()

                    serve_path = await asyncio.to_thread(
                        _stamp_download, serve_path, tmp_dir, dl_meta,
                        user_id, profile_id,
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
                _stream_composed_r2(),
                media_type="video/mp4",
                headers=dl_headers,
            )

        # ---- Local path: append outro to temp file, stream result ----
        file_path = get_final_videos_path() / row['filename']
        if not file_path.exists():
            logger.error(f"[Download] File missing: {file_path}")
            raise HTTPException(status_code=404, detail="Video file not found")

        logger.info(f"[Download] Serving local file as: {download_filename}")

        async def _stream_composed_local():
            tmp_dir = tempfile.mkdtemp(prefix="rb_dl_compose_")
            try:
                out_path = os.path.join(tmp_dir, "composed.mp4")
                serve_path = str(file_path)
                intro = await asyncio.to_thread(_resolve_download_intro)
                try:
                    # T7090 Phase 3: dispatch the compose (Modal when enabled, local
                    # otherwise). `user_id` owns the reel/intro R2 scratch.
                    from app.services.serve_time_video import compose_serve_time_dispatched
                    if await asyncio.to_thread(
                        compose_serve_time_dispatched, str(file_path), out_path,
                        user_id=user_id, intro=intro, outro=True,
                    ):
                        serve_path = out_path
                except Exception as exc:
                    logger.error(
                        f"[Download] Compose failed for download_id={download_id}: {exc}"
                    )
                finally:
                    if intro is not None:
                        intro.cleanup()

                serve_path = await asyncio.to_thread(
                    _stamp_download, serve_path, tmp_dir, dl_meta,
                    user_id, profile_id,
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
            _stream_composed_local(),
            media_type="video/mp4",
            headers=dl_headers,
        )


@router.get("/{download_id}/intro-playback")
async def get_download_intro_playback(download_id: int):
    """The single reel's OWN resolved intro, LIVE, for the owner in-app Play
    gesture (T6700 design §5.1 row 1). Same-account / same-request-user (the
    owner's own reel): resolves over the AMBIENT connection, never
    `open_profile_db_readonly` -- that cross-profile path is for the SHARE
    endpoints resolving a DIFFERENT user's profile (design §2.2).

    Non-fatal, ALWAYS 200: no card / opted-out (0) / NULL-with-no-default /
    a forced resolve failure all degrade to `{"intro": null}` --
    `resolve_intro_for_reel` already never raises (intro_egress.py). Only a
    genuinely missing download_id 404s, mirroring `download_file` above.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT intro_card_id, duration FROM final_videos WHERE id = ?",
            (download_id,),
        )
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Download not found")

        user_id = get_current_user_id()
        profile_id = get_current_profile_id()

        from app.services.intro_egress import resolve_intro_for_reel
        intro = resolve_intro_for_reel(
            user_id, profile_id, row['intro_card_id'], row['duration'], download_id,
            mode="playback", profile_conn=conn,
        )

    return {"intro": intro}


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
        log_video_resolution(
            logger, kind="reel_video", outcome=VideoServeOutcome.MISSING, key=None,
            entity_id=download_id, user_id=get_current_user_id(),
            profile_id=get_current_profile_id(), reason="reel_row_not_found",
        )
        raise HTTPException(status_code=404, detail="Download not found")

    presigned_url = get_download_file_url(row['filename'])
    if not presigned_url:
        log_video_resolution(
            logger, kind="reel_video", outcome=VideoServeOutcome.MISSING,
            key=_reel_video_r2_key(row['filename']), entity_id=download_id,
            user_id=get_current_user_id(), profile_id=get_current_profile_id(),
            reason="presign_unavailable",
        )
        raise HTTPException(status_code=404, detail="Failed to generate R2 URL")

    client = _get_r2_stream_client()
    range_hdr = request.headers.get("range") or request.headers.get("Range")
    # A final-video filename is immutable, so let the browser cache it: repeat
    # plays and the blur/sharp layers serve from cache instead of re-hitting R2.
    base_headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}

    if request.method == "HEAD":
        probe = await client.get(presigned_url, headers={"Range": "bytes=0-0"})
        if probe.status_code not in (200, 206):
            log_video_resolution(
                logger, kind="reel_video",
                outcome=video_outcome_for_status(probe.status_code),
                key=_reel_video_r2_key(row['filename']), entity_id=download_id,
                user_id=get_current_user_id(), profile_id=get_current_profile_id(),
                reason=f"r2_head_status_{probe.status_code}",
            )
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
        log_video_resolution(
            logger, kind="reel_video",
            outcome=video_outcome_for_status(r2.status_code),
            key=_reel_video_r2_key(row['filename']), entity_id=download_id,
            user_id=get_current_user_id(), profile_id=get_current_profile_id(),
            reason=f"r2_status_{r2.status_code}",
        )
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

        # T5810: deleting the last reel that attributed to a moved-in game reference
        # orphans that reference -> clean it up (gesture-driven, references only,
        # real games never touched).
        orphaned = _delete_orphan_reference_games(cursor)
        if orphaned:
            logger.info(
                f"[Downloads] deleting reel {download_id} cleaned {orphaned} "
                f"orphaned game reference(s)"
            )

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


class IntroAttachRequest(BaseModel):
    """Surgical reel-intro attachment (T5215). `intro_card_id` is REQUIRED (not
    defaulted) so the client always states exact intent -- there is no
    "unspecified" case for this endpoint, only 0 / null / an id."""
    intro_card_id: int | None


@router.patch("/{download_id}/intro")
async def set_download_intro(download_id: int, body: IntroAttachRequest):
    """Attach/detach/clear a reel's intro card (T5215). Gesture-only, surgical
    single-column write on the reel's CURRENT `final_videos` row.

      0    -> explicit "no intro" (never gated by consent -- detaching/opting
              out is always allowed)
      null -> no card attached (T6680: no longer inherits a profile default --
              there is none; also never gated)
      <id> -> attach that card; requires (a) parental consent recorded for
              this profile and (b) the id to reference a real card in THIS
              profile -- a dangling id is never persisted from a gesture.
    """
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    intro_card_id = body.intro_card_id

    if (intro_card_id is not None and intro_card_id != 0
            and get_intro_consent(user_id, profile_id) is None):
        raise HTTPException(
            status_code=403,
            detail="Parental consent is required before attaching an intro card.",
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()

        if not column_exists(cursor, "final_videos", "intro_card_id"):
            raise HTTPException(
                status_code=503,
                detail="Intro attachment is not available yet for this profile "
                       "(pending migration).",
            )

        cursor.execute(
            "SELECT id, duration FROM final_videos WHERE id = ? AND published_at IS NOT NULL",
            (download_id,),
        )
        reel_row = cursor.fetchone()
        if reel_row is None:
            raise HTTPException(status_code=404, detail="Download not found")

        if intro_card_id is not None and intro_card_id != 0:
            cursor.execute("SELECT 1 FROM intro_cards WHERE id = ?", (intro_card_id,))
            if cursor.fetchone() is None:
                raise HTTPException(status_code=404, detail="Intro card not found")

        cursor.execute(
            "UPDATE final_videos SET intro_card_id = ? WHERE id = ?",
            (intro_card_id, download_id),
        )
        conn.commit()

        # T5215 round 3: return the RESOLVED name too, not just the raw id --
        # the frontend's optimistic update needs it to show the thumbnail
        # badge immediately (no reload), and only the server can resolve it
        # correctly (e.g. a dangling id degrading to no-intro).
        card = resolve_intro_card(intro_card_id, reel_row["duration"], conn, reel_id=download_id)

    return {
        "success": True,
        "intro_card_id": intro_card_id,
        "intro_card_name": card["name"] if card else None,
    }


async def _serve_reel_poster_jpeg(rel_path: str, if_none_match: str | None = None):
    """Proxy a published reel's poster object with a FRESH presign per request.

    Per-profile (the owner's current profile prefix), resolved through
    `generate_presigned_url`. Mirrors `projects._serve_draft_poster_jpeg`. The
    caller verifies object existence first, so a missing poster is a clean 404
    upstream rather than a 502 from a signed GET of a nonexistent key.
    T5682: long cache (86400s) + ETag (R2's own) for 304 cache hits.

    `if_none_match` (T5682): HEADs R2 first (body-free) when present -> a match
    short-circuits to 304 without a full GET. No header -> unchanged single-GET
    hot path.

    Uses the shared pooled httpx client (`get_poster_r2_client`) -- a fresh
    `AsyncClient()` per request paid a full TLS handshake to R2 every time
    (~300-600ms observed), the T4773 landmine repeated here (T5682 fix).
    """
    from fastapi.responses import Response

    from app.storage import get_poster_r2_client, r2_head_object

    user_id = get_current_user_id()

    if if_none_match:
        head = r2_head_object(user_id, rel_path)
        if head and head.get("ETag") == if_none_match:
            return Response(status_code=304, headers={
                "Cache-Control": "private, max-age=86400",
                "ETag": head["ETag"],
            })

    url = generate_presigned_url(
        user_id, rel_path, expires_in=3600, content_type="image/jpeg"
    )
    if not url:
        log_video_resolution(
            logger, kind="reel_poster", outcome=VideoServeOutcome.MISSING,
            key=r2_key(user_id, rel_path), user_id=user_id,
            profile_id=get_current_profile_id(), reason="presign_unavailable",
        )
        raise HTTPException(status_code=404, detail="No poster for this reel")
    resp = await get_poster_r2_client().get(url)
    if resp.status_code != 200:
        log_video_resolution(
            logger, kind="reel_poster",
            outcome=video_outcome_for_status(resp.status_code),
            key=r2_key(user_id, rel_path), user_id=user_id,
            profile_id=get_current_profile_id(), reason=f"r2_status_{resp.status_code}",
        )
        raise HTTPException(status_code=502, detail="Poster fetch failed")

    # T5682: reuse R2's own ETag (already on the GET response) -- no extra hashing.
    etag = resp.headers.get("etag", "")
    headers = {"Cache-Control": "private, max-age=86400"}
    if etag:
        headers["ETag"] = etag
    return Response(
        content=resp.content,
        media_type="image/jpeg",
        headers=headers,
    )


@router.get("/{download_id}/poster.jpg")
async def get_reel_poster(
    download_id: int, request: Request, profile_id: str | None = None
):
    """Poster THUMBNAIL for a PUBLISHED reel's My Reels tile (T5673, card-size
    since T5682).

    T5682: this tile serves a SEPARATE card-size (480px) thumbnail
    (`ensure_reel_card_poster`), generated on first request by downscaling the
    existing full-size og:image poster (`final_videos/posters/{filename}.jpg`,
    captured at publish -- T5280/T4890). The full-size object is NEVER resized
    here -- it's what `shares.py`'s `_build_poster_r2_key` reads for share
    unfurls, and must stay untouched. Session-authed by the same middleware as
    every other `/api/downloads` route.

    404 when the reel row is missing OR the full-size poster doesn't exist
    (pre-T5280 reels; poster generation was best-effort and never fabricated)
    -> the drawer renders its branded fallback tile. We never fabricate an
    image (no-silent-fallback rule, CLAUDE.md). T5682: 404s are cached
    (private, 60s negative cache).

    `If-None-Match` (T5682): the card key is DETERMINISTIC from `basename`, so
    it's checked FIRST with a SINGLE HEAD, before `profile_object_exists` +
    `ensure_reel_card_poster` run their own HEADs against the same/adjacent
    keys -- a match short-circuits to 304 in one R2 round trip (stacking three
    HEADs pushed 304s to ~300ms).
    """
    from fastapi.responses import Response

    from app.services.poster import ensure_reel_card_poster, reel_card_poster_rel_path
    from app.storage import r2_head_object

    # T7940: profile_id on the URL is a per-owner cache-correctness token, not an
    # authorization mechanism -- real scoping is the session's X-Profile-ID
    # contextvar driving the profile-scoped DB read below. Refuse a mismatched
    # token BEFORE any DB read or R2 call so a URL-keyed cache can never serve one
    # account's poster bytes for another account's identical-looking request.
    # Absent param = no check possible (defense-in-depth token, not primary guard).
    if profile_id is not None and profile_id != get_current_profile_id():
        raise HTTPException(status_code=403, detail="Profile mismatch")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT filename FROM final_videos WHERE id = ?", (download_id,))
        row = cursor.fetchone()
    if not row:
        # T5682: negative cache on 404s (60s)
        return Response(
            status_code=404,
            headers={"Cache-Control": "private, max-age=60"},
            media_type="image/jpeg",
        )

    basename = poster_basename(row["filename"])
    full_rel_path = poster_rel_path(basename)
    card_rel_path = reel_card_poster_rel_path(basename)
    user_id = get_current_user_id()

    if_none_match = request.headers.get("if-none-match")
    if if_none_match:
        head = r2_head_object(user_id, card_rel_path)
        if head and head.get("ETag") == if_none_match:
            return Response(status_code=304, headers={
                "Cache-Control": "private, max-age=86400",
                "ETag": head["ETag"],
            })

    # Existence check under the current profile prefix: a poster-less reel must be
    # a clean 404 (branded fallback), NOT a 502 from signing a nonexistent object.
    if not profile_object_exists(user_id, get_current_profile_id(), full_rel_path):
        # T5682: negative cache on 404s (60s)
        return Response(
            status_code=404,
            headers={"Cache-Control": "private, max-age=60"},
            media_type="image/jpeg",
        )

    generated_card_path = ensure_reel_card_poster(user_id, basename)
    if not generated_card_path:
        # Card generation failed (transient) but the full-size poster IS present
        # -> degrade gracefully to serving the full-size poster rather than 404.
        generated_card_path = full_rel_path

    # if_none_match was already checked above (single HEAD); no need for
    # _serve_reel_poster_jpeg to re-check it (would be a wasted second HEAD).
    return await _serve_reel_poster_jpeg(generated_card_path)


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
    # T5215: `intro_card_id` is DELIBERATELY ABSENT here. Intro cards are
    # per-profile (epic decision 7) -- a source card id is meaningless (and
    # potentially collides with an unrelated card) in the target profile. This
    # is the one `final_videos` INSERT writer that must NOT carry the
    # attachment forward; omitting the column lets the target row default to
    # NULL, i.e. no intro until the user explicitly attaches one in the target
    # profile (T6680: NULL no longer inherits a profile default -- there is
    # none -- so this is simply "no dangling cross-profile ids, no intro").
    # Do not "helpfully" add it to this tuple.
)


def _build_moved_reel_row(src_row, game_remap: dict[int, int]) -> dict:
    """Map a source-profile final_videos row to the target-profile INSERT values.

    Decision 1 (published-reel-only MOVE): only the frozen metadata that lets the
    reel play + rank + display moves; editing lineage stays in the source profile.
    Decision 4 (enter target as new): reset every per-profile reference so the reel
    joins the target profile's pool clean, with no dangling cross-profile ids.

    - game_ids / game_id (T5810): REMAPPED through `game_remap` (source game id ->
      target reference/real game id, built by move_reels_to_profile via
      ensure_game_reference) so the moved reel keeps its by-game grouping in the
      target Gallery. A source game id absent from the map (its source game was
      deleted after publish) is DROPPED -- that attribution honestly cannot be
      carried. An empty remapped list -> None (routes to Mixes, matching the
      unattributed-reel behavior). game_ids is stored sorted-distinct, msgpack.
    - project_id / source_clip_id: NULL. Editing lineage genuinely does not move
      (project_id references a SOURCE project absent in the target; source_clip_id
      points at a SOURCE raw_clip and a collision could wrongly twin-sync ratings).
    - rating/rd/match_count: re-seeded exactly as a fresh export would (single-clip
      reels re-seed from their frozen quality_score; multi-clip / unrated reels
      stay NULL and never rank). match_count -> 0 discards source ranking history.
    - watched_at: NULL so the reel shows as NEW in the target's My Reels.
    """
    from app.services.glicko import RD_MAX, seed_rating

    row = {col: src_row[col] for col in _MOVED_REEL_CARRY_COLUMNS}
    row["project_id"] = None
    row["source_clip_id"] = None

    # T5810: remap the frozen game attribution into the target profile.
    src_game_ids = decode_data(src_row["game_ids"]) or []
    remapped = sorted({game_remap[g] for g in src_game_ids if g in game_remap})
    row["game_ids"] = encode_data(remapped) if remapped else None
    src_scalar = src_row["game_id"]
    row["game_id"] = game_remap.get(src_scalar) if src_scalar is not None else None
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


# Source games columns ensure_game_reference reads (metadata + reference pointers).
# source_profile_id/source_game_id are column_exists-guarded below for the deploy->
# migrate window (a pre-v030 source has no references, so NULL is correct).
_SOURCE_GAME_META_COLS = (
    "id", "name", "opponent_name", "game_date", "game_type", "tournament_name",
    "blake3_hash", "video_duration", "video_width", "video_height", "video_size",
    "video_fps", "created_at",
)


def _build_reference_map(
    source_cursor, target_conn, source_rows,
    source_profile_id, target_profile_id, user_id, req_id,
) -> dict[int, int]:
    """T5810: for every distinct source game id the moved reels attribute to, ensure a
    game reference exists in the target profile and return {source_game_id ->
    target_game_id}. A source game deleted after publish (reels outlive games) is
    DROPPED from the map with a loud warning (honest-unattributed, NOT a silent
    fallback). Chain-collapse / move-back-to-owner are resolved inside
    ensure_game_reference. Reads the SOURCE cursor, writes references via target_conn
    (committed by the caller alongside the moved final_videos rows)."""
    source_game_ids: set[int] = set()
    for src_row in source_rows:
        for gid in decode_data(src_row["game_ids"]) or []:
            source_game_ids.add(gid)
        if src_row["game_id"] is not None:
            source_game_ids.add(src_row["game_id"])

    game_remap: dict[int, int] = {}
    if not source_game_ids:
        return game_remap

    has_ref_cols = column_exists(source_cursor, "games", "source_profile_id")
    ref_select = (
        "source_profile_id, source_game_id" if has_ref_cols
        else "NULL AS source_profile_id, NULL AS source_game_id"
    )
    meta_select = ", ".join(_SOURCE_GAME_META_COLS)
    for sgid in source_game_ids:
        source_cursor.execute(
            f"SELECT {meta_select}, {ref_select} FROM games WHERE id = ?", (sgid,)
        )
        sg = source_cursor.fetchone()
        if sg is None:
            logger.warning(
                f"[MoveReels] source game {sgid} missing (deleted after publish); "
                f"dropping its attribution from moved reels {source_profile_id}->"
                f"{target_profile_id} user={user_id} req_id={req_id}"
            )
            continue
        source_cursor.execute(
            "SELECT blake3_hash, sequence, duration, video_width, video_height, "
            "video_size, fps FROM game_videos WHERE game_id = ? ORDER BY sequence",
            (sgid,),
        )
        source_videos = source_cursor.fetchall()
        game_remap[sgid] = ensure_game_reference(
            target_conn, target_profile_id, source_profile_id, sg, source_videos
        )
    return game_remap


def _delete_orphan_reference_games(cursor) -> int:
    """Delete REFERENCE games (source_profile_id NOT NULL) in the CURRENT profile that
    no remaining final_videos still attribute to (game_ids blob or scalar game_id).

    Gesture-driven ONLY -- called from the move-away (source side) and reel-delete
    gestures that can orphan a reference, NEVER a reactive sweep (EPIC decision). REAL
    games (source_profile_id NULL) are never touched. Returns the count deleted; the
    caller commits."""
    if not column_exists(cursor, "games", "source_profile_id"):
        return 0
    ref_ids = {
        r[0] for r in cursor.execute(
            "SELECT id FROM games WHERE source_profile_id IS NOT NULL"
        ).fetchall()
    }
    if not ref_ids:
        return 0

    referenced: set[int] = set()
    for row in cursor.execute(
        "SELECT game_ids FROM final_videos WHERE game_ids IS NOT NULL"
    ).fetchall():
        for gid in decode_data(row[0]) or []:
            referenced.add(gid)
    for row in cursor.execute(
        "SELECT game_id FROM final_videos WHERE game_id IS NOT NULL"
    ).fetchall():
        referenced.add(row[0])

    orphans = ref_ids - referenced
    for oid in orphans:
        cursor.execute("DELETE FROM game_videos WHERE game_id = ?", (oid,))
        cursor.execute("DELETE FROM games WHERE id = ?", (oid,))
    return len(orphans)


def _delete_moved_source_rows(cursor, video_ids: list[int]) -> int:
    """Remove moved reels from the SOURCE profile DB (T6350 extraction — reused
    verbatim by the move handler's phase 2 AND the /move-to-profile/finish
    completion endpoint, so the SQL is never duplicated). NULLs each reel's
    project pointer first (mirrors delete_download's FK cleanup; before_after_tracks
    then cascade via ON DELETE CASCADE with foreign_keys=ON), deletes the
    final_videos rows, then cleans any source-profile game REFERENCE orphaned by
    the reels leaving (T5810, gesture-driven — never a sweep). Returns the number
    of final_videos rows actually deleted (0 for an already-cleaned id, which is
    what makes /finish idempotent). Caller commits."""
    deleted = 0
    for vid in video_ids:
        cursor.execute(
            "UPDATE projects SET final_video_id = NULL WHERE final_video_id = ?", (vid,)
        )
        cursor.execute("DELETE FROM final_videos WHERE id = ?", (vid,))
        if cursor.rowcount and cursor.rowcount > 0:
            deleted += cursor.rowcount
    _delete_orphan_reference_games(cursor)
    return deleted


# T6350: the truthful 503 body when a move (or /finish) copied+synced the target
# and locally deleted the source, but the SOURCE-side durable sync then failed.
# The target copy is real and durable; only the source cleanup did not persist.
# FLAT shape (the middleware returns it via content=, and useMoveReels.js reads
# flat-or-nested-under-detail); `code`/`retryable` key names match phase-1's
# existing HTTPException payloads where they overlap.
def _source_cleanup_failed_payload(video_ids: list[int], target_profile_id: str) -> dict:
    return {
        "detail": (
            "Your reels were copied to the other profile, but we could not finish "
            "removing them from this one. They may still appear here until you retry."
        ),
        "code": "move_source_cleanup_failed",
        "retryable": True,
        "target_committed": True,
        # Copy the list — it is stashed on request.state and serialized later by the
        # middleware; an immutable-by-construction payload can't be perturbed by any
        # post-commit mutation of the caller's video_ids.
        "moved_ids": list(video_ids),
        "target_profile_id": target_profile_id,
    }


@router.post("/move-to-profile")
async def move_reels_to_profile(
    body: MoveToProfileRequest,
    request: Request,
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

    # T7510: the move gesture IS the attempt; `move_succeeded` fires below only
    # after the TARGET profile's durable sync provably returns OK (before source
    # cleanup). record_milestone is impersonation-guarded.
    from app.analytics import record_milestone
    record_milestone(user_id, "move_attempted")

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
        # require_fresh: refuse to write against a copy we could not confirm is
        # current. The write-back force-pushes, so building on a stale local file
        # reverts the target profile in R2 -- silently deleting reels moved there
        # earlier while their media survives. Abort retryably instead.
        try:
            ensure_profile_db_local(user_id, target_profile_id, require_fresh=True)
            target_conn = _open_profile_db(user_id, target_profile_id)
            if target_conn is None:
                # Only reachable now when R2 genuinely has NO DB for this profile
                # (NOT_FOUND, not an error) -- i.e. the first reel ever moved here.
                # Creating an empty schema after an R2 *error* would force-push it and
                # wipe the whole target, which is why require_fresh must run first.
                _ensure_empty_profile_db(target_profile_id)
                target_conn = _open_profile_db(user_id, target_profile_id)
        except (ProfileDBRefreshFailed, MigrationBlocked):
            # T5085 (review fix): _open_profile_db now migrates-before-touch
            # and can raise MigrationBlocked too -- moved inside this try
            # (previously only ensure_profile_db_local's require_fresh was
            # covered), since by this point Phase 0 already copied media into
            # the target prefix and MUST be rolled back on ANY of these
            # failure shapes, not just an R2-confirm error.
            _cleanup_target_objects(user_id, target_profile_id, copied_paths)
            logger.warning(
                f"[MoveReels] could not confirm target profile {target_profile_id} is "
                f"current or bring it to head; aborting rather than force-pushing a "
                f"stale/below-head copy req_id={req_id} -> 503"
            )
            raise HTTPException(
                status_code=503, detail=DURABLE_SYNC_FAILED_RESPONSE
            ) from None
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
            # T5810: materialize a game REFERENCE in the target for each distinct
            # source game the moved reels attribute to, then remap the reels'
            # game_ids/game_id through it (chain-collapse + move-back-to-owner are
            # handled inside ensure_game_reference). The reference insert rides THIS
            # phase-1 target write (committed + synced below) -- no new sync call site
            # (invariant 6b). Built inside the try so a failure rolls the target back.
            # T6350: on a re-issued move where every reel's INSERT is skipped by the
            # filename guard below, this remap still runs — it relies on
            # ensure_game_reference being idempotent (chain-collapse/move-back
            # resolved internally), so it re-points to the existing reference rather
            # than duplicating it. Proven by test_move_is_idempotent_after_source_reheal.
            game_remap = _build_reference_map(
                cursor, target_conn, source_rows,
                source_profile_id, target_profile_id, user_id, req_id,
            )
            for src_row in source_rows:
                new_row = _build_moved_reel_row(src_row, game_remap)
                # T6350 idempotency guard: a retry (e.g. via /move-to-profile/finish,
                # or a re-issued move after a phase-2-sync failure re-healed the
                # source rows back) must not double-insert a reel that phase 1
                # already committed to the target on a prior attempt. `filename` is
                # a per-user hash — a sound natural key across profiles. A skipped
                # row is NOT added to inserted_target_ids: the rollback-on-failure
                # path below deletes only THIS attempt's inserts, never a row a
                # prior attempt already durably committed.
                exists = tcur.execute(
                    "SELECT id FROM final_videos WHERE filename = ?",
                    (new_row["filename"],),
                ).fetchone()
                if exists:
                    logger.info(
                        f"[MoveReels] target already has filename={new_row['filename']} "
                        f"(fv={src_row['id']}); skipping re-insert (idempotent) "
                        f"req_id={req_id}"
                    )
                    continue
                # T4890: don't carry a poster ref whose object we did NOT relocate
                # (missing source object) -- keeps the moved row from dangling.
                if src_row["poster_filename"] and src_row["id"] not in posters_moved:
                    new_row["poster_filename"] = None
                tcur.execute(insert_sql, [new_row[c] for c in insert_cols])
                inserted_target_ids.append(tcur.lastrowid)
            target_conn.commit()

            # T5920: this path holds target_conn open (raw WAL connection, closed
            # only in the finally below) ACROSS the sync, which uploads the main
            # file only — the exact shape of the reels-lost incident (final_videos
            # rows lost while the mp4s stayed intact in R2). Flush target_conn's
            # committed frames into the main file BEFORE the upload, on its own
            # connection so the primitive's later checkpoint is a no-op. wal_
            # checkpoint does NOT raise on contention (returns busy); on busy,
            # refuse loudly via the SAME rollback + retryable 503 path used for a
            # failed sync — never ship an under-checkpointed target at a bumped
            # version. (target_conn is needed for the rollback, so we checkpoint
            # it rather than closing it before the sync.)
            target_conn.execute("PRAGMA busy_timeout=2000")
            ckpt_busy = target_conn.execute(
                "PRAGMA wal_checkpoint(TRUNCATE)"
            ).fetchone()[0]
            if ckpt_busy:
                logger.warning(
                    f"[MoveReels] target WAL checkpoint BUSY for {user_id}/"
                    f"{target_profile_id} — refusing upload (would ship stale bytes "
                    f"at a bumped version) req_id={req_id}"
                )
                target_synced = False
            else:
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
        except RecipientProfileBelowHead:
            # T6780: the TARGET profile DB is below head (v030 source-ref columns
            # absent) — _build_reference_map's ensure_game_reference can't write a
            # valid reference row. Refuse with 503 (retryable, pending migration), the
            # same shape as the durable-sync-failure branch above; the move re-lands
            # once the admin migrates. Rollback so no partial reference persists.
            target_conn.rollback()
            _cleanup_target_objects(user_id, target_profile_id, copied_paths)
            logger.warning(
                f"[MoveReels] target profile below head (pending migration) "
                f"ids={video_ids} req_id={req_id} -> 503"
            )
            raise HTTPException(status_code=503, detail="Target profile pending migration; retry shortly") from None
        except Exception:
            target_conn.rollback()
            _cleanup_target_objects(user_id, target_profile_id, copied_paths)
            logger.exception(
                f"[MoveReels] target insert failed ids={video_ids} req_id={req_id}"
            )
            raise HTTPException(status_code=500, detail="Failed to write target profile") from None
        finally:
            target_conn.close()

        # T7510: the TARGET profile's explicit durable sync returned OK (a failed
        # or conflicting sync raised a 503 above), so the move provably persists.
        # Emit success here — after the durable point, before the source cleanup.
        record_milestone(user_id, "move_succeeded")

        # --- Phase 2: target is fully durable -> remove reels from the SOURCE --
        _delete_moved_source_rows(cursor, video_ids)
        conn.commit()

    # T6350: the source rows are now locally committed and the target is fully
    # durable, so the move HAS half-applied. Only the source-side durable sync
    # (run by the middleware AFTER this handler returns) remains. If THAT fails,
    # the generic "Your reel was not moved" body is a lie — override it with the
    # truthful cleanup-failed payload. Set it ONLY here (after the phase-2 commit)
    # so any earlier phase-0/1 abort keeps the honest generic "nothing moved".
    set_durable_sync_failure_response(
        request, _source_cleanup_failed_payload(video_ids, target_profile_id)
    )

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


@router.post("/move-to-profile/finish")
async def finish_move_reels_to_profile(
    body: MoveToProfileRequest,
    request: Request,
    _durable: None = Depends(durable_sync),
):
    """T6350: idempotent completion of a half-applied move.

    When `move_reels_to_profile` copied+synced the TARGET and locally deleted the
    SOURCE rows, but the source-side durable sync then failed, the frontend gets a
    truthful `move_source_cleanup_failed` 503 and offers "Finish removing". Re-running
    the MOVE gesture does NOT work once phase 3 deleted the source media (phase 0 then
    502s "Nothing was moved"), so this endpoint re-runs ONLY the source cleanup.

    Safety: it deletes source rows only after proving the target still holds each
    reel (matched by `filename`, a per-user hash — ids differ across profiles, and a
    source row may have been re-healed back from R2). A reel not provably present in
    the target -> 409, nothing deleted for ANY id in the call. Naturally idempotent:
    an already-removed source row makes the DELETE a no-op, but the write is still
    tracked, so `durable_sync` re-attempts the source upload — the retry a prior
    /finish sync-failure needs.
    """
    user_id = get_current_user_id()
    source_profile_id = get_current_profile_id()
    req_id = get_current_req_id()
    target_profile_id = body.target_profile_id

    # --- Same sibling-profile validation as the main move (reused) ---
    from app.services.user_db import get_profiles
    profile_ids = {p["id"] for p in get_profiles(user_id)}
    if target_profile_id not in profile_ids:
        raise HTTPException(status_code=404, detail="Target profile not found")
    if target_profile_id == source_profile_id:
        raise HTTPException(
            status_code=400, detail="Target profile must differ from the current profile"
        )

    video_ids = list(dict.fromkeys(body.video_ids))
    if not video_ids:
        raise HTTPException(status_code=400, detail="No reels selected")

    # --- Read the TARGET to prove the copies exist by filename BEFORE deleting the
    # source. require_fresh=True: this is a DESTRUCTIVE confirmation, so a stale
    # local cache must not stand in for R2 — if R2 can't confirm the target is
    # current, refuse (retryable 503) and delete NOTHING, rather than removing the
    # source based on a possibly-reverted local copy (the both-profiles-empty loss
    # this task exists to prevent). We only READ the target (no force-push). ---
    try:
        ensure_profile_db_local(user_id, target_profile_id, require_fresh=True)
        target_conn = _open_profile_db(user_id, target_profile_id)
    except (ProfileDBRefreshFailed, MigrationBlocked):
        # T5085 (review fix): _open_profile_db now migrates-before-touch and
        # can raise too -- moved inside this try so both failure shapes
        # refuse (delete nothing) rather than only the require_fresh half.
        logger.warning(
            f"[MoveReels/finish] could not confirm target profile {target_profile_id} "
            f"is current or bring it to head; refusing to delete source rows "
            f"user={user_id} req_id={req_id} -> 503"
        )
        raise HTTPException(
            status_code=503, detail=DURABLE_SYNC_FAILED_RESPONSE
        ) from None
    target_filenames: set[str] = set()
    if target_conn is not None:
        try:
            target_filenames = {
                r["filename"]
                for r in target_conn.execute(
                    "SELECT filename FROM final_videos WHERE filename IS NOT NULL"
                ).fetchall()
            }
        finally:
            target_conn.close()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Resolve each requested id to its filename via the SOURCE row (re-healed
        # back from R2 if a prior partial move locally deleted it). A source row
        # that is genuinely absent has nothing left to destroy here — its deletion
        # only needs a durable re-sync (the no-op DELETE below still tracks a write).
        placeholders = ",".join("?" for _ in video_ids)
        src_filename_by_id = {
            r["id"]: r["filename"]
            for r in cursor.execute(
                f"SELECT id, filename FROM final_videos WHERE id IN ({placeholders})",
                video_ids,
            ).fetchall()
        }

        # Never destroy source data whose target copy can't be proven present.
        unconfirmed = [
            vid for vid in video_ids
            if src_filename_by_id.get(vid) is not None
            and src_filename_by_id[vid] not in target_filenames
        ]
        if unconfirmed:
            logger.warning(
                f"[MoveReels/finish] target {target_profile_id} missing reel(s) "
                f"{unconfirmed}; refusing to delete source rows user={user_id} "
                f"req_id={req_id} -> 409"
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "message": (
                        "These reels are not present in the other profile yet, so "
                        "we did not remove them here."
                    ),
                    "code": "move_target_missing",
                    "retryable": False,
                    "unconfirmed_ids": unconfirmed,
                },
            )

        deleted = _delete_moved_source_rows(cursor, video_ids)
        conn.commit()

    logger.info(
        f"[MoveReels/finish] removed {deleted} source row(s) for ids={video_ids} "
        f"{source_profile_id}->{target_profile_id} user={user_id} req_id={req_id} "
        f"(source R2 sync pending via durable_sync)"
    )
    # A repeat source-sync failure here must stay honest too, never the generic lie.
    set_durable_sync_failure_response(
        request, _source_cleanup_failed_payload(video_ids, target_profile_id)
    )
    return {"success": True, "finished_ids": video_ids, "target_profile_id": target_profile_id}


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

        # T5410: publish no longer reads slowmo_section_start/end (that was only
        # ever consumed by the T5280 poster generator this reverses -- poster
        # capture now runs at export, not here). Plain SELECT, no column guard
        # needed.
        cursor.execute("""
            SELECT id, filename
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

    # T5410: REVERSED T5280 -- poster capture no longer happens at publish. It
    # now runs at overlay EXPORT (generate_poster_at_export, routers/export/
    # overlay.py), so by the time a reel reaches publish the poster object
    # should already exist. This is a best-effort existence check only (no
    # ffmpeg, no R2 write) -- logged at info so a draft published without one
    # (pre-T5410 export, or a poster that failed at export) is visible without
    # failing publish.
    try:
        poster_key = poster_rel_path(poster_basename(row['filename']))
        has_poster = await asyncio.to_thread(file_exists_in_r2, user_id, poster_key)
        if not has_poster:
            logger.info(
                f"[Publish] project={project_id} final_video_id={row['id']} user={user_id} "
                f"req_id={req_id} published without a poster at {poster_key}; unfurl falls "
                f"back to text until a re-export or admin backfill produces one"
            )
    except Exception as e:
        # Best-effort only -- a transient R2 hiccup on this check must never
        # fail the publish gesture (same invariant the old poster generation had).
        logger.info(
            f"[Publish] project={project_id} final_video_id={row['id']} user={user_id} "
            f"req_id={req_id} poster existence check failed: {e}"
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
