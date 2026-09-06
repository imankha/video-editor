"""
Games endpoints for the Video Editor API.

This router handles game storage and management:
- POST /api/games - Create a game with 0-N video references
- GET /api/games - List all games
- GET /api/games/{id} - Get game details (including annotations)
- PUT /api/games/{id} - Update game name
- DELETE /api/games/{id} - Delete a game
- POST /api/games/{id}/videos - Add video(s) to existing game
- GET /api/games/{id}/video - Stream game video
- PUT /api/games/{id}/annotations - Update annotations
"""

import asyncio
import contextlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.analytics import record_milestone
from app.constants import GameCreateStatus, GameStatus, GameType, ShareClipScope, get_rating_adjective
from app.database import column_exists, ensure_directories, get_db_connection
from app.middleware.db_sync import durable_sync
from app.profile_context import get_current_profile_id
from app.queries import normalize_rating
from app.services.auth_db import (
    delete_ref,
    get_game_storage_ref,
    get_grace_deletion_hashes,
    insert_game_storage_ref,
)
from app.services.credit_ledger import CreditsUnavailable, deduct_credits, get_balance
from app.services.storage_credits import calculate_extension_cost, calculate_upload_cost, storage_expires_at
from app.storage import (
    R2_ENABLED,
    VideoServeOutcome,
    file_exists_in_r2,
    generate_presigned_url,
    generate_presigned_url_global,
    get_r2_client,
    log_video_resolution,
    r2_head_object_global,
    r2_key,
)
from app.user_context import get_current_user_id
from app.utils.encoding import decode_data
from app.utils.offload import run_in_context

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games"])


# ==============================================================================
# T8870 — Overlap placement (recorded_at + offset_seconds)
# ==============================================================================

# A recorded_at farther than this from the game's time zero is treated as a
# garbage clock (export-time timestamps, uncalibrated device clock): store it as
# evidence but place the video by prefix-sum instead and log a warning.
PLACEMENT_WINDOW_H = 12


