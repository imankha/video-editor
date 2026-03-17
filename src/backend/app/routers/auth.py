"""
Authentication and session initialization endpoints.

/api/auth/init — Frontend calls this once on app mount. Performs ALL per-user
setup (profile load/create, DB init, cleanup). Returns profile_id for the
frontend to send as X-Profile-ID header on subsequent requests.

/api/auth/google — Verify Google ID token, look up or create user in central
auth DB, create session cookie.
/api/auth/me — Check if current session is valid (called on app load).
/api/auth/init-guest — Create anonymous guest user with UUID.
/api/auth/logout — Invalidate session and clear cookie.

T405: Auth data now lives in a shared SQLite (auth.sqlite) instead of
per-user SQLite. This enables cross-device recovery via email→user_id lookup.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import httpx
import logging
import shutil

from app.user_context import get_current_user_id, set_current_user_id
from app.database import USER_DATA_BASE
from app.session_init import user_session_init
from app.services.auth_db import (
    get_user_by_email,
    get_user_by_google_id,
    create_user,
    create_session,
    validate_session,
    invalidate_session,
    create_guest_user,
    link_google_to_user,
    get_user_by_id,
    update_last_seen,
)

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


# --- T405: Google OAuth + Session management (shared auth DB) ---

class GoogleAuthRequest(BaseModel):
    token: str


class AuthResponse(BaseModel):
    email: str
    user_id: str


@router.post("/google", response_model=AuthResponse)
async def google_auth(body: GoogleAuthRequest, request: Request):
    """
    Verify Google ID token and create session.

    Cross-device recovery flow:
    1. Verify JWT with Google
    2. Look up email in central auth DB
    3. If found → return that user_id (cross-device recovery!)
    4. If not found → register current guest user_id with this email
    5. Create session in central auth DB + set cookie
    """
    current_user_id = get_current_user_id()

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

    # Look up in central auth DB: does this email already have a user?
    existing = get_user_by_email(email)

    if existing:
        # Cross-device recovery: use the EXISTING user_id
        user_id = existing['user_id']
        logger.info(f"[Auth] Google login — existing user found: {user_id} ({email})")
        update_last_seen(user_id)
    else:
        # First-time Google auth
        # Check if current user already exists in auth DB (guest who's now signing in)
        current_user = get_user_by_id(current_user_id)
        if current_user and not current_user.get('email'):
            # Guest user signing in for the first time — link Google to their account
            link_google_to_user(current_user_id, email, google_id)
            user_id = current_user_id
            logger.info(f"[Auth] Google login — linked to existing guest: {user_id} ({email})")
        else:
            # Brand new user (shouldn't happen often — guest should exist already)
            user_id = current_user_id
            create_user(user_id, email=email, google_id=google_id,
                        verified_at=__import__('datetime').datetime.utcnow().isoformat())
            logger.info(f"[Auth] Google login — created new user: {user_id} ({email})")

    # Create session in central auth DB
    session_id = create_session(user_id)

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

    T405: Now validates against central auth DB (not per-user SQLite).
    """
    session_id = request.cookies.get("rb_session")
    if not session_id:
        raise HTTPException(status_code=401, detail="No session")

    session = validate_session(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    return {
        "email": session.get("email"),
        "user_id": session["user_id"],
        "is_authenticated": True,
    }


@router.post("/init-guest")
async def init_guest(request: Request):
    """
    Create an anonymous guest user with a UUID.

    Called when a new visitor chooses "Continue as guest" on the LoginPage,
    or automatically when the frontend needs a user_id without auth.

    If X-User-ID header is present (e.g., from E2E tests), use that ID
    instead of generating a new UUID. This preserves test isolation.

    Returns user_id and sets a session cookie so the guest can be
    recovered if they later sign in with Google.
    """
    # Check if a specific user_id was requested via header (tests/dev)
    requested_id = request.headers.get('X-User-ID')
    if requested_id:
        sanitized = ''.join(c for c in requested_id if c.isalnum() or c in '_-')
        if sanitized:
            # Check if this user already exists in the auth DB
            existing = get_user_by_id(sanitized)
            if existing:
                user_id = sanitized
            else:
                # Create with the requested ID
                create_user(sanitized)
                user_id = sanitized
        else:
            user_id = create_guest_user()
    else:
        user_id = create_guest_user()

    session_id = create_session(user_id)

    # Initialize the user's data (profile, database, etc.)
    set_current_user_id(user_id)
    result = user_session_init(user_id)

    response = JSONResponse(content={
        "user_id": user_id,
        "profile_id": result["profile_id"],
        "is_new_user": True,
    })
    response.set_cookie(
        key="rb_session",
        value=session_id,
        max_age=30 * 24 * 60 * 60,  # 30 days
        httponly=True,
        samesite="strict",
        secure=False,
    )
    return response


@router.post("/logout")
async def logout(request: Request):
    """
    Invalidate current session and clear cookie.
    """
    session_id = request.cookies.get("rb_session")
    if session_id:
        invalidate_session(session_id)

    response = JSONResponse(content={"logged_out": True})
    response.delete_cookie("rb_session")
    return response
