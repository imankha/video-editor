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
from datetime import datetime
import httpx
import logging
import os
import shutil

import sqlite3
from uuid import uuid4

from app.user_context import get_current_user_id, set_current_user_id
from app.profile_context import get_current_profile_id, set_current_profile_id
from app.database import USER_DATA_BASE
from app.session_init import user_session_init
from app.storage import (
    read_selected_profile_from_r2,
    read_profiles_json,
    save_profiles_json,
    upload_to_r2,
    R2ReadError,
)
from app.services.auth_db import (
    get_user_by_email,
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

# Secure cookies require HTTPS — false for local dev, true for staging/production
_SECURE_COOKIES = os.getenv("SECURE_COOKIES", "false").lower() == "true"
# SameSite=none required for cross-origin (staging/prod) — strict for local dev
_SAMESITE = "none" if _SECURE_COOKIES else "strict"


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


# --- T410: Guest profile migration ---

def _migrate_guest_profile(guest_user_id: str, recovered_user_id: str) -> None:
    """Copy guest's active profile to recovered account if guest has games.

    Called during cross-device recovery (Google login with existing email).
    Best-effort: logs errors but never blocks login.
    """
    try:
        # Skip if same user (re-login from same device)
        if guest_user_id == recovered_user_id:
            return

        # 1. Resolve guest's active profile
        try:
            guest_profile_id = read_selected_profile_from_r2(guest_user_id)
        except R2ReadError:
            logger.warning(f"[Auth] Migration skip: R2 error reading guest profile for {guest_user_id}")
            return
        if not guest_profile_id:
            logger.info(f"[Auth] Migration skip: no profile found for guest {guest_user_id}")
            return

        # 2. Check if guest has games
        guest_db_path = USER_DATA_BASE / guest_user_id / "profiles" / guest_profile_id / "database.sqlite"
        if not guest_db_path.exists():
            logger.info(f"[Auth] Migration skip: no local DB for guest {guest_user_id}")
            return

        conn = sqlite3.connect(str(guest_db_path), timeout=5)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM games")
            game_count = cursor.fetchone()[0]
        finally:
            conn.close()

        if game_count == 0:
            logger.info(f"[Auth] Migration skip: guest {guest_user_id} has no games")
            return

        # 3. Copy guest profile DB to recovered account
        new_profile_id = uuid4().hex[:8]
        dest_db_path = USER_DATA_BASE / recovered_user_id / "profiles" / new_profile_id / "database.sqlite"
        dest_db_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(guest_db_path), str(dest_db_path))

        # Upload copied DB to R2
        original_profile_id = get_current_profile_id()
        try:
            set_current_profile_id(new_profile_id)
            upload_to_r2(recovered_user_id, "database.sqlite", dest_db_path)
        finally:
            set_current_profile_id(original_profile_id)

        # 4. Add new profile to recovered account's profiles.json
        profiles_data = read_profiles_json(recovered_user_id)
        if not profiles_data:
            logger.warning(f"[Auth] Migration: could not read profiles.json for {recovered_user_id}")
            return

        profiles_data["profiles"][new_profile_id] = {
            "name": "second",
            "color": "#4A90D9",
        }
        save_profiles_json(recovered_user_id, profiles_data)

        logger.info(
            f"[Auth] Migrated guest {guest_user_id} profile {guest_profile_id} "
            f"({game_count} games) → {recovered_user_id} profile {new_profile_id}"
        )

    except Exception as e:
        logger.error(f"[Auth] Migration failed (login continues): {e}")


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

    # Verify token with Google (10s timeout — fail fast if Google API is unreachable)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={body.token}"
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=503, detail="Google token verification timed out")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach Google: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    token_data = resp.json()

    # Validate token audience matches our app's client ID
    expected_aud = os.getenv("GOOGLE_CLIENT_ID")
    if not expected_aud:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID not configured")
    if token_data.get("aud") != expected_aud:
        raise HTTPException(status_code=401, detail="Token audience mismatch")

    email = token_data.get("email")
    google_id = token_data.get("sub")
    if not email or token_data.get("email_verified") != "true":
        raise HTTPException(status_code=401, detail="Email not verified by Google")

    # Look up in central auth DB: does this email already have a user?
    existing = get_user_by_email(email)

    if existing:
        # Cross-device recovery: use the EXISTING user_id
        user_id = existing['user_id']
        logger.info(f"[Auth] Google login — existing user found: {user_id} ({email})")
        update_last_seen(user_id)
        # T410: Migrate guest progress before switching user
        _migrate_guest_profile(current_user_id, user_id)
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
                        verified_at=datetime.utcnow().isoformat())
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
        samesite=_SAMESITE,
        secure=_SECURE_COOKIES,
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
        samesite=_SAMESITE,
        secure=_SECURE_COOKIES,
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
    response.delete_cookie("rb_session", samesite=_SAMESITE, secure=_SECURE_COOKIES)
    return response