def _parse_recorded_at(value) -> datetime | None:
    """Parse an ISO-8601 recorded_at into an aware UTC datetime, or None.

    Naive input is assumed UTC. Returns None on anything unparseable (the API
    boundary validator rejects unparseable client input with 422; inside the
    pure helper an unparseable value degrades to "no timestamp evidence").
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_recorded_at(value) -> str | None:
    """Canonical stored form: 'YYYY-MM-DDTHH:MM:SSZ' (UTC), or None."""
    dt = _parse_recorded_at(value)
    if dt is None:
        return None
    return dt.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def compute_video_offsets(new_videos: list, existing_videos: list | None = None) -> list[float]:
    """Canonical offset_seconds (position on the game's real-time axis) for each
    video in ``new_videos``, in order. See EPIC decision 7 + T8870 task file.

    Each video is a mapping with ``sequence`` (int), ``duration`` (float | None)
    and ``recorded_at`` (ISO string | None). ``existing_videos`` are the game's
    already-persisted rows and additionally carry ``offset_seconds`` (their
    frozen placement, which this function NEVER renumbers).

    Rules:
      - Time zero = the earliest video's recording time. Existing rows anchor the
        axis: a video's offset is (recorded_at - zero) in seconds. If the game
        already has placed rows with recorded_at, zero stays their zero (derived
        as recorded_at - offset_seconds), so an existing row is never renumbered
        and a NEW video recorded EARLIER than that zero gets a legal NEGATIVE
        offset. With no existing anchor, zero = min(recorded_at) across all
        videos that have one.
      - No recorded_at -> offset = prefix-sum of durations by sequence (the exact
        virtual position today's concatenation gives it).
      - recorded_at present but > PLACEMENT_WINDOW_H hours from zero (garbage
        clock) -> keep the recorded_at as evidence at the call site, but place by
        prefix-sum and log a warning.
    """
    existing_videos = list(existing_videos or [])

    # Axis zero. Prefer an anchor from existing PLACED rows (recorded_at +
    # offset_seconds both present): zero = recorded_at - offset. Take the min so
    # the axis stays pinned to the earliest existing anchor even if rows disagree.
    anchor_zeros = []
    for ev in existing_videos:
        rec = _parse_recorded_at(ev.get("recorded_at"))
        off = ev.get("offset_seconds")
        if rec is not None and off is not None:
            anchor_zeros.append(rec - timedelta(seconds=off))
    if anchor_zeros:
        zero_dt = min(anchor_zeros)
    else:
        all_recs = [
            _parse_recorded_at(v.get("recorded_at"))
            for v in existing_videos + list(new_videos)
        ]
        all_recs = [r for r in all_recs if r is not None]
        zero_dt = min(all_recs) if all_recs else None

    all_videos = existing_videos + list(new_videos)

    def prefix_sum(seq) -> float:
        return float(sum(
            (v.get("duration") or 0.0)
            for v in all_videos
            if v.get("sequence") is not None and v["sequence"] < seq
        ))

    offsets: list[float] = []
    for nv in new_videos:
        rec = _parse_recorded_at(nv.get("recorded_at"))
        if rec is None or zero_dt is None:
            offsets.append(prefix_sum(nv["sequence"]))
            continue
        candidate = (rec - zero_dt).total_seconds()
        if abs(candidate) > PLACEMENT_WINDOW_H * 3600:
            logger.warning(
                "[compute_video_offsets] recorded_at %s is %.0fs from game zero "
                "(> %dh window); placing by prefix-sum instead",
                nv.get("recorded_at"), candidate, PLACEMENT_WINDOW_H,
            )
            offsets.append(prefix_sum(nv["sequence"]))
        else:
            offsets.append(float(candidate))
    return offsets



def get_game_video_url(blake3_hash: str, video_filename: str) -> str:
    """
    Get presigned URL for a game video, supporting both old and new storage.

    New storage (T80): games/{blake3_hash}.mp4 (global)
    Old storage: {user_id}/games/{video_filename} (per-user)

    Returns presigned URL or None if video not available.
    """
    if blake3_hash:
        # New global storage
        return generate_presigned_url_global(
            f"games/{blake3_hash}.mp4",
            expires_in=14400
        )
    elif video_filename:
        # Old per-user storage (pre-T80 migration)
        user_id = get_current_user_id()
        return generate_presigned_url(
            user_id=user_id,
            relative_path=f"games/{video_filename}",
            expires_in=14400,
            content_type="video/mp4"
        )
    return None



def generate_clip_name(rating: int, tags: list) -> str:
    """
    Generate a default clip name based on rating and tags.
    Must match frontend generateClipName() in soccerTags.js.
    Tags are already stored as short names in the DB.
    """
    if not tags:
        return ''

    adjective = get_rating_adjective(rating)

    # Tags are already short names (stored that way by the frontend)
    if len(tags) == 1:
        tag_part = tags[0]
    else:
        tag_part = ', '.join(tags[:-1]) + ' and ' + tags[-1]

    return f"{adjective} {tag_part}"


def generate_game_display_name(
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

    Falls back to the stored name if opponent_name is not set.
    """
    if not opponent_name:
        return fallback_name

    # Format date as "Mon D" (e.g., "Dec 6")
    date_str = ""
    if game_date:
        try:
            from datetime import datetime
            dt = datetime.strptime(game_date, "%Y-%m-%d")
            date_str = dt.strftime("%b %-d")  # "Dec 6"
        except (ValueError, Exception):
            # On Windows, %-d may not work, try %#d
            try:
                from datetime import datetime
                dt = datetime.strptime(game_date, "%Y-%m-%d")
                date_str = dt.strftime("%b %d").replace(" 0", " ")  # Remove leading zero
            except Exception:
                date_str = game_date

    # Build the name based on game type
    if game_type == GameType.TOURNAMENT and tournament_name:
        prefix = f"{tournament_name}: Vs"
    elif game_type == GameType.AWAY:
        prefix = "at"
    else:  # home or default
        prefix = "Vs"

    parts = [prefix, opponent_name]
    if date_str:
        parts.append(date_str)

    return " ".join(parts)


# ==============================================================================
# Request/Response Models
# ==============================================================================

class VideoReference(BaseModel):
    blake3_hash: str = Field(..., description="BLAKE3 hash of the video file")
    sequence: int = Field(..., description="Video sequence number (1-based)")
    duration: float | None = Field(None, description="Video duration in seconds")
    width: int | None = Field(None, description="Video width in pixels")
    height: int | None = Field(None, description="Video height in pixels")
    file_size: int | None = Field(None, description="File size in bytes")
    # T8870: the video's embedded recording clock time (ISO-8601, e.g.
    # "2026-07-18T18:44:59Z"). Evidence for overlap placement; null when the
    # client couldn't read one (never a fabricated time). Reject a non-parseable
    # string at the boundary (422) rather than silently dropping it.
    recorded_at: str | None = Field(None, description="Embedded recording time (ISO-8601 UTC), or null")

    @field_validator("recorded_at")
    @classmethod
    def _validate_recorded_at(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if _parse_recorded_at(v) is None:
            raise ValueError(f"recorded_at is not a parseable ISO-8601 timestamp: {v!r}")
        return v


class CreateGameRequest(BaseModel):
    opponent_name: str | None = Field(None, description="Opponent team name")
    game_date: str | None = Field(None, description="Game date (YYYY-MM-DD)")
    game_type: str | None = Field(None, description="home, away, or tournament")
    tournament_name: str | None = Field(None, description="Tournament name")
    videos: list[VideoReference] = Field(default_factory=list, description="Video references (0-N)")
    status: str | None = Field(None, description="Game status: 'pending' (pre-upload) or 'ready' (default)")


class AddVideosRequest(BaseModel):
    videos: list[VideoReference] = Field(..., description="Video references to add")


class FinishAnnotationRequest(BaseModel):
    viewed_duration: float = Field(0, description="High-water mark of video watched in seconds")


class PlayheadRequest(BaseModel):
    position: float = Field(..., ge=0, description="Exact last playhead position in seconds")


# ==============================================================================
# Game Management Endpoints
# ==============================================================================

def _validate_video_in_r2(blake3_hash: str) -> None:
    """Validate that a video exists in R2. Raises HTTPException if not found."""
    r2_key = f"games/{blake3_hash}.mp4"
    if not r2_head_object_global(r2_key):
        raise HTTPException(
            status_code=400,
            detail=f"Video {blake3_hash} not found in R2. Upload it first."
        )


def _probe_video_metadata(blake3_hash: str) -> dict | None:
    """
    Probe a game video in R2 via ffprobe for fps, duration, width, height.
    Returns dict with all available fields, or None on failure.
    """
    from app.services.video_probe import probe_r2_video
    from app.storage import R2_BUCKET, get_r2_client
    try:
        client = get_r2_client()
        if client is None:
            return None
        return probe_r2_video(client, R2_BUCKET, f"games/{blake3_hash}.mp4")
    except Exception as e:
        logger.warning(f"[games] video probe failed for {blake3_hash}: {e}")
        return None


def _insert_game_videos(cursor, game_id: int, videos: list[VideoReference],
                        skip_fps_probe: bool = False, offsets: list[float] | None = None) -> None:
    """Insert game_videos rows for a game. Shared by create and add-videos.

    skip_fps_probe: True for pending games (video not in R2 yet). FPS is
    probed when the game is activated after upload completes.

    offsets: T8870 canonical offset_seconds parallel to ``videos`` (from
    compute_video_offsets). None means "no placement supplied" -> offset_seconds
    stays NULL and the game_videos.recorded_at is still stored as evidence.
    """
    for idx, video in enumerate(videos):
        fps = None
        duration = video.duration
        width = video.width
        height = video.height
        if not skip_fps_probe:
            meta = _probe_video_metadata(video.blake3_hash.lower())
            if meta:
                fps = meta.get("fps")
                # T8700: backfill duration/dimensions from the AUTHORITATIVE R2
                # probe when the caller didn't supply them. The post-creation
                # attach path (attachVideoToExistingGame) sends these as null —
                # a null duration makes buildFullVideoTimeline compute NaN offsets,
                # rendering the attached half unusable in Annotate. Create-time
                # callers pass a browser-probed duration, which we keep (only fill
                # the gaps), so this changes nothing for them.
                if duration is None:
                    duration = meta.get("duration")
                if width is None:
                    width = meta.get("width")
                if height is None:
                    height = meta.get("height")
        offset_seconds = offsets[idx] if offsets is not None else None
        cursor.execute("""
            INSERT INTO game_videos (game_id, blake3_hash, sequence, duration,
                                     video_width, video_height, video_size, fps,
                                     recorded_at, offset_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            game_id,
            video.blake3_hash.lower(),
            video.sequence,
            duration,
            width,
            height,
            video.file_size,
            fps,
            _normalize_recorded_at(video.recorded_at),
            offset_seconds,
        ))


def _get_game_videos_response(cursor, game_id: int) -> list:
    """Get game_videos as response dicts with presigned URLs."""
    # T8870: recorded_at/offset_seconds are projected only when present. The
    # request path is always migrated to head by the JIT seam, so this is
    # defence-in-depth for rolling-deploy skew (EPIC decision 8): naming a column
    # a peer machine hasn't migrated yet would 500 the SELECT even with zero rows.
    has_placement = column_exists(cursor, "game_videos", "offset_seconds")
    placement_cols = ", recorded_at, offset_seconds" if has_placement else ""
    cursor.execute(f"""
        SELECT blake3_hash, sequence, duration, video_width, video_height, video_size{placement_cols}
        FROM game_videos WHERE game_id = ? ORDER BY sequence
    """, (game_id,))
    rows = cursor.fetchall()

    videos = []
    for row in rows:
        video_url = generate_presigned_url_global(
            f"games/{row['blake3_hash']}.mp4", expires_in=14400
        )
        videos.append({
            'sequence': row['sequence'],
            'blake3_hash': row['blake3_hash'],
            'duration': row['duration'],
            'video_url': video_url,
            'video_width': row['video_width'],
            'video_height': row['video_height'],
            'recorded_at': row['recorded_at'] if has_placement else None,
            'offset_seconds': row['offset_seconds'] if has_placement else None,
        })
    return videos


@router.post("")
async def create_game(request: CreateGameRequest):
    """
    Create a new game with 0, 1, or N video references.

    Videos must already exist in R2 (uploaded via prepare-upload/finalize-upload).
    Each video is referenced by its blake3_hash.

    For single-video games: videos has 1 entry.
    For multi-video games (e.g., halves): videos has 2+ entries.

    T1180: empty videos is rejected. Callers must hash the first video
    before calling this endpoint; additional videos are attached via
    POST /api/games/{id}/videos. This prevents games rows from being
    committed with NULL video_filename and no game_videos rows.
    """
    if not request.videos:
        raise HTTPException(
            status_code=400,
            detail="At least one video reference is required. Hash the first video before creating the game.",
        )

    # Determine game status (pending = pre-upload, ready = default)
    game_status = GameStatus.PENDING if request.status == GameStatus.PENDING else GameStatus.READY

    # Skip R2 validation for pending games (video upload hasn't started yet)
    if game_status == GameStatus.READY:
        for video in request.videos:
            _validate_video_in_r2(video.blake3_hash.lower())

    # If a pending game already exists for this hash, return it so the
    # frontend can resume the upload and activate it.
    if game_status == GameStatus.PENDING and len(request.videos) == 1:
        blake3_hash = request.videos[0].blake3_hash.lower()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # T7490: reuse a 'pending' OR 'upload_failed' game for this hash. An
            # upload_failed row is the SAME resumable anchor the honest reap left
            # visible (its game id was preserved so annotate-during-upload clips
            # survive), so a Retry that re-selects the file must resume INTO it, never
            # spawn a duplicate. Flip it back to 'pending' so its state matches the
            # now-active re-upload (and so the reap can re-mark it if this attempt
            # also dies).
            cursor.execute(
                "SELECT id, name, status FROM games "
                "WHERE blake3_hash = ? AND status IN ('pending', 'upload_failed')",
                (blake3_hash,)
            )
            existing_pending = cursor.fetchone()
            if existing_pending:
                if existing_pending['status'] == GameStatus.UPLOAD_FAILED:
                    cursor.execute(
                        "UPDATE games SET status = 'pending' WHERE id = ?",
                        (existing_pending['id'],)
                    )
                    conn.commit()
                logger.info(
                    f"Reusing {existing_pending['status']} game "
                    f"{existing_pending['id']} for hash {blake3_hash}"
                )
                return {
                    "status": GameCreateStatus.CREATED,
                    "game_id": existing_pending['id'],
                    "name": existing_pending['name'],
                    "video_url": None,
                    "videos": [],
                }

    # Check if user already has a READY game with same video(s).
    # Pending games are excluded — they represent an in-progress upload that
    # needs to complete, not a duplicate to skip.
    if len(request.videos) == 1:
        blake3_hash = request.videos[0].blake3_hash.lower()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Check games.blake3_hash (legacy single-video)
            cursor.execute(
                "SELECT id, name FROM games WHERE blake3_hash = ? AND status = 'ready'",
                (blake3_hash,)
            )
            existing = cursor.fetchone()
            if existing:
                video_url = generate_presigned_url_global(
                    f"games/{blake3_hash}.mp4", expires_in=14400
                )
                return {
                    "status": GameCreateStatus.ALREADY_OWNED,
                    "game_id": existing['id'],
                    "name": existing['name'],
                    "video_url": video_url,
                }
            # Also check game_videos table
            cursor.execute("""
                SELECT gv.game_id, g.name FROM game_videos gv
                JOIN games g ON g.id = gv.game_id
                WHERE gv.blake3_hash = ? AND g.status = 'ready'
            """, (blake3_hash,))
            existing = cursor.fetchone()
            if existing:
                video_url = generate_presigned_url_global(
                    f"games/{blake3_hash}.mp4", expires_in=14400
                )
                return {
                    "status": GameCreateStatus.ALREADY_OWNED,
                    "game_id": existing['game_id'],
                    "name": existing['name'],
                    "video_url": video_url,
                }

    # Generate display name
    fallback = "New Game"
    display_name = generate_game_display_name(
        request.opponent_name,
        request.game_date,
        request.game_type,
        request.tournament_name,
        fallback
    )

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # For single-video, also set blake3_hash on games table (legacy compat)
        single_hash = request.videos[0].blake3_hash.lower() if len(request.videos) == 1 else None
        single_filename = f"{single_hash}.mp4" if single_hash else None

        total_duration = None
        video_width = None
        video_height = None
        total_size = None
        if request.videos:
            durations = [v.duration for v in request.videos if v.duration]
            total_duration = sum(durations) if durations else None
            video_width = request.videos[0].width
            video_height = request.videos[0].height
            sizes = [v.file_size for v in request.videos if v.file_size]
            total_size = sum(sizes) if sizes else None

            missing = []
            if not total_duration:
                missing.append("duration")
            if not video_width or not video_height:
                missing.append("dimensions")
            if not total_size:
                missing.append("size")
            if missing:
                logger.warning(
                    f"[create_game] Missing metadata from client: {', '.join(missing)}. "
                    f"Will backfill from R2 probe at activation."
                )

        cursor.execute("""
            INSERT INTO games (
                name, blake3_hash, video_filename,
                video_duration, video_width, video_height, video_size,
                opponent_name, game_date, game_type, tournament_name,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            display_name,
            single_hash,
            single_filename,
            total_duration,
            video_width,
            video_height,
            total_size,
            request.opponent_name,
            request.game_date,
            request.game_type,
            request.tournament_name,
            game_status.value,
        ))
        game_id = cursor.lastrowid

        # T8870: canonical placement for a fresh game (no existing rows to anchor).
        offsets = compute_video_offsets([
            {"sequence": v.sequence, "duration": v.duration, "recorded_at": v.recorded_at}
            for v in request.videos
        ])

        # Insert game_videos rows (for ALL games, including single-video)
        _insert_game_videos(cursor, game_id, request.videos,
                            skip_fps_probe=(game_status == GameStatus.PENDING),
                            offsets=offsets)

        conn.commit()

    record_milestone(get_current_user_id(), "game_created", {"game_id": game_id, "game_name": display_name})
    logger.info(f"Created game {game_id}: {display_name} with {len(request.videos)} video(s) status={game_status.value}")

    # Build response with video URLs
    with get_db_connection() as conn:
        cursor = conn.cursor()
        videos_response = _get_game_videos_response(cursor, game_id)

    # For single-video, include video_url at top level for backward compat
    video_url = videos_response[0]['video_url'] if videos_response else None

    return {
        "status": GameCreateStatus.CREATED,
        "game_id": game_id,
        "name": display_name,
        "video_url": video_url,
        "videos": videos_response,
    }


@router.post("/{game_id:int}/videos")
async def add_game_videos(game_id: int, request: AddVideosRequest):
    """
    Attach video(s) to an existing, READY game (e.g. a second half/part).

    Videos must already exist in R2. T8700 hardened this endpoint: it was
    previously called ONLY by the create-time multi-upload path
    (uploadMultiVideoGame), which owns sequencing/credits/refs itself, so the
    endpoint skipped all three. Now that it is a first-class post-creation
    gesture it (1) charges credits for the attached bytes, (2) inserts storage
    refs so the expiry sweep can't reclaim the attached source early, and (3)
    assigns server-side append-only sequences. Attaching onto a non-ready game
    is rejected (409) — a pending game is still uploading its first video(s).
    """
    if not request.videos:
        raise HTTPException(status_code=400, detail="No videos provided")

    # Validate all videos exist in R2
    for video in request.videos:
        _validate_video_in_r2(video.blake3_hash.lower())

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Check game exists AND is ready. Attach is a post-creation action; a
        # pending game is still uploading its first video(s) via the create-time
        # multi-upload path (uploadMultiVideoGame), which owns sequencing there.
        cursor.execute("SELECT id, status FROM games WHERE id = ?", (game_id,))
        game_row = cursor.fetchone()
        if not game_row:
            raise HTTPException(status_code=404, detail="Game not found")
        if game_row["status"] != GameStatus.READY:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "game_not_ready",
                    "message": "Videos can only be added to a ready game",
                },
            )

        # Retry safety: never insert the same hash twice. A client retry after a
        # dropped response would otherwise re-append the same video at MAX+1 (a
        # NEW sequence, so UNIQUE(game_id, sequence) doesn't catch it), listing the
        # half twice. Dedup incoming videos against what's already attached; the
        # (idempotent) charge below still runs so an insert-but-no-charge crash
        # self-heals on retry.
        cursor.execute("SELECT blake3_hash FROM game_videos WHERE game_id = ?", (game_id,))
        existing_hashes = {r["blake3_hash"] for r in cursor.fetchall()}
        new_videos = [v for v in request.videos if v.blake3_hash.lower() not in existing_hashes]

        # Cost + reference_id key on the FULL request (stable across retries) so the
        # ledger's (source, reference_id) idempotency dedupes the charge. Distinct
        # from activate_game's game_upload:{game_id} pair — reusing it would be a
        # silent no-op (already charged).
        new_size = sum(v.file_size or 0 for v in request.videos)
        cost = calculate_upload_cost(new_size) if new_size > 0 else 1
        reference_id = f"{game_id}:" + ":".join(sorted(v.blake3_hash.lower() for v in request.videos))

        if new_videos:
            # No free video: refuse a NEW attach the user can't pay for BEFORE
            # writing the row (parity with create-time's prepare-upload can_afford
            # gate). The authoritative idempotent charge still runs after
            # commit+refs; this pre-check prevents the common broke-user path from
            # committing a usable-but-unpaid video, which can't be rolled back once
            # _ensure_game_storage_refs opens its own connection (bug26p).
            if get_balance(user_id) < cost:
                raise HTTPException(
                    status_code=402,
                    detail={
                        "message": "Insufficient credits to add video",
                        "required": cost,
                        "balance": get_balance(user_id),
                    },
                )

            # APPEND-ONLY (GAP 3): assign sequences server-side from MAX(sequence)+1.
            # Never trust the client's sequence — a prepend/reorder would shift every
            # existing clip's virtual-timeline offset (getVideoOffset), silently
            # mis-positioning clips. UNIQUE(game_id, sequence) is the backstop.
            cursor.execute(
                "SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM game_videos WHERE game_id = ?",
                (game_id,),
            )
            next_seq = cursor.fetchone()["max_seq"] + 1
            for offset, video in enumerate(new_videos):
                video.sequence = next_seq + offset

            # T8870: place the attached videos on the game's existing real-time
            # axis. Read the already-persisted rows so compute_video_offsets can
            # anchor to their zero (and never renumber them); a video recorded
            # earlier than the existing zero legally gets a negative offset.
            has_placement = column_exists(cursor, "game_videos", "offset_seconds")
            existing_rows = []
            if has_placement:
                cursor.execute(
                    "SELECT sequence, duration, recorded_at, offset_seconds "
                    "FROM game_videos WHERE game_id = ?",
                    (game_id,),
                )
                existing_rows = [
                    {"sequence": r["sequence"], "duration": r["duration"],
                     "recorded_at": r["recorded_at"], "offset_seconds": r["offset_seconds"]}
                    for r in cursor.fetchall()
                ]
            new_offsets = compute_video_offsets(
                [{"sequence": v.sequence, "duration": v.duration, "recorded_at": v.recorded_at}
                 for v in new_videos],
                existing_videos=existing_rows,
            ) if has_placement else None

            # Insert new game_videos rows (append-only sequences; _insert_game_videos
            # probes+backfills duration/dimensions from R2 so the attached half has a
            # real duration for buildFullVideoTimeline).
            _insert_game_videos(cursor, game_id, new_videos, offsets=new_offsets)

            # Update games table with re-aggregated video metadata.
            cursor.execute("""
                SELECT COUNT(*) as cnt, SUM(duration) as total_duration, SUM(video_size) as total_size
                FROM game_videos WHERE game_id = ?
            """, (game_id,))
            agg = cursor.fetchone()

            updates = []
            params = []
            if agg and agg['total_duration']:
                updates.append("video_duration = ?")
                params.append(agg['total_duration'])
            if agg and agg['total_size']:
                updates.append("video_size = ?")
                params.append(agg['total_size'])

            # For single-video games, set legacy fields + dimensions
            total_videos = agg['cnt'] if agg else 0
            if total_videos == 1:
                v = new_videos[0]
                h = v.blake3_hash.lower()
                updates += ["blake3_hash = ?", "video_filename = ?"]
                params += [h, f"{h}.mp4"]
                if v.width:
                    updates.append("video_width = ?")
                    params.append(v.width)
                if v.height:
                    updates.append("video_height = ?")
                    params.append(v.height)
                # T1500: mirror fps from the game_videos row we just inserted+probed
                cursor.execute(
                    "SELECT fps FROM game_videos WHERE game_id = ? AND sequence = ?",
                    (game_id, v.sequence),
                )
                gv_row = cursor.fetchone()
                if gv_row and gv_row['fps']:
                    updates.append("video_fps = ?")
                    params.append(gv_row['fps'])

            if updates:
                params.append(game_id)
                cursor.execute(f"UPDATE games SET {', '.join(updates)} WHERE id = ?", params)

        # bug26p: commit the metadata writes BEFORE refs/credits so the storage-ref
        # insert (which opens its OWN connection) can't deadlock on our write lock —
        # same ordering as activate_game.
        conn.commit()

        # GAP 2: storage refs for the newly-attached hashes. Idempotent per hash
        # and HEAD-checks the R2 source first (bug 27p), so existing videos'
        # already-ref'd hashes are skipped and an absent source is never ref'd.
        expires_str = storage_expires_at().isoformat()
        _ensure_game_storage_refs(cursor, game_id, user_id, profile_id, expires_str)

        videos_response = _get_game_videos_response(cursor, game_id)

    # GAP 1: charge for the newly-attached bytes. Idempotent on (source,
    # reference_id) — runs even for a pure retry (new_videos empty) so an
    # insert-but-no-charge crash self-heals, and can't double-charge. Refs-before-
    # charge mirrors activate_game so we never charge for an unref'd source.
    try:
        result = deduct_credits(user_id, cost, source="game_video_add", reference_id=reference_id)
    except CreditsUnavailable:
        raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
    if not result["success"]:
        raise HTTPException(
            status_code=402,
            detail={
                "message": "Insufficient credits to add video",
                "required": cost,
                "balance": result["balance"],
            },
        )

    # Q2: lightweight milestone for funnel visibility (no daily column).
    record_milestone(user_id, "game_video_add", {"game_id": game_id, "videos_added": len(new_videos)})

    logger.info(f"Added {len(new_videos)} video(s) to game {game_id}, cost={cost}cr")
    return {
        "game_id": game_id,
        "videos_added": len(new_videos),
        "videos": videos_response,
        "upload_cost_charged": cost,
    }


def _ensure_game_storage_refs(cursor, game_id, user_id, profile_id, expires_str):
    """Insert any missing game_storage refs for a game's videos. Idempotent.

    bug26p: insert_game_storage_ref opens its OWN connection (profile SQLite +
    Postgres game_storage_refs), so the caller's connection MUST NOT hold an open
    write transaction when this runs (else SQLite writer lock). Call only after a
    commit / on a read-only connection. Returns the count of refs newly inserted.
    """
    video_rows = cursor.execute(
        "SELECT blake3_hash, video_size FROM game_videos WHERE game_id = ?",
        (game_id,),
    ).fetchall()
    existing = {
        r["blake3_hash"]
        for r in cursor.execute("SELECT blake3_hash FROM game_storage").fetchall()
    }
    inserted = 0
    for vr in video_rows:
        h = vr["blake3_hash"]
        if h and h not in existing:
            # Only insert a future-expiry ref if the R2 source actually exists.
            # Writing a ref for a deleted source would resurrect the game as
            # 'active' even though playback is impossible (bug 27p root cause).
            # When R2 is not configured (local dev / tests), skip the check.
            if get_r2_client() and not r2_head_object_global(f"games/{h}.mp4"):
                logger.warning(
                    f"[activate] skipping storage ref for absent R2 source "
                    f"game={game_id} hash={h[:12]}"
                )
                continue
            insert_game_storage_ref(user_id, profile_id, h, vr["video_size"] or 0, expires_str)
            inserted += 1
    return inserted


def _maybe_send_game_ready_email(game_id: int, game_name: str) -> None:
    """Fire the T7670 upload-complete return-trigger email, best-effort.

    All eligibility checks run SYNCHRONOUSLY here in request context (where the
    impersonator contextvar and the user's user.sqlite are available), then only
    the network send is handed to a fire-and-forget background task. Any failure
    is swallowed — a game activation must never fail because an email couldn't
    be sent. Skips:
      - impersonation: an admin activating a user's game must not email them
        (mirrors record_milestone's T1515 guard);
      - opt-out: the user turned off notification emails;
      - no address: guest / email-less accounts have nothing to send to.
    """
    try:
        from app.services.auth_db import get_user_by_id
        from app.services.email import send_game_ready_email
        from app.services.poster_warmer import fire_and_forget
        from app.services.user_db import get_notification_email_optout
        from app.user_context import get_current_impersonator_id

        if get_current_impersonator_id():
            logger.debug(f"[game_ready_email] skipped game {game_id}: impersonation")
            return

        user_id = get_current_user_id()
        if get_notification_email_optout(user_id):
            logger.debug(f"[game_ready_email] skipped game {game_id}: user opted out")
            return

        user = get_user_by_id(user_id)
        email = user.get("email") if user else None
        if not email:
            logger.debug(f"[game_ready_email] skipped game {game_id}: no email for user")
            return

        profile_id = get_current_profile_id()
        fire_and_forget(send_game_ready_email(email, game_name, game_id, profile_id))
    except Exception as e:
        # Never let the return-trigger email break an activation.
        logger.warning(f"[game_ready_email] failed to schedule for game {game_id}: {e}")


@router.post("/{game_id:int}/activate")
async def activate_game(
    game_id: int,
    _durable: None = Depends(durable_sync),  # T8150: sync the pending->ready flip to R2 before 200
):
    """
    T1540: Flip a pending game to ready after video upload completes.

    Validates all game_videos have their blake3_hash present in R2,
    probes FPS for any videos missing it, then sets status='ready'.
    Idempotent: returns success if game is already ready.

    T8150: durable_sync — the pending->ready flip (and, via the whole-file
    profile.sqlite upload, the create_game pending INSERT) must reach R2 BEFORE
    the 200 that fires the "Game ready!" toast. Without it the flip rode the
    middleware's fire-and-forget sync; a 0.5s lock-defer or a machine swap lost it,
    and the next cold restore / CAS re-heal pulled R2's pre-flip snapshot back down,
    reverting the game to 'pending' (filtered out of readyGames) or dropping it
    entirely — while the credit debit (Postgres, T5840) stayed durable. That is the
    "credits debited + game vanished" incident (ojedalucas19 T7870 shape).
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id, status, blake3_hash, name FROM games WHERE id = ?", (game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        game_name = game["name"]

        if game['status'] == GameStatus.READY:
            # bug26p: A prior activation may have flipped status to ready before
            # writing storage refs (or crashed between). Self-heal any missing refs
            # idempotently. The connection has only read so far (no open write txn),
            # so insert_game_storage_ref's own connection can't deadlock here.
            healed = _ensure_game_storage_refs(
                cursor, game_id,
                get_current_user_id(), get_current_profile_id(),
                storage_expires_at().isoformat(),
            )
            if healed:
                logger.info(f"[activate] self-healed {healed} missing storage ref(s) for ready game {game_id}")
            return {"game_id": game_id, "status": GameStatus.READY}

        # Validate all videos exist in R2
        cursor.execute(
            "SELECT blake3_hash FROM game_videos WHERE game_id = ?",
            (game_id,)
        )
        video_rows = cursor.fetchall()

        for row in video_rows:
            _validate_video_in_r2(row['blake3_hash'])

        # Also validate the legacy blake3_hash on the games row if present
        if game['blake3_hash']:
            _validate_video_in_r2(game['blake3_hash'])

        # Backfill missing metadata from R2 probe (pending games skip probe at creation)
        for row in video_rows:
            cursor.execute(
                "SELECT fps, duration, video_width, video_height FROM game_videos WHERE game_id = ? AND blake3_hash = ?",
                (game_id, row['blake3_hash'])
            )
            gv = cursor.fetchone()
            if not gv:
                continue

            needs_probe = not gv['fps'] or not gv['duration'] or not gv['video_width'] or not gv['video_height']
            if not needs_probe:
                continue

            meta = _probe_video_metadata(row['blake3_hash'])
            if not meta:
                logger.warning(f"[activate] probe failed for game={game_id} hash={row['blake3_hash']}, metadata will remain incomplete")
                continue

            gv_updates = []
            gv_params = []
            if not gv['fps'] and meta.get('fps'):
                gv_updates.append("fps = ?")
                gv_params.append(meta['fps'])
            # T4260: the duration stored at pending-insert is the CLIENT-provided value
            # (from the browser's video element, possibly truncated on a partial buffer).
            # This probe ran on the COMPLETE R2 object, so it is authoritative -- overwrite
            # the stored duration with it rather than only filling when NULL. This fixes
            # the source of the truncated-duration bug the removed reactive PATCH papered
            # over. (Activation always probes here: pending videos have fps=NULL.)
            if meta.get('duration'):
                gv_updates.append("duration = ?")
                gv_params.append(meta['duration'])
            if not gv['video_width'] and meta.get('width'):
                gv_updates.append("video_width = ?")
                gv_params.append(meta['width'])
            if not gv['video_height'] and meta.get('height'):
                gv_updates.append("video_height = ?")
                gv_params.append(meta['height'])

            if gv_updates:
                logger.info(f"[activate] backfilling game_videos game={game_id} hash={row['blake3_hash']}: {', '.join(gv_updates)}")
                cursor.execute(
                    f"UPDATE game_videos SET {', '.join(gv_updates)} WHERE game_id = ? AND blake3_hash = ?",
                    (*gv_params, game_id, row['blake3_hash'])
                )

            if meta.get('fps'):
                cursor.execute(
                    "UPDATE games SET video_fps = ? WHERE id = ? AND video_fps IS NULL",
                    (meta['fps'], game_id)
                )

        # Backfill games table aggregates from game_videos
        cursor.execute("""
            SELECT SUM(duration) as total_duration, SUM(video_size) as total_size,
                   MIN(video_width) as width, MIN(video_height) as height
            FROM game_videos WHERE game_id = ?
        """, (game_id,))
        agg = cursor.fetchone()
        if agg:
            game_updates = []
            game_params = []
            if agg['total_duration']:
                # T4260: authoritative from the complete-file probe above (not COALESCE),
                # so a truncated client-provided games.video_duration is corrected too.
                game_updates.append("video_duration = ?")
                game_params.append(agg['total_duration'])
            if agg['total_size']:
                game_updates.append("video_size = COALESCE(video_size, ?)")
                game_params.append(agg['total_size'])
            if agg['width']:
                game_updates.append("video_width = COALESCE(video_width, ?)")
                game_params.append(agg['width'])
            if agg['height']:
                game_updates.append("video_height = COALESCE(video_height, ?)")
                game_params.append(agg['height'])
            if game_updates:
                cursor.execute(
                    f"UPDATE games SET {', '.join(game_updates)} WHERE id = ?",
                    (*game_params, game_id)
                )

        # Backfill working_clips created before activation (fps was NULL
        # because game_videos hadn't been probed yet during pending creation)
        cursor.execute("""
            UPDATE working_clips
            SET fps = (
                SELECT gv.fps FROM raw_clips rc
                JOIN game_videos gv ON gv.game_id = rc.game_id
                    AND gv.sequence = COALESCE(rc.video_sequence, 1)
                WHERE rc.id = working_clips.raw_clip_id
            )
            WHERE fps IS NULL
            AND raw_clip_id IN (
                SELECT id FROM raw_clips WHERE game_id = ?
            )
        """, (game_id,))

        # T1580: Compute total size and storage cost
        cursor.execute(
            "SELECT blake3_hash, video_size FROM game_videos WHERE game_id = ?",
            (game_id,),
        )
        game_video_rows = cursor.fetchall()
        total_size = sum(r["video_size"] or 0 for r in game_video_rows)

        user_id = get_current_user_id()
        profile_id = get_current_profile_id()
        upload_cost = calculate_upload_cost(total_size) if total_size > 0 else 1
        expires_str = storage_expires_at().isoformat()

        # bug26p: Commit the metadata backfills BEFORE credits/refs/status. This closes
        # activate's write transaction so insert_game_storage_ref (which opens its own
        # connection) can't deadlock, and lets us write storage refs BEFORE flipping
        # status. Backfills are safe to persist on a still-pending game (metadata only).
        conn.commit()

        # Write storage refs FIRST, before the status flip. If this fails the game stays
        # pending: no charge, and never a ready-without-ref (the games 8/9/10 class of
        # bug). insert_game_storage_ref is idempotent per hash, so retries are no-ops.
        for vr in game_video_rows:
            if vr["blake3_hash"]:
                insert_game_storage_ref(
                    user_id, profile_id, vr["blake3_hash"],
                    vr["video_size"] or 0, expires_str,
                )

        # Deduct credits, then flip status — kept ADJACENT so the charge->ready window is
        # as small as today. deduct_credits is idempotent on (source, reference_id), so a
        # retry after a crash between deduct and the status commit won't double-charge.
        try:
            result = deduct_credits(user_id, upload_cost, source="game_upload", reference_id=str(game_id))
        except CreditsUnavailable:
            raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
        if not result["success"]:
            raise HTTPException(
                status_code=402,
                detail={
                    "message": "Insufficient credits for game upload",
                    "required": upload_cost,
                    "balance": result["balance"],
                },
            )

        # T7670: conditional flip so the ready-email fires EXACTLY once per game
        # even if two activate calls race past the status==READY early-return
        # above — only the writer that actually flips pending->ready (rowcount
        # == 1) sends the email; a concurrent loser gets rowcount 0 and skips it.
        cursor.execute(
            "UPDATE games SET status = ? WHERE id = ? AND status != ?",
            (GameStatus.READY, game_id, GameStatus.READY),
        )
        flipped_to_ready = cursor.rowcount == 1
        conn.commit()

    logger.info(f"Activated game {game_id}: status=ready, cost={upload_cost}cr")

    # T7670: upload-complete return-trigger email. Fired only on the genuine
    # pending->ready transition (this game is now durably ready, refs + credits
    # committed), deduped by flipped_to_ready. Best-effort and non-blocking —
    # never fails or delays the activation response.
    if flipped_to_ready:
        _maybe_send_game_ready_email(game_id, game_name)

    # T5683: Warm the game source poster at gesture (non-blocking background task).
    # Best-effort -- never fails the activation. get_current_user_id/
    # get_current_profile_id are already imported at module level (top of
    # file) -- do NOT re-import locally here: a local import makes the name
    # local to the WHOLE function, which broke the EARLIER self-heal call at
    # get_current_user_id()/get_current_profile_id() above (UnboundLocalError).
    from app.services.poster_warmer import fire_and_forget, warm_game_source_poster_background
    fire_and_forget(
        warm_game_source_poster_background(
            get_current_user_id(), get_current_profile_id(), game_id
        )
    )

    return {
        "game_id": game_id,
        "status": GameStatus.READY,
        "upload_cost_charged": upload_cost,
    }



BADGE_TAGS = frozenset({
    'Goal', 'Assist', 'Chance Creation',
    'Touchdown Pass', 'Touchdown Catch', 'Touchdown Run', 'Field Goal',
    'Scoring', 'Dunk',
    'Try',
    'Shot',
    'Kill', 'Ace',
    'Home Run',
})

_EMPTY_ATHLETE_STATS = {
    'clip_count': 0,
    'brilliant_count': 0, 'good_count': 0, 'interesting_count': 0,
    'mistake_count': 0, 'blunder_count': 0, 'aggregate_score': 0,
    'tag_badges': {},
}


def _compute_athlete_stats(cursor, game_ids: list) -> dict:
    """Compute rating counts and tag badges for my_athlete=true clips, per game."""
    placeholders = ','.join('?' * len(game_ids))
    cursor.execute(f"""
        SELECT game_id, rating, tags, my_athlete
        FROM raw_clips WHERE game_id IN ({placeholders})
    """, game_ids)

    from collections import defaultdict
    per_game = defaultdict(lambda: {
        'clip_count': 0,
        'brilliant_count': 0, 'good_count': 0, 'interesting_count': 0,
        'mistake_count': 0, 'blunder_count': 0,
        'tag_badges': defaultdict(int),
    })

    for row in cursor.fetchall():
        gid = row['game_id']
        # clip_count is the TOTAL clips in the game (shared clips have my_athlete=0,
        # so it must be counted before the athlete filter); rating badges stay
        # my_athlete-filtered below.
        per_game[gid]['clip_count'] += 1

        is_athlete = row['my_athlete'] is None or bool(row['my_athlete'])
        if not is_athlete:
            continue

        stats = per_game[gid]
        rating = normalize_rating(row['rating'], context=f"game_stats game={gid}")
        if rating == 5:
            stats['brilliant_count'] += 1
        elif rating == 4:
            stats['good_count'] += 1
        elif rating == 3:
            stats['interesting_count'] += 1
        elif rating == 2:
            stats['mistake_count'] += 1
        elif rating == 1:
            stats['blunder_count'] += 1

        tags = decode_data(row['tags']) or []
        for tag in tags:
            if tag in BADGE_TAGS:
                stats['tag_badges'][tag] += 1

    result = {}
    for gid, stats in per_game.items():
        b = stats['brilliant_count']
        g = stats['good_count']
        m = stats['mistake_count']
        bl = stats['blunder_count']
        result[gid] = {
            'clip_count': stats['clip_count'],
            'brilliant_count': b,
            'good_count': g,
            'interesting_count': stats['interesting_count'],
            'mistake_count': m,
            'blunder_count': bl,
            'aggregate_score': b * 3 + g * 2 + m * -1 + bl * -2,
            'tag_badges': dict(stats['tag_badges']),
        }
    return result


def _compute_reel_counts(cursor, game_ids: list) -> dict:
    """Published reels attributable to each game (T8260).

    A reel counts for a game when its FROZEN game_ids decodes to exactly that
    one game id (route_game_ids), regardless of clip_count. NOT route_collection:
    that also demands clip_count == 1 (the T3630 single-clip Collections pool),
    which would report 0 reels for a multi-clip highlight reel built from one
    game. So this count can exceed the game's Collections bucket count by design.
    Multi-game mixes and game-less reels count for NO game.

    Same three filters GET /api/collections/summary uses (collections.py): latest
    version per source, published only, teammate-only single-clip reels excluded.
    ONE query for the whole list, decoded in Python (no N+1).
    """
    from app.queries import exclude_teammate_reels_clause, latest_final_videos_subquery
    from app.services.collection_metadata import route_game_ids

    if not game_ids:
        return {}
    wanted = set(game_ids)
    cursor.execute(f"""
        SELECT fv.game_ids
        FROM final_videos fv
        WHERE fv.id IN ({latest_final_videos_subquery()})
          AND fv.published_at IS NOT NULL
          {exclude_teammate_reels_clause()}
    """)
    counts: dict = {}
    for row in cursor.fetchall():
        gid = route_game_ids(row["game_ids"])
        if gid in wanted:
            counts[gid] = counts.get(gid, 0) + 1
    return counts


async def list_games_metadata():
    """Return game metadata without presigned URLs (used by bootstrap endpoint)."""
    ensure_directories()
    return await _list_games_impl(skip_presigned_urls=True)


def _game_status_or_log(status, game_id):
    """T4280: trust the stored game status. A NULL status is a data bug to find, not
    hide as 'ready' -- log at ERROR and surface the real (null) value so the frontend
    can render an unknown state instead of a false 'ready'."""
    if status is None:
        logger.error(
            f"[games] Game {game_id} has NULL status -- data bug; surfacing null "
            f"instead of defaulting to 'ready'. Investigate the source of the null."
        )
    return status


@router.get("")
async def list_games():
    """List all saved games. Videos stored globally at games/{blake3_hash}.mp4."""
    ensure_directories()
    return await _list_games_impl(skip_presigned_urls=False)


# T7290: the games list is ordered by MATCH date descending, matching how the Games tab
# groups and renders it (ProjectManager.groupGamesForTab) -- the first paint, and any
# consumer that trusts server order, must not contradict the rendered order. game_date is
# date-only TEXT ("YYYY-MM-DD"), so it sorts lexicographically; substr() reduces the
# created_at timestamp to that same shape for rows whose game_date is missing (games
# predating the required field, plus materialized/shared rows), placing them by upload
# date instead of dropping them off the list. Ties on a match date -- which carries no
# time -- fall back to upload time, newest first, the same tiebreak the frontend applies.
# Named so tests/test_t7290_games_list_order.py asserts the EXACT production expression.
GAMES_MATCH_DATE_ORDER_BY = (
    "ORDER BY COALESCE(NULLIF(g.game_date, ''), substr(g.created_at, 1, 10)) DESC, "
    "g.created_at DESC"
)


def _read_games_for_list():
    """T6200: every blocking read for the games list, on ONE worker thread.

    Runs the games/game_videos JOIN, the game_storage expiry read and athlete
    stats (all sqlite via the request's profile connection) plus the Postgres
    grace-hash read. Returns plain data only — no sqlite cursor/connection escapes
    the thread (connections are thread-affine). Reads request contextvars
    (get_db_connection resolves the current user/profile), so it MUST be invoked
    via run_in_context so those contextvars survive into the thread.
    """
    from app.user_context import get_current_user_id

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # T5800: the reference columns (source_profile_id/source_game_id, profile_db
        # v030) land on this bootstrap-hot SELECT. Migrations run MANUALLY post-deploy,
        # so between deploy and migrate an un-migrated DB has NO such columns -- naming
        # them unconditionally would 500 every games read in that window (the T5970/
        # T6030 class). Guard with column_exists and project NULLs when absent: a
        # pre-v030 DB simply has no references yet (nothing can create one until v030),
        # so NULL is the correct value.
        has_ref_cols = column_exists(cursor, "games", "source_profile_id")
        ref_select = (
            "g.source_profile_id, g.source_game_id"
            if has_ref_cols
            else "NULL AS source_profile_id, NULL AS source_game_id"
        )

        cursor.execute(f"""
            SELECT g.id, g.name, g.blake3_hash, g.video_filename, g.created_at,
                   g.opponent_name, g.game_date, g.game_type, g.tournament_name,
                   g.video_duration, g.viewed_duration, g.status, g.video_size,
                   g.auto_export_status, g.recap_video_url, {ref_select},
                   COALESCE(gv_sum.total_duration, g.video_duration) AS effective_duration
            FROM games g
            LEFT JOIN (
                SELECT game_id, SUM(duration) AS total_duration
                FROM game_videos
                GROUP BY game_id
            ) gv_sum ON gv_sum.game_id = g.id
            {GAMES_MATCH_DATE_ORDER_BY}
        """)
        rows = cursor.fetchall()

        # Storage expiry from profile SQLite (per-user, single source of truth)
        storage_rows = cursor.execute(
            "SELECT blake3_hash, storage_expires_at FROM game_storage"
        ).fetchall()
        expiry_by_hash = {r['blake3_hash']: r['storage_expires_at'] for r in storage_rows}
        all_ref_hashes = {r['blake3_hash'] for r in storage_rows}

        # Compute my_athlete-filtered stats and tag badges per game
        game_ids = [row['id'] for row in rows]
        athlete_stats = _compute_athlete_stats(cursor, game_ids) if game_ids else {}
        # T8260: published reels attributable to each game (same cursor, no N+1).
        reel_counts = _compute_reel_counts(cursor, game_ids)

    # T5800: resolve owning-profile display names for reference cards. ONE user.sqlite
    # read regardless of reference count (no per-row lookup -> no N+1); skipped
    # entirely when there are no references.
    source_profile_names: dict[str, str] = {}
    ref_profile_ids = {
        row['source_profile_id'] for row in rows if row['source_profile_id']
    }
    if ref_profile_ids:
        from app.services.user_db import get_profiles
        for p in get_profiles(get_current_user_id()):
            if p['id'] in ref_profile_ids:
                source_profile_names[p['id']] = p['name']

    grace_hashes = get_grace_deletion_hashes()
    return (
        rows, expiry_by_hash, all_ref_hashes, athlete_stats, grace_hashes,
        source_profile_names, reel_counts,
    )


async def _list_games_impl(skip_presigned_urls=False):
    from app.database import get_database_path
    from app.profile_context import get_current_profile_id
    from app.user_context import get_current_user_id
    _profile = get_current_profile_id()
    _db_path = get_database_path()
    logger.info(f"[list_games] user={get_current_user_id()} profile={_profile} db={_db_path}")

    # T6200: run all blocking sqlite/Postgres reads on a worker thread. Previously
    # these ran directly on the event loop, serializing every concurrent request
    # (a burst drained together — the HAR fingerprint). run_in_context carries the
    # request contextvars so get_db_connection resolves the right profile in the
    # thread. The presign warm below already offloads via to_thread; list-building
    # then reads the warmed presigned-URL cache (no blocking) on the loop.
    (rows, expiry_by_hash, all_ref_hashes, athlete_stats, grace_hashes,
     source_profile_names, reel_counts) = await run_in_context(_read_games_for_list)

    # T2880: Pre-generate presigned URLs for all games concurrently.
    # T3380: Skip when called from bootstrap (URLs loaded lazily on demand).
    if not skip_presigned_urls:
        unique_hashes = {row['blake3_hash'] for row in rows if row['blake3_hash']}
        if unique_hashes:
            await asyncio.gather(*[
                asyncio.to_thread(generate_presigned_url_global, f"games/{h}.mp4", 14400)
                for h in unique_hashes
            ])

    games = []
    for row in rows:
        if not row['opponent_name'] or not row['game_date'] or not row['game_type']:
            logger.warning(
                f"Game {row['id']} missing details: opponent={row['opponent_name']}, "
                f"date={row['game_date']}, type={row['game_type']}, name={row['name']}"
            )

        display_name = generate_game_display_name(
            row['opponent_name'],
            row['game_date'],
            row['game_type'],
            row['tournament_name'],
            row['name']
        )

        video_url = None if skip_presigned_urls else get_game_video_url(row['blake3_hash'], row['video_filename'])

        # T5800: a reference (source_profile_id NOT NULL) is a metadata-only link to a
        # game owned by a sibling profile. It has NO game_storage row, so skip all
        # storage-expiry computation -- a reference must never show expiry chips or a
        # can-extend affordance (EPIC decision 4; video lifecycle stays with the owner).
        source_profile_id = row['source_profile_id']
        is_reference = source_profile_id is not None

        blake3 = row['blake3_hash']
        if is_reference:
            expires_at_val = None
            storage_status = None
            can_extend = False
        else:
            expires_at_val = expiry_by_hash.get(blake3)
            storage_status = _compute_storage_status(expires_at_val, row['auto_export_status'], bool(blake3))
            can_extend = blake3 in all_ref_hashes or blake3 in grace_hashes

        stats = athlete_stats.get(row['id'], _EMPTY_ATHLETE_STATS)

        games.append({
            'id': row['id'],
            'name': display_name,
            'raw_name': row['name'],
            'opponent_name': row['opponent_name'],
            'game_date': row['game_date'],
            'game_type': row['game_type'],
            'tournament_name': row['tournament_name'],
            'blake3_hash': blake3,
            'video_url': video_url,
            'clip_count': stats['clip_count'],  # derived live from raw_clips, not the stale stored column
            'reel_count': reel_counts.get(row['id'], 0),  # T8260: published reels for this game, derived live
            'brilliant_count': stats['brilliant_count'],
            'good_count': stats['good_count'],
            'interesting_count': stats['interesting_count'],
            'mistake_count': stats['mistake_count'],
            'blunder_count': stats['blunder_count'],
            'aggregate_score': stats['aggregate_score'],
            'tag_badges': stats['tag_badges'],
            'created_at': row['created_at'],
            'video_duration': row['effective_duration'],
            'viewed_duration': row['viewed_duration'] or 0,
            'status': _game_status_or_log(row['status'], row['id']),
            'storage_status': storage_status,
            'storage_expires_at': expires_at_val,
            'video_size': row['video_size'],
            'auto_export_status': row['auto_export_status'],
            'recap_video_url': row['recap_video_url'],
            'can_extend': can_extend,
            # T5800: reference (cross-profile game-attribution link) fields. A UI (T5820)
            # renders a reference as a link card back to the owning profile.
            'is_reference': is_reference,
            'source_profile_id': source_profile_id,
            'source_game_id': row['source_game_id'] if is_reference else None,
            'source_profile_name': (
                source_profile_names.get(source_profile_id) if is_reference else None
            ),
        })

    logger.info(f"[list_games] returning {len(games)} games for profile={_profile}")

    # T5683: Warm game source posters for visible games without recaps
    # (non-blocking background). Recap posters are warmed at share creation.
    async def warm_visible_game_sources():
        """Warm game source posters (games without recaps) with bounded concurrency."""
        warmer = get_poster_warmer()
        user_id = get_current_user_id()
        profile_id = _profile
        tasks = []
        for game in games:
            # Only warm source posters for games without recap (recap already warmed at share).
            if not game['recap_video_url']:
                game_id = game['id']
                coro = warmer.warm_game_source_poster_async(
                    user_id, profile_id, game_id
                )
                tasks.append(warmer.warm_with_semaphore(coro))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
            logger.info(f"[ListWarm] warmed {len(tasks)} game source posters for {len(games)} visible games")

    # Fire-and-forget warming (never fails the list endpoint).
    if games and not skip_presigned_urls:
        try:
            from app.services.poster_warmer import fire_and_forget, get_poster_warmer
            fire_and_forget(warm_visible_game_sources())
        except Exception as e:
            logger.info(f"[ListWarm] game warming task creation failed: {e}")

    return {'games': games}


@router.get("/{game_id:int}/urls")
async def get_game_urls(game_id: int):
    """Return presigned URLs for a single game (lazy-loaded on demand)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT blake3_hash, video_filename, recap_video_url FROM games WHERE id = ?",
            (game_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Game not found")
        video_url = get_game_video_url(row['blake3_hash'], row['video_filename'])
        return {
            "game_id": game_id,
            "video_url": video_url,
            "recap_video_url": row['recap_video_url'],
        }


@router.get("/{game_id:int}/recap-url")
async def get_recap_url(game_id: int):
    """Get presigned URL for a game's recap video."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        game = cursor.execute(
            "SELECT recap_video_url FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()

    if not game or not game['recap_video_url']:
        raise HTTPException(status_code=404, detail="No recap video")

    user_id = get_current_user_id()
    url = generate_presigned_url(user_id, game['recap_video_url'], expires_in=14400)
    return {"url": url}


def _compute_recap_clips(game_id: int, layer: str | None = None):
    """Compute recap clip positions from DB by summing durations in concat order."""
    from collections import defaultdict

    from app.services.auto_export import _get_annotated_clips

    clips = _get_annotated_clips(game_id, layer)
    clips_by_hash = defaultdict(list)
    for clip in clips:
        clips_by_hash[clip['video_hash']].append(clip)

    result = []
    offset = 0.0
    for hash_clips in clips_by_hash.values():
        for clip in hash_clips:
            duration = clip['end_time'] - clip['start_time']
            result.append({
                'id': clip['id'],
                'name': clip['name'],
                'rating': clip['rating'],
                'tags': decode_data(clip['tags']) or [],
                'notes': clip['notes'] or '',
                'recap_start': round(offset, 3),
                'recap_end': round(offset + duration, 3),
            })
            offset += duration
    return result


def _compute_game_clips(game_id: int, layer: str | None = None):
    """Clips with timestamps relative to the GAME video (not a stitched recap).

    Field names mirror _compute_recap_clips (recap_start / recap_end) because the
    recap viewer's useRecapPlayback consumes those keys; here they carry the
    game-relative clip start/end so the same player can seek each clip inside the
    full game video. Ordered by (video_sequence, start_time) via _get_annotated_clips.
    """
    from app.services.auto_export import _get_annotated_clips

    result = []
    for clip in _get_annotated_clips(game_id, layer):
        if clip['start_time'] is None or clip['end_time'] is None:
            continue
        result.append({
            'id': clip['id'],
            'name': clip['name'],
            'rating': clip['rating'],
            'tags': decode_data(clip['tags']) or [],
            'notes': clip['notes'] or '',
            'recap_start': round(clip['start_time'], 3),
            'recap_end': round(clip['end_time'], 3),
        })
    return result


@router.get("/{game_id:int}/recap-data")
async def get_recap_data(game_id: int, layer: str = "athlete"):
    """Get a playable video URL + clip timeline for the per-layer recap viewer
    (T5710): Team Recap (`layer=team`) or {Athlete} Recap (`layer=athlete`,
    default — NULL/pre-migration `my_athlete` is legacy-athlete).

    Resolution order per layer (full rationale:
    docs/plans/tasks/team-game-share/T5710-design.md):
      0. Layer has ZERO live rated clips -> explicit empty state. Never a
         silent fallback to the other layer, never an empty stitched video.
      1. A per-layer STITCHED recap exists (its mapping is stamped for THIS
         layer) -> that recap's url + its frozen, layer-pure mapping.
      2. Else the GAME VIDEO still exists -> game url + a LIVE layer-filtered,
         game-relative clip list (always correct, works pre-stitch too).
      3. Else a LEGACY (pre-T5710, unstamped) mixed recap survives:
         a. its mapping resolves against live raw_clips -> seek-filtered to
            this layer (may resolve to zero entries — a legitimate "nothing of
            this layer in this old artifact" result, video_kind='recap_legacy').
         b. the mapping is missing, or NONE of its clip ids resolve at all ->
            offsets are unrecoverable; degrade to a single COMBINED entry that
            plays the whole legacy file, honestly labelled as the old
            pre-team-layer recap (video_kind='recap_legacy_combined',
            clips=[]) — an explicit state, NEVER presented under either
            per-layer label.
      4. Nothing playable survives for this layer -> url=None + the layer's
         live clip list (names only, so the modal still lists them).

    Only 404s when the game row itself is missing. video_kind tells the client
    which source was chosen: 'recap' | 'game' | 'recap_legacy' |
    'recap_legacy_combined' | None.
    """
    from app.constants import RecapLayer
    from app.services.auto_export import (
        _get_annotated_clips,
        clip_matches_layer,
        load_recap_mapping,
        recap_r2_keys,
    )

    if layer not in (RecapLayer.ATHLETE.value, RecapLayer.TEAM.value):
        raise HTTPException(status_code=400, detail=f"Invalid layer: {layer!r}")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        game = cursor.execute(
            "SELECT blake3_hash, video_filename FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()

    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    user_id = get_current_user_id()
    blake3 = game['blake3_hash']
    game_video_key = f"games/{blake3}.mp4" if blake3 else None
    game_video_exists = bool(game_video_key) and (r2_head_object_global(game_video_key) is not None)

    # 0. Empty-layer guard, based on LIVE clips, checked before any artifact I/O.
    if not _get_annotated_clips(game_id, layer):
        logger.info(f"[recap-data] game={game_id} layer={layer} -> empty (no live clips)")
        return {"url": None, "clips": [], "video_kind": None, "empty": True}

    layer_recap_key, layer_mapping_key = recap_r2_keys(game_id, layer)
    layer_recap_exists = file_exists_in_r2(user_id, layer_recap_key)
    stamped_mapping_layer, stamped_clips = (
        load_recap_mapping(user_id, layer_mapping_key) if layer_recap_exists else (None, [])
    )

    if layer_recap_exists and stamped_mapping_layer == layer:
        # 1. Per-layer stitched recap.
        url = generate_presigned_url(user_id, layer_recap_key, expires_in=14400)
        clips = stamped_clips
        video_kind = 'recap'
        source = f"recap ({layer_recap_key})"
    elif game_video_exists:
        # 2. Game video seek-through, live layer filter.
        url = get_game_video_url(blake3, game['video_filename'])
        clips = _compute_game_clips(game_id, layer)
        video_kind = 'game'
        source = f"game video ({game_video_key})"
    else:
        # 3/4. Game video is gone. Check for a surviving LEGACY (unstamped)
        # mixed recap under the unsuffixed key — for the athlete layer this IS
        # `layer_recap_key` (already ruled out above via the stamp check); for
        # the team layer it's the shared pre-T5710 artifact.
        legacy_key, legacy_mapping_key = recap_r2_keys(game_id, None)
        legacy_exists = file_exists_in_r2(user_id, legacy_key)
        legacy_layer, legacy_entries = (
            load_recap_mapping(user_id, legacy_mapping_key) if legacy_exists else (None, [])
        )
        if legacy_exists and legacy_layer is None:
            ids = [e['id'] for e in legacy_entries if 'id' in e]
            resolvable = {}
            if ids:
                with get_db_connection() as conn:
                    placeholders = ",".join("?" * len(ids))
                    rows = conn.execute(
                        f"SELECT id, my_athlete FROM raw_clips WHERE id IN ({placeholders})", ids,
                    ).fetchall()
                resolvable = {r['id']: r['my_athlete'] for r in rows}
            url = generate_presigned_url(user_id, legacy_key, expires_in=14400)
            if not resolvable:
                # 3b. Offsets unrecoverable — explicit combined state, NEVER
                # presented under a per-layer label.
                clips = []
                video_kind = 'recap_legacy_combined'
                source = f"legacy combined recap, unresolvable mapping ({legacy_key})"
            else:
                # 3a. Seek-filtered to this layer (may resolve to zero entries).
                clips = [
                    e for e in legacy_entries
                    if e.get('id') in resolvable and clip_matches_layer(resolvable[e['id']], layer)
                ]
                video_kind = 'recap_legacy'
                source = f"legacy recap, layer-filtered ({legacy_key})"
        else:
            # 4. Nothing playable survives (post-grace + no legacy — or the
            # unsuffixed key is itself a stamped OTHER-layer recap). Clip
            # NAMES still list from live data.
            url = None
            clips = _compute_game_clips(game_id, layer)
            video_kind = None
            source = "none (video unavailable, no usable legacy recap)"

    # T4080: enrich each clip with its unified in-match start (seconds) so the recap
    # clip list can show the soccer-notation game time. Derived from raw_clips (a
    # recap clip's 'id' is its raw_clip id), so it works even for frozen recap
    # mappings (recaps/{id}_clips.json) that predate this field. raw_clips persist
    # for expired games, so this resolves there too.
    # T4130: also surface `in_drafts` (does this clip already have a draft reel?) from the
    # same raw_clips row so the recap viewer's "Create clip" button can disable when a draft
    # already exists. Mirrors update_raw_clip's auto_project_id dedup; no new query/storage.
    # T5710: also surface `tagged_teammates` (decoded) for the Team Recap clip
    # rail's per-player filter chips — always derived LIVE (never baked into a
    # frozen mapping), so it works for stitched/legacy/combined clips alike.
    from app.services.collection_metadata import compute_unified_clip_start
    with get_db_connection() as conn:
        _cur = conn.cursor()
        for c in clips:
            # in_drafts must mean "has a project currently IN the drafts list":
            # archived (= published) projects don't count. Mirrors the
            # archived-aware join used by the games list query below.
            rc = _cur.execute(
                """SELECT rc.start_time, rc.tagged_teammates,
                          CASE WHEN p.id IS NOT NULL AND p.archived_at IS NULL
                               THEN rc.auto_project_id ELSE NULL END AS auto_project_id
                   FROM raw_clips rc
                   LEFT JOIN projects p ON p.id = rc.auto_project_id
                   WHERE rc.id = ?""", (c.get('id'),)
            ).fetchone()
            if rc:
                if rc['start_time'] is not None:
                    c['game_start_time'] = compute_unified_clip_start(_cur, c['id'], rc['start_time'])
                c['in_drafts'] = rc['auto_project_id'] is not None
                c['tagged_teammates'] = decode_data(rc['tagged_teammates']) or []

    logger.info(
        f"[recap-data] game={game_id} layer={layer} "
        f"game_video_key={game_video_key!r} game_video_exists={game_video_exists} "
        f"-> source={source}, video_kind={video_kind}, clips={len(clips)}"
    )

    return {"url": url, "clips": clips, "video_kind": video_kind}


@router.get("/{game_id:int}/brilliant-clips")
async def get_brilliant_clips(game_id: int):
    """Get brilliant clip exports for a game (5-star or 4-star fallback auto-exports)."""
    from app.queries import exclude_teammate_reels_clause, latest_final_videos_subquery

    get_current_user_id()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        rows = cursor.execute(
            f"""SELECT fv.id, fv.name, fv.duration
                FROM final_videos fv
                WHERE fv.source_type = 'brilliant_clip'
                  AND fv.game_id = ?
                  AND fv.published_at IS NOT NULL
                  AND fv.id IN ({latest_final_videos_subquery()})
                  {exclude_teammate_reels_clause()}
                ORDER BY fv.id""",
            (game_id,),
        ).fetchall()

    clips = [
        {"id": row["id"], "name": row["name"] or f"Clip {row['id']}", "duration": row["duration"]}
        for row in rows
    ]
    return {"clips": clips}


class ExtendStorageRequest(BaseModel):
    days: int = Field(..., ge=1, le=365)


@router.post("/{game_id:int}/extend-storage")
async def extend_game_storage(game_id: int, request: ExtendStorageRequest):
    """Extend storage expiry for a game by N days. Deducts credits."""
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        game = cursor.execute(
            "SELECT id, blake3_hash, video_size FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        game_size = game['video_size'] or 0
        cost = calculate_extension_cost(game_size, request.days)

        ext_ref = f"{game_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        try:
            result = deduct_credits(user_id, cost, source="storage_extension", reference_id=ext_ref)
        except CreditsUnavailable:
            raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
        if not result["success"]:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_credits",
                    "required": cost,
                    "balance": result["balance"],
                },
            )

        # Get current expiry from profile SQLite (per-user source of truth)
        ref = get_game_storage_ref(user_id, profile_id, game['blake3_hash']) if game['blake3_hash'] else None
        current_expiry = ref['storage_expires_at'] if ref else None
        if current_expiry:
            exp_dt = current_expiry if isinstance(current_expiry, datetime) else datetime.fromisoformat(current_expiry)
            base = max(exp_dt.replace(tzinfo=None), datetime.utcnow())
        else:
            base = datetime.utcnow()
        new_expiry = storage_expires_at(from_dt=base, days=request.days)
        new_expiry_str = new_expiry.isoformat()

        game_video_rows = cursor.execute(
            "SELECT blake3_hash, video_size FROM game_videos WHERE game_id = ?",
            (game_id,),
        ).fetchall()

    for vr in game_video_rows:
        insert_game_storage_ref(
            user_id, profile_id, vr["blake3_hash"],
            vr["video_size"] or 0, new_expiry_str,
        )

    logger.info(
        f"[extend_storage] game={game_id} extended by {request.days}d, "
        f"cost={cost}cr, new_expiry={new_expiry_str}"
    )

    return {
        "success": True,
        "new_expires_at": new_expiry_str,
        "cost_credits": cost,
        "new_balance": result["balance"],
    }


@router.get("/tournaments")
async def list_tournaments():
    """
    List all unique tournament names that have been used.
    Returns tournaments sorted alphabetically for dropdown selection.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT tournament_name
            FROM games
            WHERE tournament_name IS NOT NULL
              AND tournament_name != ''
              AND status = 'ready'
            ORDER BY tournament_name ASC
        """)
        rows = cursor.fetchall()
        tournaments = [row['tournament_name'] for row in rows]

    return {'tournaments': tournaments}


@router.get("/{game_id:int}")
async def get_game(game_id: int):
    """Get game details including annotations. Updates last_accessed_at."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, blake3_hash, video_filename, created_at,
                   video_duration, video_width, video_height, video_size,
                   opponent_name, game_date, game_type, tournament_name,
                   viewed_duration, last_playhead_position, status
            FROM games
            WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Update last_accessed_at (local + global)
        cursor.execute_local(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )
        conn.commit()

        annotations = load_annotations_from_db(game_id)

        display_name = generate_game_display_name(
            row['opponent_name'],
            row['game_date'],
            row['game_type'],
            row['tournament_name'],
            row['name']
        )

        # Check for game_videos (T82: multi-video support)
        videos = _get_game_videos_response(cursor, game_id)

        if videos:
            # Use game_videos as source of truth
            video_url = videos[0]['video_url'] if videos else None
            total_duration = sum(v['duration'] for v in videos if v['duration'])
            video_width = videos[0].get('video_width') or row['video_width']
            video_height = videos[0].get('video_height') or row['video_height']
        else:
            # Legacy single-video (no game_videos rows)
            video_url = get_game_video_url(row['blake3_hash'], row['video_filename'])
            total_duration = row['video_duration']
            video_width = row['video_width']
            video_height = row['video_height']

        return {
            'id': row['id'],
            'name': display_name,
            'raw_name': row['name'],
            'blake3_hash': row['blake3_hash'],
            'video_url': video_url,
            'videos': videos,
            'annotations': annotations,
            'clip_count': len(annotations),
            'created_at': row['created_at'],
            'viewed_duration': row['viewed_duration'] or 0,
            'last_playhead_position': row['last_playhead_position'],
            'video_duration': total_duration,
            'video_width': video_width,
            'video_height': video_height,
            'video_size': row['video_size'],
        }


@router.put("/{game_id:int}")
async def update_game(
    game_id: int,
    name: str | None = Form(None),
    opponent_name: str | None = Form(None),
    game_date: str | None = Form(None),
    game_type: str | None = Form(None),
    tournament_name: str | None = Form(None),
):
    """Update game metadata (opponent, date, type, tournament)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id, name, opponent_name, game_date, game_type, tournament_name FROM games WHERE id = ?",
            (game_id,),
        )
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        updates = {}
        if opponent_name is not None:
            updates['opponent_name'] = opponent_name
        if game_date is not None:
            updates['game_date'] = game_date
        if game_type is not None:
            if game_type not in (GameType.HOME, GameType.AWAY, GameType.TOURNAMENT):
                raise HTTPException(status_code=422, detail=f"Invalid game_type: {game_type}")
            updates['game_type'] = game_type
        if tournament_name is not None:
            updates['tournament_name'] = tournament_name
        if name is not None:
            updates['name'] = name

        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided")

        # Regenerate display name if any metadata field changed
        metadata_fields = {'opponent_name', 'game_date', 'game_type', 'tournament_name'}
        if metadata_fields & updates.keys():
            final_opponent = updates.get('opponent_name', game['opponent_name'])
            final_date = updates.get('game_date', game['game_date'])
            final_type = updates.get('game_type', game['game_type'])
            final_tournament = updates.get('tournament_name', game['tournament_name'])
            updates['name'] = generate_game_display_name(
                final_opponent, final_date, final_type, final_tournament, game['name']
            )

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = [*list(updates.values()), game_id]
        cursor.execute(f"UPDATE games SET {set_clause} WHERE id = ?", values)
        conn.commit()

        logger.info(f"Updated game {game_id}: {list(updates.keys())}")
        return {'success': True}


# T4260: removed PATCH /{game_id}/duration (correct_game_duration). It was written
# to only by AnnotateContainer's reactive effect (the last banned effect->API write),
# now deleted. Duration is made correct at the source: activate_game re-probes the
# COMPLETE R2 file and stores that authoritative duration, so the browser never needs
# to "correct" a truncated value. Zero remaining callers -> dead write path removed.


# T4270: removed PUT /{game_id}/annotations (update_annotations) and its
# save_annotations_to_db full-state writer -- a dormant full-blob overwrite with zero
# live callers (its only frontend caller, gamesDataStore.saveAnnotations, was also
# removed). Annotations are written solely via the surgical /clips/raw gesture flow;
# GET still exposes them via load_annotations_from_db.


def _game_has_user_content(cursor, game_id: int) -> bool:
    """True if a game has acquired user annotation work or watch progress (T7470).

    Content = any raw_clips row for the game, OR viewed_duration > 0. Used by the
    only-if-empty cleanup delete to refuse destroying work a user committed against a
    still-uploading game (T1540 annotate-during-upload). Runs on the caller's cursor so
    the check and the cascade share one transaction/connection — a clip committed
    between the client's pre-check and the DELETE is still seen here and refused.
    """
    row = cursor.execute("SELECT viewed_duration FROM games WHERE id = ?", (game_id,)).fetchone()
    if row is None:
        return False
    if (row['viewed_duration'] or 0) > 0:
        return True
    clip = cursor.execute(
        "SELECT 1 FROM raw_clips WHERE game_id = ? LIMIT 1", (game_id,)
    ).fetchone()
    return clip is not None


def _delete_game_cascade(cursor, game_id: int) -> tuple[list[str], int]:
    """Delete a game and its now-orphaned projects within the caller's transaction.

    Returns (video_hashes, orphaned_project_count). The caller must commit and then
    call delete_ref(user_id, profile_id, h) for each returned hash -- delete_ref
    opens its OWN connection, so it can't run inside this transaction.

    Shared by the main DELETE /{id} route AND the dedupe DELETE route so BOTH keep
    game_storage ref-counts and orphan projects correct. The dedupe route used to run
    a bare `DELETE FROM games` with no ref cleanup, leaking R2 refs permanently (T4270).

    Cleanup order matters for FK constraints:
    - raw_clips cascade from games (ON DELETE CASCADE), which cascades to working_clips
    - projects reference clips without cascade, so empty ones are pruned explicitly.
    """
    # Collect video hashes before cascade delete removes game_videos rows.
    video_hashes = [
        row['blake3_hash'] for row in
        cursor.execute("SELECT blake3_hash FROM game_videos WHERE game_id = ?", (game_id,)).fetchall()
    ]

    # Find all projects linked to this game's clips (auto-created or manual).
    cursor.execute("""
        SELECT DISTINCT p.id FROM projects p
        JOIN working_clips wc ON wc.project_id = p.id
        JOIN raw_clips rc ON rc.id = wc.raw_clip_id
        WHERE rc.game_id = ?
    """, (game_id,))
    project_ids_before = {row['id'] for row in cursor.fetchall()}

    # Delete the game — cascades to raw_clips, which cascades to working_clips.
    cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))

    # Delete any projects that are now empty (all their clips came from this game).
    if project_ids_before:
        placeholders = ','.join('?' * len(project_ids_before))
        cursor.execute(f"""
            DELETE FROM projects WHERE id IN ({placeholders})
            AND id NOT IN (SELECT DISTINCT project_id FROM working_clips)
        """, list(project_ids_before))
        orphaned = cursor.rowcount
    else:
        orphaned = 0

    return video_hashes, orphaned


@router.delete("/{game_id:int}")
async def delete_game(game_id: int, only_if_empty: bool = False):
    """Delete a game from user's database. Global video is NOT deleted (may be shared).

    only_if_empty=True is the failed-upload cleanup path (T7470): it REFUSES to delete a
    game that has acquired user content (raw_clips, or viewed_duration > 0), leaving it at
    status='pending' so annotate-during-upload work (T1540) survives a transfer failure.
    The refusal is a 200 no-op (`deleted: False`) rather than an error — the cleanup handler
    is best-effort and must not surface a scary failure for the expected "user annotated"
    case. A user-gestured delete from the UI (no flag) keeps FULL cascade semantics, unchanged.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id, status FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # T7470: the backend guard is the invariant, not the frontend pre-check. Re-checking
        # here (same connection as the cascade) catches a clip committed after the client
        # decided the game was empty — the race the task calls out.
        if only_if_empty and _game_has_user_content(cursor, game_id):
            logger.info(f"[T7470] Refused only-if-empty delete of game {game_id}: has user content; left pending")
            return {'success': True, 'deleted': False, 'reason': 'has_content'}

        # T7870: only_if_empty means "clean up a game that never became real" -- a game
        # that already reached READY has been validated in R2 and charged credits, so it
        # is a paid asset even before the user annotates anything. Without this check, a
        # client that missed activate_game's 200 (transport loss, slow response) runs
        # the cleanup delete against a game the server already finished -- cascade-deleting
        # a paid, empty game and orphaning its R2 object with no refund (ojedalucas19,
        # 2026-08-26: this predates the check above catching it, since he had annotated
        # before the delete and would have been caught by content -- but the same race
        # without any annotation slips past that guard entirely).
        if only_if_empty and row['status'] != GameStatus.PENDING:
            logger.info(f"[T7870] Refused only-if-empty delete of game {game_id}: status={row['status']} (not pending)")
            return {'success': True, 'deleted': False, 'reason': 'activated'}

        video_hashes, orphaned = _delete_game_cascade(cursor, game_id)
        conn.commit()

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    for h in video_hashes:
        delete_ref(user_id, profile_id, h)

    logger.info(f"Deleted game {game_id} ({orphaned} orphaned projects cleaned up, {len(video_hashes)} storage refs removed)")
    return {'success': True, 'deleted': True}


@router.get("/{game_id:int}/video")
async def get_game_video(game_id: int):
    """Redirect to presigned R2 URL for game video. Updates last_accessed_at."""
    from fastapi.responses import RedirectResponse

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT blake3_hash, video_filename FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()

        if not row:
            # No hash/key to probe -- the game record itself is gone.
            log_video_resolution(
                logger,
                kind="game_video",
                outcome=VideoServeOutcome.MISSING,
                key=None,
                entity_id=game_id,
                user_id=get_current_user_id(),
                profile_id=get_current_profile_id(),
                reason="game_row_not_found",
            )
            raise HTTPException(status_code=404, detail="Game not found")

        # Update last_accessed_at (local + global)
        cursor.execute_local(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )
        conn.commit()

        # Support both new (blake3_hash) and old (video_filename) storage
        presigned_url = get_game_video_url(row['blake3_hash'], row['video_filename'])
        if presigned_url:
            # Success: record the RESOLVED key at DEBUG (never INFO -- this is a
            # hot path) so a later client-side 401/404 can be tied to the exact
            # key without a HEAD here. NO failure-path HEAD on success (T2880).
            log_video_resolution(
                logger,
                kind="game_video",
                outcome=VideoServeOutcome.REDIRECT_302,
                key=_game_video_r2_key(row['blake3_hash'], row['video_filename']),
                entity_id=game_id,
                user_id=get_current_user_id(),
                profile_id=get_current_profile_id(),
                blake3_hash=row['blake3_hash'],
            )
            return RedirectResponse(url=presigned_url, status_code=302)
        log_game_video_failure(
            cursor,
            game_id=game_id,
            blake3_hash=row['blake3_hash'],
            video_filename=row['video_filename'],
            kind="game_video",
            reason="presign_unavailable",
        )
        raise HTTPException(status_code=404, detail="Video not available")


# ============================================================================
# Database-backed annotation functions (for Phase 3+ of the refactor)
# ============================================================================

def load_annotations_from_db(game_id: int) -> list:
    """Load annotations from raw_clips table for a game."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # T8070: surface the reel-source window (v049) so the annotate Reel control
        # can compare the clip's live start/end against what its reel was built
        # from. Column-guarded for the deploy->migrate window: project NULL when
        # absent (below-head DB) rather than 500 the whole game load.
        if column_exists(cursor, "raw_clips", "reel_source_start_time"):
            _reel_src_select = "rc.reel_source_start_time, rc.reel_source_end_time"
        else:
            _reel_src_select = "NULL AS reel_source_start_time, NULL AS reel_source_end_time"
        # Query raw_clips as the single source of truth for clip annotations
        cursor.execute(f"""
            SELECT rc.id, rc.start_time, rc.end_time, rc.name, rc.rating, rc.tags, rc.notes, rc.video_sequence,
                   rc.tagged_teammates, rc.my_athlete, rc.shared_by,
                   {_reel_src_select},
                   CASE WHEN p.id IS NOT NULL AND p.archived_at IS NULL THEN rc.auto_project_id ELSE NULL END AS auto_project_id
            FROM raw_clips rc
            LEFT JOIN projects p ON p.id = rc.auto_project_id
            WHERE rc.game_id = ?
            ORDER BY rc.video_sequence, rc.end_time
        """, (game_id,))
        rows = cursor.fetchall()

        annotations = []
        for row in rows:
            tags = decode_data(row['tags']) or []

            # Generate default name if empty
            name = row['name']
            if not name:
                name = generate_clip_name(row['rating'], tags)

            tagged_teammates = decode_data(row['tagged_teammates']) if row['tagged_teammates'] else None
            my_athlete_val = row['my_athlete']
            my_athlete = True if my_athlete_val is None else bool(my_athlete_val)

            annotations.append({
                'id': row['id'],  # raw_clip id for frontend sync
                'raw_clip_id': row['id'],  # Also send as raw_clip_id for importAnnotations
                'start_time': row['start_time'],
                'end_time': row['end_time'],
                'name': name,
                'rating': row['rating'],
                'tags': tags,
                'notes': row['notes'] or '',
                'video_sequence': row['video_sequence'],  # T82: which video (null = single-video)
                'auto_project_id': row['auto_project_id'],
                'reel_source_start_time': row['reel_source_start_time'],  # T8070
                'reel_source_end_time': row['reel_source_end_time'],  # T8070
                'tagged_teammates': tagged_teammates,
                'my_athlete': my_athlete,
                'shared_by': row['shared_by'],
            })

        return annotations


@router.post("/{game_id:int}/finish-annotation")
async def finish_annotation(game_id: int, body: FinishAnnotationRequest = FinishAnnotationRequest()):
    """
    Called when user leaves annotation mode for a game.
    Persists the high-water mark of video watched (viewed_duration).

    Persists high-water mark only; no side effects.
    """
    if body.viewed_duration > 0:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # High-water mark: never decrease viewed_duration
            cursor.execute(
                "UPDATE games SET viewed_duration = MAX(COALESCE(viewed_duration, 0), ?) WHERE id = ?",
                (body.viewed_duration, game_id)
            )
            if cursor.rowcount == 0:
                # Zero-row write = the game no longer exists (e.g. cascade-deleted after a
                # failed upload, or deleted mid-annotate). Fail visibly and record nothing:
                # a milestone tied to a write that did not happen manufactures a false
                # activity trail (T7500).
                logger.warning(f"[FinishAnnotation] game {game_id} not found (zero-row update); no milestone recorded")
                raise HTTPException(status_code=404, detail="Game not found")
            conn.commit()
            logger.info(f"[FinishAnnotation] Updated viewed_duration={body.viewed_duration:.1f}s for game {game_id}")

        from ..analytics import record_milestone
        record_milestone(get_current_user_id(), "annotation_completed", {"game_id": game_id})
    else:
        logger.info(f"[FinishAnnotation] User left annotation mode for game {game_id} (no progress update)")

    return {
        "success": True,
        "tasks_created": 0,
        "message": "Annotation session ended"
    }


@router.post("/{game_id:int}/playhead")
async def save_playhead(game_id: int, body: PlayheadRequest):
    """Persist the exact last playhead position for a game (single-video resume).

    Unlike viewed_duration (a high-water mark for review progress), this is a
    direct overwrite — it may move backward so reopening lands exactly where the
    user left off. Designed to accept navigator.sendBeacon on tab close.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE games SET last_playhead_position = ? WHERE id = ?",
            (body.position, game_id)
        )
        conn.commit()
        logger.info(f"[Playhead] Saved last_playhead_position={body.position:.1f}s for game {game_id}")

    return {"success": True}


def _compute_storage_status(expires_at_val, auto_export_status, has_hash: bool = True) -> str:
    """Storage status of a game's source video: 'expired' or 'active'.

    Single source of truth shared by list_games and load_game so the two can't
    diverge. Expired when the game_storage expiry has passed, OR when there is no
    storage ref but the game was auto-exported (source deleted post-grace), OR
    (T8320) when the game HAS a blake3 hash but no game_storage row at all.

    T8320: a hash-backed game uses the global `games/{hash}.mp4` storage that
    delete_ref DELETES the game_storage row for at reclaim (auth_db.py). So "no
    row + has_hash" means the source was reclaimed (or its ref is otherwise
    unknown) -- report 'expired', the safe direction (matching T4280 below),
    instead of the old trailing default that presented a possibly-gone video as
    'active' unless auto_export_status happened to be set. Genuinely storage-less
    LEGACY games (video_filename-only, no blake3 hash) are NOT reclaimable this
    way, so `has_hash=False` keeps them 'active'. References carry no storage
    semantics (T5800) and are excluded by the caller before reaching here.

    T4280: an UNPARSEABLE expiry is treated as EXPIRED (the safe direction: it blocks
    share/re-export of a possibly-gone video, matching T3970), and logged -- not
    silently defaulted to 'active', which would present a possibly-gone video as fine.
    """
    if expires_at_val:
        try:
            exp_dt = expires_at_val if isinstance(expires_at_val, datetime) else datetime.fromisoformat(expires_at_val)
            return 'expired' if exp_dt.replace(tzinfo=None) < datetime.utcnow() else 'active'
        except (ValueError, TypeError) as e:
            logger.error(f"[games] Unparseable storage_expires_at {expires_at_val!r}: {e}. Treating as EXPIRED.")
            return 'expired'
    if auto_export_status:
        return 'expired'
    if has_hash:
        # No game_storage row for a hash-backed game = reclaimed/unknown source.
        return 'expired'
    return 'active'


def _is_game_storage_expired(cursor, blake3_hash: str | None) -> bool:
    """Return True if a game's storage has expired.

    Mirrors the is_expired computation in list_games (~L877-884): reads
    storage_expires_at from game_storage (per-profile SQLite) and compares to
    utcnow(). Used to gate sharing of expired games. Annotation/recap playback
    is intentionally NOT gated -- those endpoints stay open for expired games.
    """
    if not blake3_hash:
        return False
    row = cursor.execute(
        "SELECT storage_expires_at FROM game_storage WHERE blake3_hash = ?",
        (blake3_hash,),
    ).fetchone()
    if not row or not row["storage_expires_at"]:
        return False
    expires_at_val = row["storage_expires_at"]
    try:
        exp_dt = expires_at_val if isinstance(expires_at_val, datetime) else datetime.fromisoformat(expires_at_val)
        return exp_dt.replace(tzinfo=None) < datetime.utcnow()
    except (ValueError, TypeError) as e:
        # T4280: unparseable expiry -> treat as EXPIRED (safe: gate sharing of a
        # possibly-gone video), and log; never silently report "not expired".
        logger.error(f"[games] Unparseable storage_expires_at {expires_at_val!r} for {blake3_hash}: {e}. Treating as EXPIRED.")
        return True


class GameSourceExpired(HTTPException):
    """T8310: a clip's source game video has been reclaimed post-expiry.

    Raised by the clip playback/stream seams (and the Focus export entry) INSTEAD
    of presigning a deleted `games/{hash}.mp4` object. A presigned URL for a gone
    object still succeeds, so the browser <video> gets an R2 404 and reports
    MEDIA_ERR_SRC_NOT_SUPPORTED -- indistinguishable from a bad codec (bug 50p).
    Returning a structured 410 lets the reel editors render a deliberate expired
    panel (message + Extend affordance) instead of a "Video format not supported"
    banner + retry loop.

    Body: {"code": "source_expired", "game_id": ..., "can_extend": ...}.
    """

    def __init__(self, game_id: int | None, can_extend: bool):
        super().__init__(
            status_code=410,
            detail={
                "code": "source_expired",
                "game_id": game_id,
                "can_extend": can_extend,
            },
        )


def resolve_game_source_status(cursor, blake3_hash: str | None, auto_export_status) -> tuple[str, bool]:
    """T8310: (storage_status, can_extend) for a clip's source game.

    Single source of truth shared with list_games/load_game: reuses
    `_compute_storage_status` (with the T8320 `has_hash` fix so a reclaimed
    hash-backed game whose game_storage row was deleted at reclaim reports
    'expired', not 'active') and mirrors list_games' `can_extend` (the game still
    has a storage ref, or is inside the post-expiry grace window). Deliberately
    NOT a third fork of the expiry logic. References are excluded by the caller
    (they pass their own None); every game the clip seams resolve is real.
    """
    storage_row = None
    if blake3_hash:
        storage_row = cursor.execute(
            "SELECT storage_expires_at FROM game_storage WHERE blake3_hash = ?",
            (blake3_hash,),
        ).fetchone()
    expires_at_val = storage_row['storage_expires_at'] if storage_row else None
    status = _compute_storage_status(expires_at_val, auto_export_status, bool(blake3_hash))
    can_extend = False
    if status == 'expired' and blake3_hash:
        # Extendable while a ref survives or during the grace window; a fully
        # reclaimed source (row deleted at reclaim, past grace) is not.
        can_extend = storage_row is not None or blake3_hash in get_grace_deletion_hashes()
    return status, can_extend


def assert_clip_source_available(cursor, *, game_id: int | None, blake3_hash: str | None, auto_export_status) -> None:
    """T8310: raise GameSourceExpired if the clip's source game has been reclaimed.

    Shared gate for the clip playback-url seam, the /stream proxy, and the Focus
    export entry so all three agree and none presigns a dead object.
    """
    status, can_extend = resolve_game_source_status(cursor, blake3_hash, auto_export_status)
    if status == 'expired':
        raise GameSourceExpired(game_id, can_extend)


def _game_video_r2_key(blake3_hash: str | None, video_filename: str | None) -> str | None:
    """The fully-qualified R2 key the code resolves for a game source video.

    New storage is the env-prefix-FREE global scheme `games/{blake3}.mp4`; old
    (pre-T80) storage is env-prefixed per-user `{env}/users/{uid}/profiles/{pid}/
    games/{filename}`. Printing the REAL key (not a template) is the whole point
    of T6330 -- that asymmetry is why "where did the code look?" is non-obvious.
    """
    if blake3_hash:
        return f"games/{blake3_hash}.mp4"
    if video_filename:
        return r2_key(get_current_user_id(), f"games/{video_filename}")
    return None


def log_game_video_failure(
    cursor,
    *,
    game_id: int,
    blake3_hash: str | None,
    video_filename: str | None,
    kind: str,
    reason: str,
) -> None:
    """Log ONE triage line for a game-video/clip serving FAILURE (T6330).

    Does at most ONE failure-path HEAD (never on the success path) to record
    whether the object is actually where the code looked, then classifies:
    object present -> denied (a session/serve problem, NOT missing); absent +
    storage expired/swept -> expired; absent otherwise -> missing.
    """
    key = _game_video_r2_key(blake3_hash, video_filename)
    head_found: bool | None = None
    outcome = VideoServeOutcome.MISSING

    if R2_ENABLED and key is not None:
        if blake3_hash:
            head_found = r2_head_object_global(key) is not None
        else:
            head_found = file_exists_in_r2(get_current_user_id(), f"games/{video_filename}")
        if head_found:
            # The object IS where we looked -- so the request did not fail for
            # absence. Do not claim "missing" (that would resume the archaeology).
            outcome = VideoServeOutcome.DENIED
        elif _is_game_storage_expired(cursor, blake3_hash):
            outcome = VideoServeOutcome.EXPIRED

    log_video_resolution(
        logger,
        kind=kind,
        outcome=outcome,
        key=key,
        entity_id=game_id,
        user_id=get_current_user_id(),
        profile_id=get_current_profile_id(),
        blake3_hash=blake3_hash,
        head_found=head_found,
        reason=reason,
    )


class RecipientShare(BaseModel):
    """One share recipient + the clip scope they receive (T5740). scope defaults
    to ALL_TEAM so an omitted scope preserves the 'team clips by default' intent."""
    email: str
    scope: ShareClipScope = ShareClipScope.ALL_TEAM


class ShareGameRequest(BaseModel):
    # T5740: one honest wire shape -- each recipient carries its own clip scope.
    # (Replaces the pre-T5740 {emails: [...]} game-only shape; the ShareGameModal
    # is the only caller and moves to this in the same change.)
    recipients: list[RecipientShare]


@router.post("/{game_id:int}/share")
async def share_game(game_id: int, body: ShareGameRequest):
    """Share a game with recipients via email, each recipient receiving the clips
    for their per-recipient scope (T5740: all team clips / only clips they're tagged
    in / game only). My-Athlete clips never cross (EPIC 1/3)."""
    import asyncio

    from app.migrations import MigrationBlocked
    from app.services.auth_db import get_user_by_email, get_user_by_id
    from app.services.db_refresh import RefreshFailed
    from app.services.email import _is_existing_user, _resolve_sender_name, send_game_share_email
    from app.services.materialization import (
        RecipientProfileBelowHead,
        materialize_game_share,
        resolve_scoped_clips,
        serialize_clip_data,
    )
    from app.services.sharing_db import (
        create_game_share,
        create_pending_share,
        get_share_by_token,
        revoke_share,
    )
    from app.services.user_db import get_profiles

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    sharer = get_user_by_id(user_id)
    sharer_email = sharer["email"] if sharer else user_id
    sender_name = _resolve_sender_name(sharer_email)

    emails = [r.email for r in body.recipients]

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, blake3_hash FROM games WHERE id = ?", (game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        game_name = game["name"] or "Untitled Game"

        game_blake3 = game["blake3_hash"]
        if not game_blake3:
            cursor.execute(
                "SELECT blake3_hash FROM game_videos WHERE game_id = ? ORDER BY sequence LIMIT 1",
                (game_id,),
            )
            gv_row = cursor.fetchone()
            if gv_row:
                game_blake3 = gv_row["blake3_hash"]

        if _is_game_storage_expired(cursor, game_blake3):
            raise HTTPException(
                status_code=410,
                detail="Storage expired - extend storage to share this game.",
            )

        # Resolve each recipient's clips ONCE, up front, on the sharer's profile DB
        # (this same conn). resolve_scoped_clips is the shared source of truth with
        # the /share-preview read, so what a recipient is shown == what they receive.
        clip_data_by_email = {
            r.email: resolve_scoped_clips(conn, game_id, r.email, r.scope.value)
            for r in body.recipients
        }

    email_results = []
    all_sent = True

    share_records = []
    for email in emails:
        try:
            share = create_game_share(
                game_id=game_id,
                tag_name=None,
                sharer_user_id=user_id,
                sharer_profile_id=profile_id,
                recipient_email=email,
                game_name=game_name,
                game_blake3=game_blake3,
            )
            share_records.append(share)
        except Exception as e:
            logger.error(f"[share-game] Failed to create share record: {e}")
            share_records.append(None)

    if any(share_records):
        # T5270: warm the recap poster now (share-creation gesture) so the
        # crawler that pastes this link never pays the ffmpeg cost.
        from app.services.poster import warm_recap_poster
        await warm_recap_poster(user_id, profile_id, game_id)

    tasks = {}
    for email, share in zip(emails, share_records):
        is_first_touch = not _is_existing_user(email)
        tasks[email] = send_game_share_email(
            recipient_email=email,
            sharer_email=sharer_email,
            game_name=game_name,
            share_token=share["share_token"] if share else None,
            sender_name=sender_name,
            is_first_touch=is_first_touch,
        )

    if tasks:
        send_results = await asyncio.gather(*tasks.values())
        for (email, share), sent in zip(
            zip(emails, share_records), send_results
        ):
            email_results.append({"email": email, "sent": sent})
            if not sent:
                all_sent = False
                if share:
                    with contextlib.suppress(Exception):
                        revoke_share(share["share_token"], user_id)

    if all_sent and email_results:
        for email, share in zip(emails, share_records):
            if not share:
                continue
            # T5740: the clips this recipient's scope resolved to, up front. Both the
            # pending-share snapshot and the live materialize below use this so the
            # scope choice is honored on every delivery path.
            scoped_clips = clip_data_by_email.get(email, [])
            try:
                recipient_user = get_user_by_email(email)
                share_record = get_share_by_token(share["share_token"])
                if not share_record:
                    continue

                if not recipient_user:
                    create_pending_share(
                        share_id=share_record["id"],
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        invited_email=email,
                        game_id=game_id,
                        tag_name=None,
                        clip_data_bytes=serialize_clip_data(scoped_clips),
                    )
                    logger.info(f"[share-game] Created pending share for non-user {email}")
                    continue

                # T4315 round 3 (MAJOR NEW-D): get_profiles(recipient_user_id)
                # is a foreign-user get_user_db_connection call -- round 2's
                # structural guard (MAJOR-4) makes it a possible R2 HEAD, so
                # it needs the same asyncio.to_thread offload as
                # materialize_game_share below, not just that call alone.
                #
                # T4315 round 5 (BLOCKING-2): get_profiles used to sit
                # OUTSIDE this try. An R2 blip there raises RefreshFailed
                # (the PARENT of ProfileDBRefreshFailed, which the round-4
                # except did not catch) straight into the outer
                # `except Exception` below -- logged and silently dropped,
                # no pending-share row, permanently unrecoverable without
                # the sharer re-sharing. Both R2-touching calls
                # (get_profiles AND materialize_game_share) are now inside
                # ONE try/except RefreshFailed with the SAME
                # create_pending_share fallback either way -- correct even
                # when the profile count is unknown (T3230 / resolve-
                # pending-shares resolves it later).
                try:
                    profiles = await asyncio.to_thread(get_profiles, recipient_user["user_id"])
                    if len(profiles) == 1:
                        # T4315 round 2 (MAJOR-2): materialize_game_share
                        # does a real R2 HEAD (require_fresh) and possibly a
                        # full profile.sqlite download -- offload so a batch
                        # of teammate emails never blocks this worker's
                        # event loop.
                        await asyncio.to_thread(
                            materialize_game_share,
                            sharer_user_id=user_id,
                            sharer_profile_id=profile_id,
                            recipient_user_id=recipient_user["user_id"],
                            recipient_profile_id=profiles[0]["id"],
                            game_id=game_id,
                            # tag_name stays None: this is the game-share channel,
                            # not a teammate share. The scope is expressed by the
                            # explicit clip_data, not by re-querying a tag.
                            tag_name=None,
                            share_id=share_record["id"],
                            clip_data=scoped_clips,
                            sharer_email=sharer_email,
                        )
                        logger.info(f"[share-game] Materialized for {email}")
                    else:
                        create_pending_share(
                            share_id=share_record["id"],
                            sharer_user_id=user_id,
                            sharer_profile_id=profile_id,
                            invited_email=email,
                            game_id=game_id,
                            tag_name=None,
                            clip_data_bytes=serialize_clip_data(scoped_clips),
                        )
                        logger.info(f"[share-game] Created pending share for multi-profile user {email}")
                except (RefreshFailed, RecipientProfileBelowHead, MigrationBlocked):
                    # T5085: MigrationBlocked (get_profiles -> ensure_user_database,
                    # or materialize_game_share -> ensure_profile_db_local) is the
                    # SAME "can't materialize now, defer + retry after migration"
                    # class T6780 added RecipientProfileBelowHead here for -- must
                    # ride the same pending-share fallback, never the bare
                    # except Exception below (T4315 round 5's silently-dropped-
                    # share bug this whole try/except exists to prevent).
                    # T4315 round 4 (MINOR) + round 5 (BLOCKING-2): a
                    # refused freshness confirmation (get_profiles' foreign-
                    # user HEAD, or materialize_game_share's require_fresh /
                    # contended-checkpoint refusal) must not silently drop
                    # the share -- fall back to a pending-share row so login
                    # auto-materialize (T3230) or a manual resolve-pending-
                    # shares retries it.
                    # T6780: a below-head recipient profile DB (v026 shared_by
                    # absent, deploy->migrate window) is the same "can't
                    # materialize now, defer + retry after migration" case, so
                    # it rides the SAME pending-share fallback (NOT a 503 that
                    # would fail the whole multi-recipient share for one
                    # below-head recipient).
                    create_pending_share(
                        share_id=share_record["id"],
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        invited_email=email,
                        game_id=game_id,
                        tag_name=None,
                        clip_data_bytes=serialize_clip_data(scoped_clips),
                    )
                    logger.warning(
                        f"[share-game] Materialization refused for {email} "
                        f"(target DB unconfirmed) -- created pending share for retry"
                    )
            except Exception as e:
                logger.error(f"[share-game] Materialization failed for {email}: {e}")

    return {"results": email_results, "all_sent": all_sent}


class SharePreviewClip(BaseModel):
    id: int
    name: str | None = None
    rating: int | None = None
    start_time: float | None = None


class SharePreviewResponse(BaseModel):
    # Both scopes' clip lists for ONE recipient email, so the modal can switch the
    # per-row dropdown without a refetch. game_only is trivially empty client-side.
    all_team: list[SharePreviewClip]
    tagged: list[SharePreviewClip]
    # False -> the email has no teammate_emails mapping, so 'Only clips they're
    # tagged in' yields zero clips (the untagged state the modal warns about).
    tagged_has_mapping: bool


def _preview_clip(clip: dict) -> SharePreviewClip:
    return SharePreviewClip(
        id=clip["id"],
        name=clip.get("name"),
        rating=clip.get("rating"),
        start_time=clip.get("start_time"),
    )


@router.get("/{game_id:int}/share-preview", response_model=SharePreviewResponse)
async def share_preview(game_id: int, email: str = Query(...)):
    """Plain read (T5740): the clips a recipient would receive per scope, so the
    share modal can show the count/list BEFORE sending. Uses the SAME
    resolve_scoped_clips the send path uses -> the preview can never lie about what
    the share materializes. No writes, never on an analytics path."""
    from app.services.materialization import (
        _tag_names_for_email,
        resolve_scoped_clips,
    )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

        all_team = resolve_scoped_clips(conn, game_id, email, ShareClipScope.ALL_TEAM.value)
        tagged = resolve_scoped_clips(conn, game_id, email, ShareClipScope.TAGGED_ONLY.value)
        has_mapping = bool(_tag_names_for_email(conn, email))

    return SharePreviewResponse(
        all_team=[_preview_clip(c) for c in all_team],
        tagged=[_preview_clip(c) for c in tagged],
        tagged_has_mapping=has_mapping,
    )


# ---------------------------------------------------------------------------
# Public game link (T5720) -- broadcast "here's the game" link into the team
# chat. Anonymous visitors watch the TEAM RECAP ONLY (EPIC decision 3); the
# public resolve/poster/viewed endpoints live in routers/shares.py. Here are the
# authed sharer-only create + revoke gestures.
# ---------------------------------------------------------------------------

class CreateGameLinkResponse(BaseModel):
    share_token: str
    # Relative watch path -- the frontend absolutizes against the APP origin
    # (the API host differs from the app host, so the server can't build it).
    path: str
    already_existed: bool


def _build_team_clip_rail(user_id: str, game_id: int, mapping_key: str) -> list[dict]:
    """Frozen TEAM-layer clip rail snapshot for a public game link (T5720).

    Built from the stamped team recap mapping (names + recap-relative offsets),
    enriched with each clip's player tags from live raw_clips. Only team-layer,
    PUBLIC-SAFE fields -- no source offsets into the full game, no filenames, no
    athlete-layer data. Snapshotted at creation so the public resolve endpoint
    never opens the sharer's per-profile SQLite (no N+1 on a public path)."""
    from app.services.auto_export import load_recap_mapping

    _layer, clips = load_recap_mapping(user_id, mapping_key)
    if not clips:
        return []
    ids = [c.get("id") for c in clips if c.get("id") is not None]
    tags_by_id: dict = {}
    if ids:
        with get_db_connection() as conn:
            placeholders = ",".join("?" * len(ids))
            rows = conn.execute(
                f"SELECT id, tagged_teammates FROM raw_clips WHERE id IN ({placeholders})",
                ids,
            ).fetchall()
        tags_by_id = {r["id"]: (decode_data(r["tagged_teammates"]) or []) for r in rows}
    return [
        {
            "name": c.get("name") or "Clip",
            "recap_start": c.get("recap_start"),
            "recap_end": c.get("recap_end"),
            "player_tags": tags_by_id.get(c.get("id"), []),
        }
        for c in clips
    ]


@router.post("/{game_id:int}/share-link", response_model=CreateGameLinkResponse)
async def create_game_link(game_id: int, background_tasks: BackgroundTasks):
    """Create (idempotently) a public game link (T5720).

    Stitch-on-share: on a FIRST create, ensures the TEAM recap exists + warms its
    poster BEFORE returning the link (T5270 precedent -- the link can't be pasted
    before this returns). A zero-team-clip game is refused with an actionable 409,
    never an empty share. Idempotent per game+sharer: a repeat 'Copy link' returns
    the SAME active token WITHOUT re-stitching (the recap already exists; the
    on-demand poster endpoint self-heals an evicted poster)."""
    from app.constants import RecapLayer
    from app.services.auth_db import get_user_by_id
    from app.services.auto_export import ensure_recap
    from app.services.poster import warm_recap_poster
    from app.services.sharing_db import (
        create_game_share,
        get_active_game_link_share,
    )

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, opponent_name, game_date, blake3_hash FROM games WHERE id = ?",
            (game_id,),
        )
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        game_blake3 = game["blake3_hash"]
        if not game_blake3:
            cursor.execute(
                "SELECT blake3_hash FROM game_videos WHERE game_id = ? ORDER BY sequence LIMIT 1",
                (game_id,),
            )
            gv_row = cursor.fetchone()
            if gv_row:
                game_blake3 = gv_row["blake3_hash"]

    # Idempotent per game+sharer: a repeat gesture returns the existing active
    # link with no re-stitch/re-warm (the recap already exists from first create).
    existing = get_active_game_link_share(game_id, user_id)
    if existing:
        return CreateGameLinkResponse(
            share_token=existing["share_token"],
            path=f"/shared/game/{existing['share_token']}",
            already_existed=True,
        )

    # Stitch-on-share: the TEAM recap must exist before the link is live.
    # status == 'empty' is T5710's zero-team-clips signal -> actionable refusal,
    # NO share row created (explicit state, never an empty share).
    result = ensure_recap(user_id, profile_id, game_id, RecapLayer.TEAM.value)
    if result["status"] == "empty":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "empty_team_layer",
                "message": "Tag some team plays first",
            },
        )

    # Warm the TEAM poster now so the first crawler never pays the ffmpeg cost.
    await warm_recap_poster(user_id, profile_id, game_id, layer=RecapLayer.TEAM.value)

    sharer = get_user_by_id(user_id)
    # Public link has no recipient -> store the sharer's own email (the
    # self-share convention; recipient_email is NOT NULL).
    recipient_email = sharer["email"] if sharer else user_id
    rail = _build_team_clip_rail(user_id, game_id, result["mapping_key"])

    share = create_game_share(
        game_id=game_id,
        tag_name=None,
        sharer_user_id=user_id,
        sharer_profile_id=profile_id,
        recipient_email=recipient_email,
        game_name=game["name"] or "Shared Game",
        game_blake3=game_blake3,
        clip_names=rail,
        share_type="game_link",
        game_date=game["game_date"],
    )
    # Analytics OFF the response path (T4840): the Copy Link toast waits on this
    # response, and the milestone is a Postgres write it never needed.
    background_tasks.add_task(
        record_milestone,
        user_id, "share_completed", {"game_id": game_id, "share_type": "game_link"},
    )
    return CreateGameLinkResponse(
        share_token=share["share_token"],
        path=f"/shared/game/{share['share_token']}",
        already_existed=False,
    )


