"""
Authentication and session initialization endpoints.

/api/auth/init — Frontend calls this once on app mount. Performs ALL per-user
setup (profile load/create, DB init, cleanup). Returns profile_id for the
frontend to send as X-Profile-ID header on subsequent requests.

/api/auth/google — Verify Google ID token, store auth data, create session.
/api/auth/me — Check if current session is valid (called on app load).
"""

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import httpx
import logging
import shutil

from app.user_context import get_current_user_id
from app.database import get_user_data_path, get_db_connection, USER_DATA_BASE
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


# --- T400: Google OAuth + Session management ---

class GoogleAuthRequest(BaseModel):
    token: str


class AuthResponse(BaseModel):
    email: str
    user_id: str


@router.post("/google", response_model=AuthResponse)
async def google_auth(body: GoogleAuthRequest):
    """
    Verify Google ID token and create session.

    Frontend sends the credential JWT from Google Identity Services.
    Backend verifies it, stores email + google_id in per-user SQLite,
    and creates a session cookie.
    """
    user_id = get_current_user_id()

    # Verify token with Google
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://oauth2.googleapis.com/tokeninfo?id_token={body.token}"
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google token")
        token_data = resp.json()

    email = token_data.get("email")
    google_id = token_data.get("sub")
    if not email or not token_data.get("email_verified"):
        raise HTTPException(status_code=401, detail="Email not verified by Google")

    # Store auth data in per-user SQLite
    with get_db_connection() as db:
        cursor = db.cursor()

        # Upsert auth_profile (single row per user)
        cursor.execute("""
            INSERT INTO auth_profile (id, email, google_id, verified_at)
            VALUES (1, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                google_id = excluded.google_id,
                verified_at = datetime('now')
        """, (email, google_id))

        # Create session
        session_id = secrets.token_urlsafe(32)
        expires_at = (datetime.utcnow() + timedelta(days=30)).isoformat()
        cursor.execute("""
            INSERT INTO sessions (session_id, expires_at)
            VALUES (?, ?)
        """, (session_id, expires_at))

        db.commit()

    # Set session cookie on response
    response = JSONResponse(content={
        "email": email,
        "user_id": user_id,
    })
    response.set_cookie(
        key="rb_session",
        value=session_id,
        max_age=30 * 24 * 60 * 60,  # 30 days
        httponly=True,
        samesite="strict",
        secure=False,  # False for localhost dev — set True in production
    )
    return response


@router.get("/me")
async def auth_me(request: Request):
    """
    Check if current session is valid. Called on app load.

    Returns user info if session cookie is valid, 401 if not.
    Frontend uses this to set authStore.isAuthenticated on mount.
    """
    session_id = request.cookies.get("rb_session")
    if not session_id:
        raise HTTPException(status_code=401, detail="No session")

    user_id = get_current_user_id()
    with get_db_connection() as db:
        cursor = db.cursor()

        # Check session exists and not expired
        cursor.execute("""
            SELECT session_id, expires_at FROM sessions
            WHERE session_id = ?
        """, (session_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=401, detail="Invalid session")

        if datetime.fromisoformat(row['expires_at']) < datetime.utcnow():
            # Clean up expired session
            cursor.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
            db.commit()
            raise HTTPException(status_code=401, detail="Session expired")

        # Get auth profile
        cursor.execute("SELECT email, google_id FROM auth_profile WHERE id = 1")
        profile = cursor.fetchone()

        return {
            "email": profile['email'] if profile else None,
            "user_id": user_id,
            "is_authenticated": True,
        }
