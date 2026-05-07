"""
Unified game import orchestrator.

Handles the full import pipeline: detect platform, resolve video info,
check/deduct credits, download/upload to R2, create game record.
Runs as a background task with progress tracking.
"""

import asyncio
import logging
import uuid
from enum import Enum
from typing import Optional

from app.services.veo_import import (
    resolve_veo_download_url,
    VeoImportError,
    VEO_URL_PATTERN,
)
from app.services.trace_import import (
    resolve_trace_videos,
    resolve_best_variant,
    TraceImportError,
    TRACE_URL_PATTERN,
)
from app.services.modal_client import call_modal_ingest

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

    if not opponent_name and info.title:
        opponent_name = info.title

    # 2. Check credits
    progress["status"] = ImportStatus.CHECKING_CREDITS
    await asyncio.to_thread(_check_and_deduct_credits, user_id, info.file_size, import_id)

    # 3. Download + hash + upload via Modal (or local fallback)
    progress["status"] = ImportStatus.DOWNLOADING

    async def _progress_cb(pct, msg, phase):
        progress["progress_pct"] = int(pct * 0.9)  # Scale to 0-90

    result = await call_modal_ingest(
        source_url=info.download_url,
        source_type="direct",
        progress_callback=_progress_cb,
    )

    if result.get("status") != "success":
        raise VeoImportError(f"Ingest failed: {result.get('error', 'unknown')}")

    blake3_hash = result["blake3_hash"]
    file_size = result["file_size"]
    progress["downloaded_bytes"] = file_size
    progress["progress_pct"] = 90

    # 4. Create game
    progress["status"] = ImportStatus.CREATING_GAME
    game_id = await asyncio.to_thread(
        _create_game_record,
        user_id=user_id,
        profile_id=profile_id,
        opponent_name=opponent_name,
        game_date=game_date,
        game_type=game_type,
        videos=[(blake3_hash, file_size, 1)],
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

    if not opponent_name:
        opponent_name = f"{info.home_team} vs {info.away_team}" if info.home_team and info.away_team else None
    if not game_date and info.full_date:
        game_date = info.full_date[:10]

    # 2. Check credits (estimate size from duration: ~1.3GB per half at 1080p)
    estimated_size = sum(
        int((v.duration or 2400) * 650_000)
        for v in info.videos
    )
    progress["total_bytes"] = estimated_size

    progress["status"] = ImportStatus.CHECKING_CREDITS
    await asyncio.to_thread(_check_and_deduct_credits, user_id, estimated_size, import_id)

    # 3. Remux + upload halves via Modal (parallel)
    progress["status"] = ImportStatus.DOWNLOADING

    async def _process_half(video) -> tuple[str, int, int]:
        variant_url = await resolve_best_variant(video.m3u8_url)

        result = await call_modal_ingest(
            source_url=variant_url,
            source_type="hls",
        )

        if result.get("status") != "success":
            raise TraceImportError(
                f"Ingest failed for half {video.half}: {result.get('error', 'unknown')}"
            )

        return (result["blake3_hash"], result["file_size"], video.half)

    video_refs = list(await asyncio.gather(
        *[_process_half(v) for v in info.videos]
    ))
    video_refs.sort(key=lambda x: x[2])

    progress["downloaded_bytes"] = sum(v[1] for v in video_refs)
    progress["progress_pct"] = 90

    # 4. Create game
    progress["status"] = ImportStatus.CREATING_GAME
    game_id = await asyncio.to_thread(
        _create_game_record,
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