@router.delete("/{game_id:int}/share-link")
async def revoke_game_link(game_id: int):
    """Revoke the active public game link for a game (T5720). Game-scoped: the
    game card holds game.id, not the token, and there is at most one active link
    per game. Sets revoked_at -> the resolve endpoint returns 410 -> edge falls
    through -> SPA shows a clean inactive state. 404 if no active link."""
    from app.services.sharing_db import revoke_game_link_share

    user_id = get_current_user_id()
    if not revoke_game_link_share(game_id, user_id):
        raise HTTPException(status_code=404, detail="No active link for this game")
    return {"ok": True}


class SharePlaybackRequest(BaseModel):
    emails: list[str]


@router.post("/{game_id:int}/share-playback")
async def share_playback(game_id: int, body: SharePlaybackRequest):
    """Share all annotated clips for a game with recipients via email."""
    import asyncio

    from app.migrations import MigrationBlocked
    from app.services.auth_db import get_user_by_email, get_user_by_id
    from app.services.db_refresh import RefreshFailed
    from app.services.email import _is_existing_user, _resolve_sender_name, send_playback_share_email
    from app.services.materialization import (
        RecipientProfileBelowHead,
        materialize_game_share,
        serialize_clip_data,
    )
    from app.services.sharing_db import (
        create_game_share,
        create_pending_share,
        get_share_by_token,
        list_shares_for_game,
        revoke_share,
    )
    from app.services.user_db import get_profiles

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    sharer = get_user_by_id(user_id)
    sharer_email = sharer["email"] if sharer else user_id
    sender_name = _resolve_sender_name(sharer_email)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, blake3_hash FROM games WHERE id = ?", (game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        game_name = game["name"] or "Untitled Game"

        game_blake3 = game["blake3_hash"]
        if not game_blake3:
            cursor.execute(
                "SELECT blake3_hash FROM game_videos WHERE game_id = ? ORDER BY sequence LIMIT 1",
                (game_id,),
            )
            gv_row = cursor.fetchone()
            if gv_row:
                game_blake3 = gv_row["blake3_hash"]

        if _is_game_storage_expired(cursor, game_blake3):
            raise HTTPException(
                status_code=410,
                detail="Storage expired - extend storage to share this game.",
            )

        cursor.execute(
            """SELECT id, rating, tags, name, notes, start_time, end_time, video_sequence
               FROM raw_clips WHERE game_id = ?""",
            (game_id,),
        )
        clips = [dict(row) for row in cursor.fetchall()]
        clip_names = [c["name"] for c in clips if c.get("name")]
        first_clip_start = clips[0]["start_time"] if clips else None

    existing_shares = list_shares_for_game(game_id, user_id)

    email_results = []
    all_sent = True
    share_records = []

    for email in body.emails:
        duplicate = next(
            (s for s in existing_shares
             if s["recipient_email"] == email.lower().strip()
             and s["share_type"] == "annotation_playback"
             and not s.get("revoked_at")),
            None,
        )
        if duplicate:
            share_records.append({
                "share_token": duplicate["share_token"],
                "recipient_email": email,
                "duplicate": True,
            })
            continue

        try:
            share = create_game_share(
                game_id=game_id,
                tag_name="",
                sharer_user_id=user_id,
                sharer_profile_id=profile_id,
                recipient_email=email,
                game_name=game_name,
                game_blake3=game_blake3,
                first_clip_start=first_clip_start,
                clip_names=clip_names,
                share_type="annotation_playback",
            )
            share_records.append(share)
        except Exception as e:
            logger.error(f"[share-playback] Failed to create share record: {e}")
            share_records.append(None)

    if any(share_records):
        # T5270: warm the recap poster now (share-creation gesture) so the
        # crawler that pastes this link never pays the ffmpeg cost.
        from app.services.poster import warm_recap_poster
        await warm_recap_poster(user_id, profile_id, game_id)

    if not os.getenv("RESEND_API_KEY"):
        from app.services.email import _get_share_url
        for email, share in zip(body.emails, share_records):
            if share:
                url = _get_share_url(share["share_token"], "game")
                logger.warning(f"[share-playback] DEV MODE -- {email}: {url}")

    tasks = {}
    for email, share in zip(body.emails, share_records):
        if email in [r["email"] for r in email_results]:
            continue
        if share and share.get("duplicate"):
            # Recipient already has an active share for this game; don't resend email.
            continue
        is_first_touch = not _is_existing_user(email)
        tasks[email] = send_playback_share_email(
            recipient_email=email,
            sharer_email=sharer_email,
            game_name=game_name,
            share_token=share["share_token"] if share else None,
            sender_name=sender_name,
            is_first_touch=is_first_touch,
        )

    if tasks:
        send_results = await asyncio.gather(*tasks.values())
        for (email, share), sent in zip(
            [(e, s) for e, s in zip(body.emails, share_records) if e not in [r["email"] for r in email_results]],
            send_results,
        ):
            email_results.append({"email": email, "sent": sent})
            if not sent:
                all_sent = False
                if share:
                    with contextlib.suppress(Exception):
                        revoke_share(share["share_token"], user_id)

    if all_sent and email_results:
        clip_data_bytes = serialize_clip_data(clips)
        for email, share in zip(body.emails, share_records):
            if not share:
                continue
            try:
                recipient_user = get_user_by_email(email)
                share_record = get_share_by_token(share["share_token"])
                if not share_record:
                    continue

                if not recipient_user:
                    create_pending_share(
                        share_id=share_record["id"],
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        invited_email=email,
                        game_id=game_id,
                        tag_name="",
                        clip_data_bytes=clip_data_bytes,
                    )
                    logger.info(f"[share-playback] Created pending share for non-user {email}")
                    continue

                # T4315 round 3 (MAJOR NEW-D): get_profiles(recipient_user_id)
                # is a foreign-user get_user_db_connection call -- round 2's
                # structural guard (MAJOR-4) makes it a possible R2 HEAD, so
                # it needs the same asyncio.to_thread offload as
                # materialize_game_share below, not just that call alone.
                #
                # T4315 round 5 (BLOCKING-2): see share_game above -- both
                # R2-touching calls now share ONE try/except RefreshFailed
                # (the parent of ProfileDBRefreshFailed) with the SAME
                # create_pending_share fallback either way.
                try:
                    profiles = await asyncio.to_thread(get_profiles, recipient_user["user_id"])
                    if len(profiles) == 1:
                        # T4315 round 2 (MAJOR-2): see share_game above.
                        await asyncio.to_thread(
                            materialize_game_share,
                            sharer_user_id=user_id,
                            sharer_profile_id=profile_id,
                            recipient_user_id=recipient_user["user_id"],
                            recipient_profile_id=profiles[0]["id"],
                            game_id=game_id,
                            tag_name="",
                            share_id=share_record["id"],
                            clip_data=clips,
                            sharer_email=sharer_email,
                        )
                        logger.info(f"[share-playback] Materialized for {email}")
                    else:
                        create_pending_share(
                            share_id=share_record["id"],
                            sharer_user_id=user_id,
                            sharer_profile_id=profile_id,
                            invited_email=email,
                            game_id=game_id,
                            tag_name="",
                            clip_data_bytes=clip_data_bytes,
                        )
                        logger.info(f"[share-playback] Created pending share for multi-profile user {email}")
                except (RefreshFailed, RecipientProfileBelowHead, MigrationBlocked):
                    # T5085: MigrationBlocked (get_profiles -> ensure_user_database,
                    # or materialize_game_share -> ensure_profile_db_local) is the
                    # SAME "can't materialize now, defer + retry after migration"
                    # class T6780 added RecipientProfileBelowHead here for -- must
                    # ride the same pending-share fallback, never the bare
                    # except Exception below (T4315 round 5's silently-dropped-
                    # share bug this whole try/except exists to prevent).
                    # T4315 round 4 (MINOR) + round 5 (BLOCKING-2): see
                    # share_game above -- a refused freshness confirmation
                    # (get_profiles or materialize_game_share) must not
                    # silently drop the share.
                    # T6780: a below-head recipient (v026 shared_by absent)
                    # rides the SAME defer-to-pending fallback (see share_game).
                    create_pending_share(
                        share_id=share_record["id"],
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        invited_email=email,
                        game_id=game_id,
                        tag_name="",
                        clip_data_bytes=clip_data_bytes,
                    )
                    logger.warning(
                        f"[share-playback] Materialization refused for {email} "
                        f"(target DB unconfirmed) -- created pending share for retry"
                    )
            except Exception as e:
                logger.error(f"[share-playback] Materialization failed for {email}: {e}")

    return {"results": email_results, "all_sent": all_sent}


