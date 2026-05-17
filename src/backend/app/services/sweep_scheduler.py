"""
Cleanup sweep scheduler: asyncio background loop that auto-exports games
and deletes expired R2 objects.

Uses a "cron till next event" pattern — after each sweep, queries
get_next_expiry() and sleeps until then (capped at 24h).
"""

import asyncio
import logging
import time
from datetime import datetime, timezone

from .auth_db import (
    delete_grace_deletion,
    delete_ref,
    get_expired_grace_deletions,
    get_expired_refs_for_profile,
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


async def _ping_health():
    """Ping localhost health endpoint to prevent Fly.io auto-suspend."""
    import urllib.request
    while True:
        try:
            urllib.request.urlopen("http://localhost:8000/api/health", timeout=5)
            logger.debug("[Sweep] Keepalive ping OK")
        except Exception as e:
            logger.debug(f"[Sweep] Keepalive ping failed: {e}")
        await asyncio.sleep(30)


async def _run_sweep_loop():
    """Self-scheduling sweep: runs, finds next expiry, sleeps until then."""
    await asyncio.sleep(STARTUP_DELAY)

    while True:
        try:
            keepalive = asyncio.create_task(_ping_health())
            try:
                await asyncio.to_thread(do_sweep)
            finally:
                keepalive.cancel()

            next_expiry = get_next_expiry()
            if next_expiry is None:
                delay = MAX_DELAY
            else:
                delay = (next_expiry - datetime.now(timezone.utc)).total_seconds()
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
    """Phase 1: iterate users, export expired games. Phase 2: grace-delete R2 objects."""
    t0 = time.perf_counter()
    total_expired = 0

    # Phase 1: iterate all users' profiles for expired storage refs
    from .auth_db import get_all_users_for_admin
    from ..migrations import _get_profile_ids

    users = get_all_users_for_admin()
    for user in users:
        user_id = user["user_id"]
        for profile_id in _get_profile_ids(user_id):
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            ensure_database()

            expired_refs = get_expired_refs_for_profile()
            if not expired_refs:
                continue

            expired_hashes = {r["blake3_hash"] for r in expired_refs}
            total_expired += len(expired_refs)
            logger.info(f"[Sweep] user={user_id[:8]} profile={profile_id[:8]} has {len(expired_refs)} expired refs")

            for ref in expired_refs:
                blake3_hash = ref["blake3_hash"]
                game_ids = _find_games_for_hash(
                    user_id, profile_id, blake3_hash, expired_hashes
                )

                for game_id in game_ids:
                    try:
                        status = auto_export_game(user_id, profile_id, game_id)
                        logger.info(f"[Sweep] game={game_id} user={user_id[:8]} status={status}")
                    except Exception as e:
                        logger.error(f"[Sweep] Auto-export failed: user={user_id} game={game_id}: {e}")

                delete_ref(user_id, profile_id, blake3_hash)

                if not has_remaining_refs(blake3_hash):
                    insert_grace_deletion(blake3_hash, GRACE_PERIOD_DAYS)
                    logger.info(f"[Sweep] Grace period started hash={blake3_hash[:12]} ({GRACE_PERIOD_DAYS}d)")

    if not total_expired:
        logger.info("[Sweep] No expired refs")

    # Phase 2: delete R2 objects whose grace period has elapsed
    grace_expired = get_expired_grace_deletions()
    if grace_expired:
        logger.info(f"[Sweep] Phase 2: deleting {len(grace_expired)} grace-expired R2 objects")
    for blake3_hash in grace_expired:
        r2_delete_object_global(f"games/{blake3_hash}.mp4")
        delete_grace_deletion(blake3_hash)
        logger.info(f"[Sweep] Deleted R2 object hash={blake3_hash[:12]} (grace expired)")

    elapsed = time.perf_counter() - t0
    logger.info(f"[Sweep] Complete in {elapsed:.2f}s (refs={total_expired}, grace_deleted={len(grace_expired)})")


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
