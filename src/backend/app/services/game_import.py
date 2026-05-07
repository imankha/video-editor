"""
Unified game import orchestrator.

Handles the full import pipeline: detect platform, resolve video info,
check/deduct credits, download/upload to R2, create game record.
Runs as a background task with progress tracking.
"""

import asyncio
import logging
import tempfile
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

from app.services.veo_import import (
    resolve_veo_download_url,
    stream_to_r2 as veo_stream_to_r2,
    VeoImportError,
    VEO_URL_PATTERN,
)
from app.services.trace_import import (
    resolve_trace_videos,
    resolve_best_variant,
    remux_hls_to_mp4,
    upload_file_to_r2,
    TraceImportError,
    TRACE_URL_PATTERN,
)
from app.storage import (
    get_r2_client,
    r2_global_key,
    r2_head_object_global,
    r2_delete_object_global,
    R2_BUCKET,
)

logger = logging.getLogger(__name__)


class ImportStatus(str, Enum):
    RESOLVING = "resolving"
    CHECKING_CREDITS = "checking_credits"
    DOWNLOADING = "downloading"
    UPLOADING = "uploading"
    CREATING_GAME = "creating_game"
    COMPLETE = "complete"
    ERROR = "error"


class Platform(str, Enum):
    VEO = "veo"
    TRACE = "trace"


# In-memory progress store, keyed by import_id
_imports: dict[str, dict] = {}

# Per-user concurrency lock (user_id -> import_id)
_user_locks: dict[str, str] = {}


def detect_platform(url: str) -> Platform:
    if VEO_URL_PATTERN.match(url.strip().rstrip("/") + "/"):
        return Platform.VEO
    if TRACE_URL_PATTERN.match(url.strip()):
        return Platform.TRACE
    raise ValueError(
        "Unsupported URL. Currently supports Veo and Trace game links."
    )


def get_import_progress(import_id: str) -> Optional[dict]:
    return _imports.get(import_id)


def start_import(
    url: str,
    user_id: str,
    profile_id: str,
    opponent_name: Optional[str] = None,
    game_date: Optional[str] = None,
    game_type: Optional[str] = None,
) -> dict:
    """Validate URL and start background import. Returns immediately."""
    platform = detect_platform(url)

    # Enforce one import per user
    existing = _user_locks.get(user_id)
    if existing and existing in _imports:
        prog = _imports[existing]
        if prog["status"] not in (ImportStatus.COMPLETE, ImportStatus.ERROR):
            raise ValueError(
                f"Import already in progress (id: {existing}). "
                "Wait for it to finish before starting another."
            )

    import_id = str(uuid.uuid4())
    _imports[import_id] = {
        "import_id": import_id,
        "status": ImportStatus.RESOLVING,
        "platform": platform.value,
        "progress_pct": 0,
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "error": None,
        "game_id": None,
    }
    _user_locks[user_id] = import_id

    asyncio.create_task(
        _run_import(
            import_id=import_id,
            url=url,
            platform=platform,
            user_id=user_id,
            profile_id=profile_id,
            opponent_name=opponent_name,
            game_date=game_date,
            game_type=game_type,
        )
    )

    return _imports[import_id]


async def _run_import(
    import_id: str,
    url: str,
    platform: Platform,
    user_id: str,
    profile_id: str,
    opponent_name: Optional[str],
    game_date: Optional[str],
    game_type: Optional[str],
):
    """Background task: full import pipeline."""
    progress = _imports[import_id]

    try:
        if platform == Platform.VEO:
            await _import_veo(
                import_id, url, user_id, profile_id,
                opponent_name, game_date, game_type,
            )
        else:
            await _import_trace(
                import_id, url, user_id, profile_id,
                opponent_name, game_date, game_type,
            )
    except (VeoImportError, TraceImportError, Exception) as e:
        logger.error(f"[game_import] Import {import_id} failed: {e}")
        progress["status"] = ImportStatus.ERROR
        progress["error"] = str(e)
    finally:
        _user_locks.pop(user_id, None)