@router.get("/{game_id:int}/playback-url")
async def get_game_playback_url(game_id: int):
    """Return presigned R2 URL for direct browser playback."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                COALESCE(gv.blake3_hash, g.blake3_hash) AS blake3_hash,
                g.video_filename,
                COALESCE(gv.video_size, g.video_size) AS video_size
            FROM games g
            LEFT JOIN game_videos gv
                ON gv.game_id = g.id AND gv.sequence = 1
            WHERE g.id = ?
        """, (game_id,))
        row = cursor.fetchone()

    if not row:
        log_video_resolution(
            logger, kind="game_video", outcome=VideoServeOutcome.MISSING, key=None,
            entity_id=game_id, user_id=get_current_user_id(),
            profile_id=get_current_profile_id(), reason="game_row_not_found",
        )
        raise HTTPException(404, "Game not found")
    if not row['blake3_hash']:
        log_video_resolution(
            logger, kind="game_video", outcome=VideoServeOutcome.MISSING, key=None,
            entity_id=game_id, user_id=get_current_user_id(),
            profile_id=get_current_profile_id(), reason="no_blake3_hash",
        )
        raise HTTPException(422, "Game video missing blake3 hash")

    url = get_game_video_url(row['blake3_hash'], row['video_filename'])
    if not url:
        with get_db_connection() as _conn:
            log_game_video_failure(
                _conn.cursor(), game_id=game_id, blake3_hash=row['blake3_hash'],
                video_filename=row['video_filename'], kind="game_video",
                reason="presign_unavailable",
            )
        raise HTTPException(502, "Failed to generate R2 URL")

    return {
        "url": url,
        "expires_in": 14400,
        "file_size": row['video_size'],
    }


