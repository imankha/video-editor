"""
Cleanup sweep scheduler: asyncio background loop that auto-exports games
and deletes expired R2 objects.

Uses a "cron till next event" pattern — after each sweep, queries
get_next_expiry() and sleeps until then (capped at 24h).
"""

import asyncio
import logging
import time
from datetime import UTC, datetime

from ..database import ensure_database, get_db_connection, sync_db_to_r2_explicit
from ..profile_context import set_current_profile_id
from ..storage import r2_delete_object_global
from ..user_context import set_current_user_id
from .auth_db import (
    count_refs_in_profile,
    delete_grace_deletion,
    delete_ref,
    expire_game_storage,
    get_expired_grace_deletions,
    get_expired_refs_for_profile,
    get_next_expiry,
    has_remaining_refs,
    heal_ref_count,
    insert_grace_deletion,
)
from .auto_export import MAX_AUTO_EXPORT_ATTEMPTS, auto_export_game

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
                delay = (next_expiry - datetime.now(UTC)).total_seconds()
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
    from ..migrations import _get_profile_ids
    from .auth_db import get_all_users_for_admin

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

                # Keep the ref (and the source video) if any game on this hash
                # still has a retryable auto-export — a failed export under the
                # attempt cap. Reclaiming now would delete the source before we
                # could ever produce its recap (bug 23p). The next sweep retries.
                if _find_games_for_hash(user_id, profile_id, blake3_hash, expired_hashes):
                    logger.warning(
                        f"[Sweep] hash={blake3_hash[:12]} auto-export not settled "
                        f"(failed, under retry cap) — keeping ref to retry next sweep"
                    )
                    continue

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
        # AUTHORITATIVE GATE (source of truth, not the drift-prone counter):
        # before permanently deleting the R2 source, verify no profile still
        # holds a LIVE (non-expired) game_storage ref for this hash.  The
        # grace deletion was queued off game_ref_counts.ref_count <= 0, which
        # can be wrong (the counter drifts — see delete_ref / heal_ref_count).
        # Deleting while a live ref exists strands a user with a "ready" game
        # and a 404 video (the bug that lost imankh games 2/3/5).
        total_refs, live_refs = _count_refs_all_profiles(blake3_hash, users)
        if live_refs > 0:
            logger.error(
                f"[Sweep] ABORT delete hash={blake3_hash[:12]} — {live_refs} live "
                f"ref(s) still exist across profiles; canceling grace deletion and "
                f"healing ref_count {total_refs}"
            )
            delete_grace_deletion(blake3_hash)
            heal_ref_count(blake3_hash, total_refs)
            continue

        r2_delete_object_global(f"games/{blake3_hash}.mp4")
        delete_grace_deletion(blake3_hash)
        logger.info(f"[Sweep] Deleted R2 object hash={blake3_hash[:12]} (grace expired)")
        # Belt-and-suspenders: expire any lingering game_storage rows for this
        # hash across all initialized profiles.  Normally Phase 1 deletes all
        # refs before Phase 2 runs; this catches edge cases such as refs with a
        # future expiry that Phase 1 didn't touch (bug 27p class).
        n_expired = _expire_game_storage_all_profiles(blake3_hash, users)
        if n_expired:
            logger.info(
                f"[Sweep] Expired {n_expired} lingering game_storage ref(s) "
                f"after deletion of hash={blake3_hash[:12]}"
            )

    elapsed = time.perf_counter() - t0
    logger.info(f"[Sweep] Complete in {elapsed:.2f}s (refs={total_expired}, grace_deleted={len(grace_expired)})")


def _count_refs_all_profiles(blake3_hash: str, users: list) -> tuple[int, int]:
    """Sum (total_refs, live_refs) for a hash across all initialized profiles.

    live_refs > 0 means at least one profile still holds a non-expired
    game_storage ref — the video is still wanted and must NOT be deleted.
    Reads local profile DBs (already downloaded by Phase 1 this same sweep), so
    this is cheap and only runs for the rare grace-expired hashes in Phase 2.
    """
    from ..database import USER_DATA_BASE
    from ..migrations import _get_profile_ids

    total = live = 0
    for user in users:
        user_id = user["user_id"]
        for profile_id in _get_profile_ids(user_id):
            db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
            if not db_path.exists():
                continue
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            try:
                t, live_n = count_refs_in_profile(blake3_hash)
                total += t
                live += live_n
            except Exception:
                # A profile we cannot read is indeterminate — treat as a live
                # ref so we never delete a video on incomplete information.
                logger.exception(
                    f"[Sweep] count_refs_in_profile failed for "
                    f"user={user_id[:8]} profile={profile_id[:8]} — assuming live ref"
                )
                live += 1
    return total, live


def _expire_game_storage_all_profiles(blake3_hash: str, users: list) -> int:
    """Expire any remaining game_storage rows for this hash across local profiles.

    Called after Phase 2 R2 deletion.  Normal flow: Phase 1 deletes all refs via
    delete_ref() before Phase 2 runs, so this is usually a no-op.  It catches the
    edge case where a profile has a future-expiry ref (bug 27p class) that Phase 1
    didn't pick up because the ref wasn't expired yet.

    Only touches profiles whose DB file already exists locally to avoid downloading
    from R2 purely for this belt-and-suspenders step.
    """
    from ..database import USER_DATA_BASE
    from ..migrations import _get_profile_ids

    total = 0
    for user in users:
        user_id = user["user_id"]
        for profile_id in _get_profile_ids(user_id):
            db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
            if not db_path.exists():
                continue
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            try:
                n = expire_game_storage(blake3_hash)
                total += n
                if n:
                    sync_db_to_r2_explicit(user_id, profile_id)
            except Exception:
                logger.exception(
                    f"[Sweep] expire_game_storage failed for "
                    f"user={user_id[:8]} profile={profile_id[:8]}"
                )
    return total


def _find_games_for_hash(
    user_id: str, profile_id: str, blake3_hash: str, all_expired_hashes: set[str]
) -> set[int]:
    """Find all games (single and multi-video) using this hash that need export.

    "Need export" means never exported (auto_export_status IS NULL) OR a prior
    export failed and is still under the retry cap. Games that succeeded,
    skipped, or exhausted their retries are excluded.

    For multi-video games, only includes games where ALL video hashes are in
    the expired set. Can't use a SQL join since game_storage_refs is in
    auth.sqlite while game_videos is in profile.sqlite.
    """
    # A game needs (re)export when it was never run, or it failed and still has
    # retries left. {p} is the games-table alias prefix ("" or "g.").
    def needs_export(p):
        return (f"({p}auto_export_status IS NULL OR "
                f"({p}auto_export_status = 'failed' "
                f"AND COALESCE({p}auto_export_attempts, 0) < ?))")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Single-video games
        single = cursor.execute(
            f"""SELECT id FROM games
               WHERE blake3_hash = ? AND {needs_export('')}""",
            (blake3_hash, MAX_AUTO_EXPORT_ATTEMPTS),
        ).fetchall()

        # Multi-video games using this hash
        multi_candidates = cursor.execute(
            f"""SELECT DISTINCT g.id FROM games g
               JOIN game_videos gv ON gv.game_id = g.id
               WHERE gv.blake3_hash = ? AND {needs_export('g.')}""",
            (blake3_hash, MAX_AUTO_EXPORT_ATTEMPTS),
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
