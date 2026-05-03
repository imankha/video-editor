"""
Cleanup sweep scheduler: asyncio background loop that auto-exports games
and deletes expired R2 objects.

Uses a "cron till next event" pattern — after each sweep, queries
get_next_expiry() and sleeps until then (capped at 24h).
"""

import asyncio
import logging
from datetime import datetime

from .auth_db import (
    delete_grace_deletion,
    delete_ref,
    get_expired_grace_deletions,
    get_expired_refs,
    get_next_expiry,
    has_remaining_refs,
    insert_grace_deletion,
)
from .auto_export import auto_export_game
from ..database import ensure_database, get_db_connection
from ..profile_context import set_current_profile_id
from ..storage import r2_delete_object_global
from ..user_context import set_current_user_id

logger = logging.getLogger(__name__)

_sweep_task: asyncio.Task | None = None

MAX_DELAY = 86400  # 24 hours
MIN_DELAY = 60  # 1 minute
STARTUP_DELAY = 60  # Wait for app to stabilize
GRACE_PERIOD_DAYS = 14


async def start_sweep_loop():
    """Start the sweep loop as a background task. Called from app startup."""
    global _sweep_task
    _sweep_task = asyncio.create_task(_run_sweep_loop())
    logger.info("[Sweep] Background sweep loop started")


async def stop_sweep_loop():
    """Cancel the sweep loop. Called from app shutdown."""
    global _sweep_task
    if _sweep_task:
        _sweep_task.cancel()
        try:
            await _sweep_task
        except asyncio.CancelledError:
            pass
        _sweep_task = None
        logger.info("[Sweep] Background sweep loop stopped")


async def _run_sweep_loop():
    """Self-scheduling sweep: runs, finds next expiry, sleeps until then."""
    await asyncio.sleep(STARTUP_DELAY)

    while True:
        try:
            await asyncio.to_thread(do_sweep)

            next_expiry = get_next_expiry()
            if next_expiry is None:
                delay = MAX_DELAY
            else:
                delay = (next_expiry - datetime.utcnow()).total_seconds()
                delay = max(delay, MIN_DELAY)
                delay = min(delay, MAX_DELAY)

            logger.info(f"[Sweep] Next run in {delay / 3600:.1f}h")
            await asyncio.sleep(delay)

        except asyncio.CancelledError:
            logger.info("[Sweep] Shutdown")
            break
        except Exception:
            logger.exception("[Sweep] Error, retrying in 1h")
            await asyncio.sleep(3600)


def do_sweep():
    """Phase 1: process expired refs. Phase 2: delete grace-expired R2 objects."""
    # Phase 1: auto-export and delete expired storage refs
    expired_refs = get_expired_refs()
    if not expired_refs:
        logger.info("[Sweep] No expired refs")
    else:
        logger.info(f"[Sweep] Processing {len(expired_refs)} expired refs")

    expired_hashes = {r['blake3_hash'] for r in expired_refs}

    for ref in expired_refs:
        user_id = ref['user_id']
        profile_id = ref['profile_id']
        blake3_hash = ref['blake3_hash']

        set_current_user_id(user_id)
        set_current_profile_id(profile_id)
        ensure_database()

        game_ids = _find_games_for_hash(
            user_id, profile_id, blake3_hash, expired_hashes
        )

        for game_id in game_ids:
            try:
                status = auto_export_game(user_id, profile_id, game_id)
                logger.info(
                    f"[Sweep] game={game_id} user={user_id[:8]} status={status}"
                )
            except Exception as e:
                logger.error(
                    f"[Sweep] Auto-export failed: user={user_id} "
                    f"game={game_id}: {e}"
                )

        delete_ref(user_id, profile_id, blake3_hash)
        logger.info(f"[Sweep] Deleted ref user={user_id[:8]} hash={blake3_hash[:12]}")

        if not has_remaining_refs(blake3_hash):
            insert_grace_deletion(blake3_hash, GRACE_PERIOD_DAYS)
            logger.info(f"[Sweep] Grace period started hash={blake3_hash[:12]} ({GRACE_PERIOD_DAYS}d)")

    # Phase 2: delete R2 objects whose grace period has elapsed
    grace_expired = get_expired_grace_deletions()
    for blake3_hash in grace_expired:
        r2_delete_object_global(f"games/{blake3_hash}.mp4")
        delete_grace_deletion(blake3_hash)
        logger.info(f"[Sweep] Deleted R2 object hash={blake3_hash[:12]} (grace expired)")


def _find_games_for_hash(
    user_id: str, profile_id: str, blake3_hash: str, all_expired_hashes: set[str]
) -> set[int]:
    """Find all games (single and multi-video) using this hash that need export.

    For multi-video games, only includes games where ALL video hashes are in
    the expired set. Can't use a SQL join since game_storage_refs is in
    auth.sqlite while game_videos is in profile.sqlite.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Single-video games
        single = cursor.execute(
            """SELECT id FROM games
               WHERE blake3_hash = ? AND auto_export_status IS NULL""",
            (blake3_hash,),
        ).fetchall()

        # Multi-video games using this hash
        multi_candidates = cursor.execute(
            """SELECT DISTINCT g.id FROM games g
               JOIN game_videos gv ON gv.game_id = g.id
               WHERE gv.blake3_hash = ? AND g.auto_export_status IS NULL""",
            (blake3_hash,),
        ).fetchall()

        # Filter: only include multi-video games where ALL hashes are expired
        multi = []
        for row in multi_candidates:
            all_hashes = cursor.execute(
                "SELECT blake3_hash FROM game_videos WHERE game_id = ?",
                (row['id'],),
            ).fetchall()
            if all(h['blake3_hash'] in all_expired_hashes for h in all_hashes):
                multi.append(row)

    return {g['id'] for g in list(single) + list(multi)}