@router.get("/{game_id:int}/load")
async def load_game(game_id: int):
    """Single endpoint returning everything needed to render the annotate screen.

    Combines: get_game + playback-url + teammate-tags + teammate-shares
    into one request to eliminate sequential fetch waterfall and thread pool contention.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Game data (same as get_game)
        cursor.execute("""
            SELECT id, name, blake3_hash, video_filename, created_at,
                   video_duration, video_width, video_height, video_size,
                   opponent_name, game_date, game_type, tournament_name,
                   viewed_duration, last_playhead_position, status, auto_export_status
            FROM games
            WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Storage status so Annotate can degrade gracefully when the source video
        # has expired (bug 27p): the R2 source is gone post-grace, so the player
        # must show a deliberate expired state instead of a broken/hanging <video>.
        # Same lookup + semantics as list_games (per-profile game_storage by hash).
        storage_row = cursor.execute(
            "SELECT storage_expires_at FROM game_storage WHERE blake3_hash = ?",
            (row['blake3_hash'],),
        ).fetchone()
        storage_status = _compute_storage_status(
            storage_row['storage_expires_at'] if storage_row else None,
            row['auto_export_status'],
            bool(row['blake3_hash']),
        )

        cursor.execute_local(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )

        annotations = load_annotations_from_db(game_id)

        display_name = generate_game_display_name(
            row['opponent_name'],
            row['game_date'],
            row['game_type'],
            row['tournament_name'],
            row['name']
        )

        videos = _get_game_videos_response(cursor, game_id)

        if videos:
            video_url = videos[0]['video_url'] if videos else None
            total_duration = sum(v['duration'] for v in videos if v['duration'])
            video_width = videos[0].get('video_width') or row['video_width']
            video_height = videos[0].get('video_height') or row['video_height']
        else:
            video_url = get_game_video_url(row['blake3_hash'], row['video_filename'])
            total_duration = row['video_duration']
            video_width = row['video_width']
            video_height = row['video_height']

        game = {
            'id': row['id'],
            'name': display_name,
            'raw_name': row['name'],
            'blake3_hash': row['blake3_hash'],
            'video_url': video_url,
            'videos': videos,
            'annotations': annotations,
            'clip_count': len(annotations),
            'created_at': row['created_at'],
            'viewed_duration': row['viewed_duration'] or 0,
            'last_playhead_position': row['last_playhead_position'],
            'video_duration': total_duration,
            'video_width': video_width,
            'video_height': video_height,
            'video_size': row['video_size'],
            'storage_status': storage_status,
        }

        # 2. Playback URL (same as get_game_playback_url)
        cursor.execute("""
            SELECT
                COALESCE(gv.blake3_hash, g.blake3_hash) AS blake3_hash,
                g.video_filename,
                COALESCE(gv.video_size, g.video_size) AS video_size
            FROM games g
            LEFT JOIN game_videos gv
                ON gv.game_id = g.id AND gv.sequence = 1
            WHERE g.id = ?
        """, (game_id,))
        pb_row = cursor.fetchone()

        playback_url = None
        if pb_row and pb_row['blake3_hash']:
            playback_url = get_game_video_url(pb_row['blake3_hash'], pb_row['video_filename'])

        # 3. Teammate tags (same as clips.get_teammate_tags)
        cursor.execute("""
            SELECT tag_name, COUNT(*) as cnt
            FROM clip_teammates
            GROUP BY tag_name
            ORDER BY cnt DESC
        """)
        teammate_tags = [r["tag_name"] for r in cursor.fetchall()]

        # 4. Teammate shares (same as clips.get_teammate_shares)
        cursor.execute(
            "SELECT tag_name, shared_clip_ids, created_at FROM teammate_shares WHERE game_id = ? ORDER BY created_at",
            (game_id,)
        )
        teammate_shares = [
            {
                "tag_name": r["tag_name"],
                "shared_clip_ids": json.loads(r["shared_clip_ids"]),
                "shared_at": r["created_at"],
            }
            for r in cursor.fetchall()
        ]

        conn.commit()

    return {
        "game": game,
        "playback_url": {
            "url": playback_url,
            "expires_in": 14400,
            "file_size": pb_row['video_size'] if pb_row else None,
        } if playback_url else None,
        "teammate_tags": teammate_tags,
        "teammate_shares": teammate_shares,
    }


