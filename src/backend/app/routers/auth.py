"""
Authentication and session initialization endpoints.

/api/auth/init — Frontend calls this once on app mount. Performs ALL per-user
setup (profile load/create, DB init, cleanup). Returns profile_id for the
frontend to send as X-Profile-ID header on subsequent requests.

When real auth is added, call user_session_init() from the login handler.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import logging
import shutil

from app.user_context import get_current_user_id
from app.database import get_user_data_path, USER_DATA_BASE
from app.session_init import user_session_init

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


class InitResponse(BaseModel):
    user_id: str
    profile_id: str
    is_new_user: bool


@router.post("/init", response_model=InitResponse)
async def init_session():
    """
    Initialize user session. Frontend calls this once on app mount.

    Creates default profile if needed, ensures database exists, runs
    cleanup tasks. Returns profile_id for the frontend to include as
    X-Profile-ID header on all subsequent requests.

    All per-user setup lives in user_session_init() — when real auth
    is added, just call that function from the login handler.
    """
    user_id = get_current_user_id()
    result = user_session_init(user_id)

    return InitResponse(
        user_id=user_id,
        profile_id=result["profile_id"],
        is_new_user=result["is_new_user"],
    )


@router.get("/whoami")
async def whoami():
    """Return the current user ID from request context."""
    return {"user_id": get_current_user_id()}


@router.delete("/user")
async def delete_user():
    """
    Delete the current user's entire data folder.

    This removes ALL data for the current user including:
    - Database (projects, clips, games, annotations)
    - All video files (raw clips, working videos, final videos)
    - All cached data

    Use with caution! This is primarily for test cleanup.
    """
    user_id = get_current_user_id()
    # Use user-level path (not profile-scoped) — delete everything for this user
    user_path = USER_DATA_BASE / user_id

    if not user_path.exists():
        logger.info(f"User folder does not exist: {user_id}")
        return {"message": f"User {user_id} has no data to delete", "deleted": False}

    # Safety check: don't delete the default user in production
    if user_id == "a" and not user_id.startswith("e2e_"):
        logger.warning(f"Attempted to delete default user 'a' - blocking for safety")
        raise HTTPException(
            status_code=403,
            detail="Cannot delete default user. Use a test user ID for cleanup."
        )

    try:
        logger.info(f"Deleting user folder: {user_path}")
        shutil.rmtree(user_path)
        logger.info(f"Successfully deleted user: {user_id}")
        return {"message": f"Deleted all data for user {user_id}", "deleted": True}
    except Exception as e:
        logger.error(f"Failed to delete user folder: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete user data: {e}")