async def _import_veo(
    import_id: str,
    url: str,
    user_id: str,
    profile_id: str,
    opponent_name: Optional[str],
    game_date: Optional[str],
    game_type: Optional[str],
):
    progress = _imports[import_id]

    # 1. Resolve
    progress["status"] = ImportStatus.RESOLVING
    info = await resolve_veo_download_url(url)
    progress["total_bytes"] = info.file_size

    # Auto-fill from metadata
    if not opponent_name and info.title:
        opponent_name = info.title

    # 2. Check credits
    progress["status"] = ImportStatus.CHECKING_CREDITS
    _check_and_deduct_credits(user_id, info.file_size, import_id)

    # 3. Stream to R2 (temp key, since we don't know hash yet)
    progress["status"] = ImportStatus.DOWNLOADING
    temp_r2_key = f"games/_import_{import_id}.mp4"

    blake3_hash = await veo_stream_to_r2(
        download_url=info.download_url,
        r2_key=temp_r2_key,
        expected_size=info.file_size,
    )

    # 4. Dedup: check if final key already exists
    final_r2_key = f"games/{blake3_hash}.mp4"
    final_full_key = r2_global_key(final_r2_key)
    temp_full_key = r2_global_key(temp_r2_key)

    existing = r2_head_object_global(final_full_key)
    if existing:
        logger.info(f"[game_import] Dedup hit: {blake3_hash} already in R2")
        r2_delete_object_global(temp_full_key)
    else:
        _r2_copy_and_delete(temp_full_key, final_full_key)

    progress["downloaded_bytes"] = info.file_size
    progress["progress_pct"] = 90

    # 5. Create game
    progress["status"] = ImportStatus.CREATING_GAME
    game_id = _create_game_record(
        user_id=user_id,
        profile_id=profile_id,
        opponent_name=opponent_name,
        game_date=game_date,
        game_type=game_type,
        videos=[(blake3_hash, info.file_size, 1)],
    )

    progress["status"] = ImportStatus.COMPLETE
    progress["progress_pct"] = 100
    progress["game_id"] = game_id
    logger.info(f"[game_import] Veo import complete: game_id={game_id}")


async def _import_trace(
    import_id: str,
    url: str,
    user_id: str,
    profile_id: str,
    opponent_name: Optional[str],
    game_date: Optional[str],
    game_type: Optional[str],
):
    progress = _imports[import_id]

    # 1. Resolve
    progress["status"] = ImportStatus.RESOLVING
    info = await resolve_trace_videos(url)

    # Auto-fill from metadata
    if not opponent_name:
        opponent_name = f"{info.home_team} vs {info.away_team}" if info.home_team and info.away_team else None
    if not game_date and info.full_date:
        game_date = info.full_date[:10]  # "2026-04-26T20:00:00.000Z" -> "2026-04-26"

    # 2. Check credits (estimate size from duration: ~1.3GB per half at 1080p)
    estimated_size = sum(
        int((v.duration or 2400) * 650_000)  # ~5Mbps = 650KB/s
        for v in info.videos
    )
    progress["total_bytes"] = estimated_size

    progress["status"] = ImportStatus.CHECKING_CREDITS
    _check_and_deduct_credits(user_id, estimated_size, import_id)

    # 3. Remux + upload each half
    progress["status"] = ImportStatus.DOWNLOADING
    video_refs = []
    total_downloaded = 0

    for i, video in enumerate(info.videos):
        variant_url = await resolve_best_variant(video.m3u8_url)

        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = str(Path(tmpdir) / f"half{video.half}.mp4")

            # Remux HLS -> MP4 (runs ffmpeg in subprocess)
            await asyncio.to_thread(
                remux_hls_to_mp4, variant_url, local_path, None, 600,
            )

            file_size = Path(local_path).stat().st_size
            total_downloaded += file_size

            # Upload to R2
            progress["status"] = ImportStatus.UPLOADING
            blake3_hash = await asyncio.to_thread(
                upload_file_to_r2, local_path, f"games/_import_{import_id}_h{video.half}.mp4",
            )

            # Dedup check + move to final key
            final_r2_key = f"games/{blake3_hash}.mp4"
            final_full_key = r2_global_key(final_r2_key)
            temp_full_key = r2_global_key(f"games/_import_{import_id}_h{video.half}.mp4")

            existing = r2_head_object_global(final_full_key)
            if existing:
                logger.info(f"[game_import] Dedup hit half {video.half}: {blake3_hash}")
                r2_delete_object_global(temp_full_key)
            else:
                _r2_copy_and_delete(temp_full_key, final_full_key)

            video_refs.append((blake3_hash, file_size, video.half))

        progress["downloaded_bytes"] = total_downloaded
        progress["progress_pct"] = int(50 + (i + 1) / len(info.videos) * 40)

    # 4. Create game
    progress["status"] = ImportStatus.CREATING_GAME
    game_id = _create_game_record(
        user_id=user_id,
        profile_id=profile_id,
        opponent_name=opponent_name,
        game_date=game_date,
        game_type=game_type,
        videos=video_refs,
    )

    progress["status"] = ImportStatus.COMPLETE
    progress["progress_pct"] = 100
    progress["game_id"] = game_id
    logger.info(f"[game_import] Trace import complete: game_id={game_id}, halves={len(video_refs)}")


