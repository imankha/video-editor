"""
Authentication endpoints for user isolation.

This is a simple user system for test isolation - no actual authentication.
The frontend "logs in" with a user ID, and the backend ensures that user
namespace exists (upsert pattern).

Production use: Single user mode with default user ID.
Test use: Each test suite logs in with a unique user ID for isolation.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import logging
import shutil

from app.user_context import get_current_user_id
from app.database import get_user_data_path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    user_id: str


class LoginResponse(BaseModel):
    user_id: str
    message: str


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """
    Login with a user ID.

    This is a simple upsert - if the user namespace doesn't exist, it will
    be created automatically when data is first accessed. No actual user
    records are stored; the user_id simply determines the storage namespace.

    For tests, use a unique user_id like "e2e_test_<timestamp>" to isolate
    test data from development data.

    Note: The actual user context is set via the X-User-ID header middleware,
    not this endpoint. This endpoint exists to:
    1. Provide a clear login action for the frontend
    2. Return confirmation of the user namespace
    3. Enable future user management features if needed
    """
    user_id = request.user_id.strip()

    if not user_id:
        user_id = "a"  # Default user

    # Sanitize: only allow alphanumeric, underscore, dash
    sanitized = ''.join(c for c in user_id if c.isalnum() or c in '_-')
    if not sanitized:
        sanitized = "a"

    logger.info(f"User login: {sanitized}")

    return LoginResponse(
        user_id=sanitized,
        message=f"Logged in as {sanitized}"
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
    user_path = get_user_data_path()

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