@router.get("/{game_id:int}/stream")
async def stream_game_bounded(
    game_id: int,
    request: Request,
    t: float | None = None,
):
    """
    Bounded streaming proxy for annotation playback. Serves byte ranges
    covering the moov atom + annotated clip regions instead of the full
    game video. Same three-window strategy as T1430's clip proxy.

    If no clips exist for this game, all ranges are allowed (full video).
    """
    MOOV_WINDOW_END = 10 * 1024 * 1024 - 1
    MOOV_TAIL_SIZE = 10 * 1024 * 1024
    PRE_PAD_SECONDS = 2.0
    POST_PAD_SECONDS = 5.0
    MIN_PAD_BYTES = 5 * 1024 * 1024
    GAP_OVERRUN_EXTRA = 20 * 1024 * 1024
    import httpx
    from fastapi.responses import StreamingResponse

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                COALESCE(gv.blake3_hash, g.blake3_hash) AS blake3_hash,
                g.video_filename,
                COALESCE(gv.duration, g.video_duration) AS video_duration,
                COALESCE(gv.video_size, g.video_size) AS video_size
            FROM games g
            LEFT JOIN game_videos gv
                ON gv.game_id = g.id AND gv.sequence = 1
            WHERE g.id = ?
        """, (game_id,))
        game_row = cursor.fetchone()

        if not game_row:
            raise HTTPException(404, "Game not found")
        if not game_row['video_duration'] or not game_row['video_size']:
            raise HTTPException(422, "Game video missing duration/size metadata")
        if not game_row['blake3_hash']:
            raise HTTPException(422, "Game video missing blake3 hash")

        blake3_hash = game_row['blake3_hash']
        video_filename = game_row['video_filename']
        duration = game_row['video_duration']
        size = game_row['video_size']

        cursor.execute(
            "SELECT start_time, end_time FROM raw_clips WHERE game_id = ? ORDER BY start_time",
            (game_id,),
        )
        clips = cursor.fetchall()

    moov_end = min(size - 1, MOOV_WINDOW_END)
    moov_tail_start = max(0, size - MOOV_TAIL_SIZE)

    if not clips:
        clip_windows = [(0, size - 1)]
    else:
        raw_windows = []
        for clip in clips:
            start_byte_raw = int((clip['start_time'] / duration) * size)
            end_byte_raw = int((clip['end_time'] / duration) * size)
            pre_pad = max(int((PRE_PAD_SECONDS / duration) * size), MIN_PAD_BYTES)
            post_pad = max(int((POST_PAD_SECONDS / duration) * size), MIN_PAD_BYTES)
            raw_windows.append((
                max(0, start_byte_raw - pre_pad),
                min(size - 1, end_byte_raw + post_pad),
            ))
        raw_windows.sort()
        clip_windows = [raw_windows[0]]
        for start, end in raw_windows[1:]:
            prev_start, prev_end = clip_windows[-1]
            if start <= prev_end + 1:
                clip_windows[-1] = (prev_start, max(prev_end, end))
            else:
                clip_windows.append((start, end))

    presigned_url = get_game_video_url(blake3_hash, video_filename)
    if not presigned_url:
        raise HTTPException(404, "Failed to generate R2 URL")

    # No upfront R2 probe -- it added ~1.5s of latency per seek
    # (separate TCP/TLS handshake). Errors are caught in stream_from_r2().

    range_hdr = request.headers.get("range") or request.headers.get("Range")
    req_start = 0
    req_end = size - 1
    if range_hdr and range_hdr.startswith("bytes="):
        spec = range_hdr[len("bytes="):].strip()
        if "-" in spec:
            lo_s, hi_s = spec.split("-", 1)
            try:
                if lo_s:
                    req_start = int(lo_s)
                if hi_s:
                    req_end = int(hi_s)
            except ValueError:
                raise HTTPException(416, "Malformed Range header") from None

    window_kind = None
    window_end = None

    if req_start <= moov_end:
        window_end = moov_end
        window_kind = "moov"
    else:
        for win_start, win_end_val in clip_windows:
            if win_start <= req_start <= win_end_val:
                window_end = win_end_val
                window_kind = "clip"
                break

        if window_kind is None and req_start >= moov_tail_start:
            window_end = size - 1
            window_kind = "moov_tail"

        if window_kind is None:
            for _, win_end_val in clip_windows:
                if win_end_val < req_start <= win_end_val + GAP_OVERRUN_EXTRA:
                    window_end = min(
                        win_end_val + GAP_OVERRUN_EXTRA,
                        moov_tail_start - 1 if moov_tail_start > 0 else size - 1,
                    )
                    window_kind = "clip_overrun"
                    logger.info(
                        f"[game-stream] overrun game_id={game_id} req={req_start}-{req_end} "
                        f"clip_win_end={win_end_val} overrun_end={window_end}"
                    )
                    break

    if window_kind is None:
        # Window must be large enough for smooth playback (~2 min of
        # video) but not so large that seeks become sluggish (browser
        # has to cancel a huge in-flight download on each seek).
        MIN_SEEK = 20 * 1024 * 1024   # 20 MB floor
        MAX_SEEK = 100 * 1024 * 1024  # 100 MB cap
        two_min_bytes = int((120.0 / max(duration, 1)) * size)
        seek_size = max(MIN_SEEK, min(two_min_bytes, MAX_SEEK))
        window_end = min(req_start + seek_size, size - 1)
        window_kind = "seek"

    req_end = min(req_end, window_end)
    if req_start > req_end:
        raise HTTPException(
            status_code=416,
            detail="Invalid range",
            headers={"Content-Range": f"bytes */{size}"},
        )

    segment_len = req_end - req_start + 1
    logger.info(
        f"[game-stream] game_id={game_id} window={window_kind} "
        f"range={req_start}-{req_end} segment_len={segment_len}"
    )

    async def stream_from_r2():
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client, client.stream(
            "GET",
            presigned_url,
            headers={"Range": f"bytes={req_start}-{req_end}"},
        ) as response:
            if response.status_code not in (200, 206):
                error_body = ""
                try:
                    raw = await response.aread()
                    error_body = raw[:500].decode("utf-8", errors="replace")
                except Exception:
                    error_body = "(unreadable)"
                logger.error(
                    f"[game-stream] R2 error game_id={game_id} "
                    f"r2_status={response.status_code} blake3={blake3_hash} "
                    f"range={req_start}-{req_end} window={window_kind} "
                    f"body_snippet={error_body!r}"
                )
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"R2 returned {response.status_code}",
                )
            bytes_streamed = 0
            try:
                async for chunk in response.aiter_bytes(chunk_size=4 * 1024 * 1024):
                    bytes_streamed += len(chunk)
                    yield chunk
            except Exception as e:
                logger.error(
                    f"[game-stream] R2 stream interrupted game_id={game_id} "
                    f"window={window_kind} range={req_start}-{req_end} "
                    f"bytes_streamed={bytes_streamed}/{segment_len} "
                    f"error={type(e).__name__}: {e}"
                )

    return StreamingResponse(
        stream_from_r2(),
        status_code=206,
        media_type="video/mp4",
        headers={
            "Content-Range": f"bytes {req_start}-{req_end}/{size}",
            "Content-Length": str(segment_len),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=300, immutable",
        },
    )


@router.get("/{game_id:int}/poster.jpg")
async def get_game_poster(
    game_id: int, request: Request, profile_id: str | None = None
):
    """Poster thumbnail for a game's recap video (T5681).

    Cache-first from R2 (`recaps/posters/{game_id}.card.jpg`, a SEPARATE
    card-size key from the full-size og:image poster shares.py reads); generated
    on first request from the game's recap video via ensure_recap_poster().
    Session-authed by the same middleware as every other `/api/games` route.

    404 when the game has no recap OR the recap video is expired/missing --
    the frontend renders its no-poster fallback tile; we never fabricate an image
    (no-silent-fallback rule, CLAUDE.md). Poster generation is best-effort and
    never fails a parent operation. T5682: 404s are cached (private, 60s);
    `If-None-Match` is honored -> 304 without a full R2 GET.
    """
    from fastapi.responses import Response

    # T7940: profile_id is a per-owner cache-correctness token on the URL, not an
    # authorization mechanism -- the real scoping is the session's X-Profile-ID
    # contextvar driving the profile-scoped DB read below. When the URL carries a
    # profile_id that does NOT match the caller's session profile, refuse BEFORE
    # any DB read or R2 call so a URL-keyed cache can never serve one account's
    # poster bytes for another account's identical-looking request. Absent param =
    # no check possible (defense-in-depth token, not the primary guard).
    if profile_id is not None and profile_id != get_current_profile_id():
        raise HTTPException(status_code=403, detail="Profile mismatch")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, recap_video_url FROM games WHERE id = ?",
            (game_id,),
        )
        row = cursor.fetchone()

    if not row:
        # T5682: negative cache on 404s (60s)
        return Response(
            status_code=404,
            headers={"Cache-Control": "private, max-age=60"},
            media_type="image/jpeg",
        )

    from app.services.poster import (
        ensure_game_source_poster,
        ensure_recap_poster,
        recap_card_poster_r2_key,
    )
    from app.storage import APP_ENV, r2_head_object_global, video_outcome_for_status

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    # Full (env-prefixed) R2 keys. T5682: this owner-facing tile uses a SEPARATE
    # card-size (480px) key from the full-size og:image poster
    # (_recap_poster_r2_key in shares.py / recap_poster_r2_keys) -- that object is
    # shared with the teammate share unfurl and must stay full-size untouched.
    # BOTH producers below (recap-derived and source-frame) write this ONE card
    # key, so the serving path is identical regardless of which produced it.
    card_poster_key = recap_card_poster_r2_key(user_id, profile_id, game_id)

    # T5682: card_poster_key is DETERMINISTIC (no I/O to build) -- check
    # If-None-Match FIRST with a SINGLE HEAD, before the generators' own
    # cache-check HEAD runs against the same key (stacking two HEADs pushed
    # 304s to ~300ms).
    if_none_match = request.headers.get("if-none-match")
    if if_none_match:
        head = r2_head_object_global(card_poster_key)
        if head and head.get("ETag") == if_none_match:
            return Response(status_code=304, headers={
                "Cache-Control": "private, max-age=86400",
                "ETag": head["ETag"],
            })

    if row["recap_video_url"]:
        # Recap-derived poster wins whenever a recap exists (T5681 item 3).
        # ensure_recap_poster operates on GLOBAL (env-prefixed) keys, same scheme
        # as the share-unfurl path (_recap_r2_key/_recap_poster_r2_key in
        # shares.py): {env}/users/{uid}/profiles/{pid}/...
        recap_key = f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/recaps/{game_id}.mp4"
        # Ensure card-size poster exists (generate on first request if recap exists).
        if not ensure_recap_poster(recap_key, card_poster_key, resize_width=480, jpeg_quality=3):
            log_video_resolution(
                logger, kind="game_poster", outcome=VideoServeOutcome.MISSING,
                key=card_poster_key, entity_id=game_id, user_id=user_id,
                profile_id=profile_id, reason="recap_poster_unavailable",
            )
            # T5682: negative cache on 404s (60s)
            return Response(
                status_code=404,
                headers={"Cache-Control": "private, max-age=60"},
                media_type="image/jpeg",
            )
    else:
        # No recap yet: extract ONE frame from the live game source (T5681 item
        # 2/3) -- highest-rated clip's timestamp, else a fixed offset. Written at
        # card size (T5682) to the SAME card key so the serving path below is
        # identical. An expired/reclaimed source (no live video) -> False -> 404.
        if not ensure_game_source_poster(user_id, profile_id, game_id):
            log_video_resolution(
                logger, kind="game_poster", outcome=VideoServeOutcome.MISSING,
                key=card_poster_key, entity_id=game_id, user_id=user_id,
                profile_id=profile_id, reason="source_poster_unavailable",
            )
            # T5682: negative cache on 404s (60s)
            return Response(
                status_code=404,
                headers={"Cache-Control": "private, max-age=60"},
                media_type="image/jpeg",
            )

    # Serve the poster with a presigned URL (private cache, session-authed).
    # generate_presigned_url's relative_path is relative to users/{uid}/ and
    # ALREADY inserts /profiles/{current_profile_id}/ internally (r2_key()) --
    # passing a profiles/-prefixed path here would double it.
    url = generate_presigned_url(
        user_id, f"recaps/posters/{game_id}.card.jpg",
        expires_in=3600, content_type="image/jpeg"
    )
    if not url:
        # T5682: negative cache on 404s (60s)
        return Response(
            status_code=404,
            headers={"Cache-Control": "private, max-age=60"},
            media_type="image/jpeg",
        )

    # T5682: shared pooled client -- a fresh AsyncClient() per request paid a
    # full TLS handshake to R2 every time (~300-600ms observed), the T4773
    # landmine repeated here.
    from app.storage import get_poster_r2_client
    resp = await get_poster_r2_client().get(url)
    if resp.status_code != 200:
        log_video_resolution(
            logger, kind="game_poster",
            outcome=video_outcome_for_status(resp.status_code),
            key=card_poster_key, entity_id=game_id, user_id=user_id,
            profile_id=profile_id, reason=f"r2_status_{resp.status_code}",
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