def _check_and_deduct_credits(user_id: str, total_bytes: int, import_id: str):
    from app.services.storage_credits import calculate_upload_cost
    from app.services.user_db import deduct_credits

    cost = calculate_upload_cost(total_bytes)
    result = deduct_credits(user_id, cost, source="game_import", reference_id=import_id)

    if not result["success"]:
        raise ValueError(
            f"Insufficient credits. Required: {cost}, balance: {result['balance']}"
        )

    logger.info(f"[game_import] Deducted {cost} credits for import {import_id}")


def _create_game_record(
    user_id: str,
    profile_id: str,
    opponent_name: Optional[str],
    game_date: Optional[str],
    game_type: Optional[str],
    videos: list[tuple[str, int, int]],  # [(blake3_hash, file_size, sequence), ...]
) -> int:
    """Create game + game_videos rows, activate immediately (video already in R2)."""
    from app.database import get_db_connection
    from app.routers.games import generate_game_display_name, _probe_fps_from_r2
    from app.services.storage_credits import storage_expires_at
    from app.services.auth_db import insert_game_storage_ref

    display_name = generate_game_display_name(
        opponent_name, game_date, game_type, None, "Imported Game"
    )

    single_hash = videos[0][0] if len(videos) == 1 else None
    single_filename = f"{single_hash}.mp4" if single_hash else None
    total_size = sum(v[1] for v in videos)

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO games (
                name, blake3_hash, video_filename,
                video_size, opponent_name, game_date, game_type,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')
        """, (
            display_name,
            single_hash,
            single_filename,
            total_size,
            opponent_name,
            game_date,
            game_type,
        ))
        game_id = cursor.lastrowid

        for blake3_hash, file_size, sequence in videos:
            fps = _probe_fps_from_r2(blake3_hash)
            cursor.execute("""
                INSERT INTO game_videos (game_id, blake3_hash, sequence, video_size, fps)
                VALUES (?, ?, ?, ?, ?)
            """, (game_id, blake3_hash, sequence, file_size, fps))

            if fps and sequence == 1:
                cursor.execute(
                    "UPDATE games SET video_fps = ? WHERE id = ?",
                    (fps, game_id)
                )

        conn.commit()

    # Storage refs (outside user DB transaction)
    expires_str = storage_expires_at().isoformat()
    for blake3_hash, file_size, _ in videos:
        insert_game_storage_ref(user_id, profile_id, blake3_hash, file_size, expires_str)

    logger.info(f"[game_import] Created game {game_id}: {display_name}")
    return game_id


def _r2_copy_and_delete(source_key: str, dest_key: str):
    """Server-side copy in R2, then delete the source."""
    from app.utils.retry import retry_r2_call, TIER_1

    client = get_r2_client()
    if not client:
        raise RuntimeError("R2 client not available")

    retry_r2_call(
        client.copy_object,
        Bucket=R2_BUCKET,
        Key=dest_key,
        CopySource={"Bucket": R2_BUCKET, "Key": source_key},
        operation=f"copy {source_key} -> {dest_key}",
        **TIER_1,
    )

    r2_delete_object_global(source_key)
    logger.info(f"[game_import] Moved {source_key} -> {dest_key}")
