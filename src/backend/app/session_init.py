"""
User session initialization — single entry point for all per-user setup.

When real auth is added, call user_session_init() from the login handler.
All per-user "run once" tasks belong here.

Called by:
  - /api/auth/init endpoint (explicit frontend call)
  - UserContextMiddleware (auto-resolve when X-Profile-ID header is missing)
  - startup_event (initialize default user)

Idempotent per user — the expensive R2 lookup runs once, then results are
cached in _init_cache. Subsequent calls just set the profile context and return.
"""

import logging
from uuid import uuid4

from .profile_context import set_current_profile_id
from .storage import (
    R2_ENABLED,
    R2ReadError,
    upload_profiles_json,
    upload_selected_profile_json,
)

logger = logging.getLogger(__name__)

# Per-user init cache: user_id -> {"profile_id": str, "is_new_user": bool}
# Populated on first call, returned on subsequent calls.
# This makes user_session_init() cheap to call from middleware on every request.
_init_cache: dict[str, dict] = {}


def invalidate_user_cache(user_id: str) -> None:
    """Remove user from _init_cache so next request re-reads from R2.

    Called after profile switch or delete to ensure the middleware
    picks up the new selected profile on the next request.
    """
    _init_cache.pop(user_id, None)


def user_session_init(user_id: str) -> dict:
    """
    Initialize a user session. Idempotent — safe to call on every request.

    First call per user:
    1. Load or create profile (R2 lookup / create)
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

    # 2. Load or create profile (user.sqlite is source of truth, R2 is backup)
    from .services.user_db import (
        get_selected_profile_id, get_profiles,
        create_profile, set_selected_profile_id, migrate_profiles_from_r2,
    )

    profile_id = None
    is_new_user = False

    # Try user.sqlite first
    profile_id = get_selected_profile_id(user_id)
    if profile_id:
        logger.info(f"Loaded profile {profile_id} for user {user_id} from user.sqlite")
    else:
        # Try R2 migration (existing user whose profiles are still in R2)
        if R2_ENABLED:
            try:
                profile_id = migrate_profiles_from_r2(user_id)
                if profile_id:
                    logger.info(f"Migrated profile {profile_id} for user {user_id} from R2")
            except R2ReadError:
                logger.error(f"R2 read failed for user {user_id} — refusing to create new profile")
                raise

    if not profile_id:
        # Genuinely new user — create default profile in user.sqlite + R2 backup
        profile_id = uuid4().hex[:8]
        is_new_user = True
        create_profile(user_id, profile_id, name="", color="#6366f1", is_default=True)
        set_selected_profile_id(user_id, profile_id)
        if R2_ENABLED:
            upload_profiles_json(user_id, profile_id)
            upload_selected_profile_json(user_id, profile_id)
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

    # 7. Cleanup tasks (moved from ensure_database lines 922-938)
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

    # 8. Cache the result
    result = {
        "profile_id": profile_id,
        "is_new_user": is_new_user,
    }
    _init_cache[user_id] = result

    return result
