"""
User session initialization — single entry point for all per-user setup.

When real auth is added, call user_session_init() from the login handler.
All per-user "run once" tasks belong here.

Called by:
  - /api/auth/init endpoint (explicit frontend call)
  - UserContextMiddleware (auto-resolve when X-Profile-ID header is missing)
  - startup_event (initialize default user)

Idempotent per user — user.sqlite is source of truth. Results are cached
in _init_cache. Subsequent calls just set the profile context and return.
"""

import logging
from uuid import uuid4

from .profile_context import set_current_profile_id

logger = logging.getLogger(__name__)

# Per-user init cache: user_id -> {"profile_id": str, "is_new_user": bool}
# Populated on first call, returned on subsequent calls.
# This makes user_session_init() cheap to call from middleware on every request.
_init_cache: dict[str, dict] = {}


def invalidate_user_cache(user_id: str) -> None:
    """Remove user from _init_cache so next request re-reads user.sqlite.

    Called after profile switch or delete to ensure the middleware
    picks up the new selected profile on the next request.
    """
    _init_cache.pop(user_id, None)


def user_session_init(user_id: str) -> dict:
    """
    Initialize a user session. Idempotent — safe to call on every request.

    First call per user:
    1. Load or create profile from user.sqlite
    2. Ensure database exists (dirs, tables, R2 download)
    3. Run cleanup tasks (stale projects, DB bloat)
    4. Cache the result

    Subsequent calls: set profile context from cache and return immediately.

    Returns:
        {
            "profile_id": str,   # The active profile GUID
            "is_new_user": bool, # True if profile was just created
        }
    """
    # Fast path: already initialized for this user
    cached = _init_cache.get(user_id)
    if cached:
        set_current_profile_id(cached["profile_id"])
        return cached

    # --- Slow path: first init for this user ---

    # 1. Ensure user-level database exists (needed before profile lookup)
    from .services.user_db import ensure_user_database
    ensure_user_database(user_id)

    # 2. Load or create profile (user.sqlite is source of truth)
    from .services.user_db import (
        get_selected_profile_id,
        create_profile, set_selected_profile_id,
    )

    profile_id = None
    is_new_user = False

    profile_id = get_selected_profile_id(user_id)
    if profile_id:
        logger.info(f"Loaded profile {profile_id} for user {user_id} from user.sqlite")

    if not profile_id:
        # New user — create default profile in user.sqlite
        profile_id = uuid4().hex[:8]
        is_new_user = True
        create_profile(user_id, profile_id, name="", color="#6366f1", is_default=True)
        set_selected_profile_id(user_id, profile_id)
        logger.info(f"Created new profile {profile_id} for user {user_id}")

    # 2. Set profile context
    set_current_profile_id(profile_id)

    # 3. Ensure database exists
    # Import here to avoid circular imports (database.py imports from storage.py)
    from .database import ensure_database
    ensure_database()

    # 5. T890: Recover orphaned credit reservations
    try:
        from .services.user_db import recover_orphaned_reservations
        recovered = recover_orphaned_reservations(user_id)
        if recovered > 0:
            logger.info(f"Recovered {recovered} orphaned credit reservations for user {user_id}")
    except Exception as e:
        logger.error(f"Failed to recover orphaned reservations: {e}")

    # 6. T970: Backfill completed_quests from credit_transactions
    try:
        from .services.user_db import backfill_completed_quests
        backfill_completed_quests(user_id)
    except Exception as e:
        logger.error(f"T970: Failed to backfill completed quests: {e}")

    # 7. T985: Backfill preferences from profile DB to user.sqlite
    try:
        from .services.user_db import backfill_preferences_from_profile
        backfill_preferences_from_profile(user_id)
    except Exception as e:
        logger.error(f"T985: Failed to backfill preferences: {e}")

    # 8. Cleanup tasks (moved from ensure_database lines 922-938)
    try:
        from .services.project_archive import cleanup_stale_restored_projects
        archived_count = cleanup_stale_restored_projects(user_id)
        if archived_count > 0:
            logger.info(f"T66: Re-archived {archived_count} stale restored projects for user {user_id}")
    except Exception as e:
        logger.error(f"T66: Failed to cleanup stale restored projects: {e}")

    try:
        from .services.project_archive import cleanup_database_bloat
        cleanup_database_bloat()
    except Exception as e:
        logger.error(f"T243: Failed to cleanup database bloat: {e}")

    # 9. Cache the result BEFORE scheduling recovery so concurrent first
    # requests (e.g. two tabs) don't both schedule the same work.
    result = {
        "profile_id": profile_id,
        "is_new_user": is_new_user,
    }
    _init_cache[user_id] = result

    # 10. T1380 + T1390: per-user orphaned-job recovery and modal queue drain.
    # Runs once per user per server process (gated by _init_cache above).
    # Both routines need user+profile context, which is set above. When an
    # event loop is running we schedule as a background task so the user's
    # first request isn't blocked; in sync test contexts we run inline.
    _schedule_startup_recovery(user_id)

    return result


async def _run_startup_recovery(user_id: str) -> None:
    """Run orphaned-job recovery and modal queue drain for the current user.

    Expects user_id + profile_id ContextVars to already be set by the caller
    (asyncio.create_task copies the current context, so this is automatic
    when scheduled from user_session_init).
    """
    from .services.export_worker import recover_orphaned_jobs
    from .services.modal_queue import process_modal_queue

    try:
        await recover_orphaned_jobs()
    except Exception as e:
        logger.warning(
            f"[SessionInit] recover_orphaned_jobs failed for {user_id}: {e}"
        )

    try:
        result = await process_modal_queue()
        if result.get("processed", 0) > 0:
            logger.info(
                f"[SessionInit] modal queue for {user_id}: "
                f"{result['succeeded']} ok, {result['failed']} failed"
            )
    except Exception as e:
        logger.warning(
            f"[SessionInit] process_modal_queue failed for {user_id}: {e}"
        )


def _schedule_startup_recovery(user_id: str) -> None:
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_run_startup_recovery(user_id))
    except RuntimeError:
        asyncio.run(_run_startup_recovery(user_id))
