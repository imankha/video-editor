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
    read_selected_profile_from_r2,
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

    # 1. Load or create profile
    profile_id = None
    is_new_user = False

    if R2_ENABLED:
        profile_id = read_selected_profile_from_r2(user_id)

    if not profile_id:
        # New user or R2 disabled — create default profile
        profile_id = uuid4().hex[:8]
        is_new_user = True
        if R2_ENABLED:
            upload_profiles_json(user_id, profile_id)
            upload_selected_profile_json(user_id, profile_id)
        logger.info(f"Created new profile {profile_id} for user {user_id}")
    else:
        logger.info(f"Loaded existing profile {profile_id} for user {user_id}")

    # 2. Set profile context
    set_current_profile_id(profile_id)

    # 3. Ensure database exists
    # Import here to avoid circular imports (database.py imports from storage.py)
    from .database import ensure_database
    ensure_database()

    # 4. Cleanup tasks (moved from ensure_database lines 922-938)
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

    # 5. Cache the result
    result = {
        "profile_id": profile_id,
        "is_new_user": is_new_user,
    }
    _init_cache[user_id] = result

    return result
