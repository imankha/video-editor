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
from pathlib import Path

import sqlite3
from uuid import uuid4

from app.user_context import get_current_user_id, set_current_user_id
from app.profile_context import get_current_profile_id, set_current_profile_id
from app.database import USER_DATA_BASE
from app.session_init import user_session_init
from app.storage import (
    read_selected_profile_from_r2,
    upload_to_r2,
    R2ReadError,
    R2_ENABLED,
    get_r2_client,
    R2_BUCKET,
    APP_ENV,
)
from app.services.auth_db import (
    get_user_by_email,
    create_user,
    create_session,
    validate_session,
    invalidate_session,
    invalidate_user_sessions,
    create_guest_user,
    link_google_to_user,
    get_user_by_id,
    update_last_seen,
    sync_auth_db_to_r2,
)

# Test accounts that auto-reset on every login (fresh new-user experience).
# Read from nuf-reset-emails.txt at module load time.
def _load_nuf_reset_emails():
    """Load NUF reset emails from config file. One email per line, # for comments."""
    # __file__ = src/backend/app/routers/auth.py → project root is 5 levels up
    config_path = Path(__file__).parent.parent.parent.parent.parent / "nuf-reset-emails.txt"
    if not config_path.exists():
        return set()
    emails = set()
    for line in config_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            emails.add(line.lower())
    return emails

NUF_RESET_EMAILS = _load_nuf_reset_emails()

logger = logging.getLogger(__name__)


def _reset_test_account(user_id: str, email: str) -> None:
    """Wipe all data for a test account so next login is a fresh new-user experience."""
    logger.info(f"[Auth] Resetting test account: {email} (user_id={user_id})")

    # 1. Delete local user folder
    user_path = USER_DATA_BASE / user_id
    if user_path.exists():
        shutil.rmtree(user_path)
        logger.info(f"[Auth] Deleted local folder: {user_path}")

    # 2. Delete R2 user data (current environment only)
    if R2_ENABLED:
        client = get_r2_client()
        if client:
            prefix = f"{APP_ENV}/users/{user_id}/"
            paginator = client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
                objects = page.get("Contents", [])
                if objects:
                    keys = [{"Key": obj["Key"]} for obj in objects]
                    client.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": keys})
            logger.info(f"[Auth] Deleted R2 data under {prefix}")

    # 3. Delete auth DB records (sessions, credit transactions, user row)
    from app.services.auth_db import AUTH_DB_PATH
    conn = sqlite3.connect(str(AUTH_DB_PATH))
    for table, col in [("credit_transactions", "user_id"), ("sessions", "user_id"), ("users", "user_id")]:
        conn.execute(f"DELETE FROM {table} WHERE {col} = ?", (user_id,))
    conn.commit()
    conn.close()
    sync_auth_db_to_r2()
    logger.info(f"[Auth] Cleared auth DB records for {user_id}")
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

    try:
        logger.info(f"Deleting user folder: {user_path}")
        shutil.rmtree(user_path)
        logger.info(f"Successfully deleted user: {user_id}")
        return {"message": f"Deleted all data for user {user_id}", "deleted": True}
    except Exception as e:
        logger.error(f"Failed to delete user folder: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete user data: {e}")


# --- T415: Smart guest merge ---

def _merge_guest_into_profile(guest_db_path: Path, target_db_path: Path) -> int:
    """Merge guest's games and achievements into target profile database.

    Guest data is limited to games + achievements (auth gates block everything else).
    No user-scoped R2 files to copy — game videos are global.

    Returns the number of games merged (inserted, not skipped duplicates).
    """
    guest_conn = sqlite3.connect(str(guest_db_path), timeout=5)
    guest_conn.row_factory = sqlite3.Row
    target_conn = sqlite3.connect(str(target_db_path), timeout=5)
    target_conn.row_factory = sqlite3.Row

    merged_count = 0
    try:
        gc = guest_conn.cursor()
        tc = target_conn.cursor()

        # 1. Merge games — dedup by blake3_hash
        guest_games = gc.execute("SELECT * FROM games").fetchall()
        game_id_map = {}  # guest game ID → target game ID

        for game in guest_games:
            existing = tc.execute(
                "SELECT id FROM games WHERE blake3_hash = ?", (game['blake3_hash'],)
            ).fetchone()

            if existing:
                game_id_map[game['id']] = existing['id']
            else:
                tc.execute(
                    """INSERT INTO games (name, video_filename, blake3_hash, clip_count,
                       brilliant_count, great_count, good_count, last_accessed_at,
                       created_at, upload_status, duration, video_count, total_size)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (game['name'], game['video_filename'], game['blake3_hash'],
                     game['clip_count'], game['brilliant_count'], game['great_count'],
                     game['good_count'], game['last_accessed_at'], game['created_at'],
                     game['upload_status'], game['duration'], game['video_count'],
                     game['total_size'])
                )
                game_id_map[game['id']] = tc.lastrowid
                merged_count += 1

        # 2. Merge game_videos — only for newly inserted games
        guest_videos = gc.execute("SELECT * FROM game_videos").fetchall()
        for gv in guest_videos:
            new_game_id = game_id_map.get(gv['game_id'])
            if new_game_id is None:
                continue
            existing_gv = tc.execute(
                "SELECT id FROM game_videos WHERE game_id = ? AND sequence = ?",
                (new_game_id, gv['sequence'])
            ).fetchone()
            if not existing_gv:
                tc.execute(
                    """INSERT INTO game_videos (game_id, blake3_hash, sequence, duration,
                       original_filename, video_size, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (new_game_id, gv['blake3_hash'], gv['sequence'], gv['duration'],
                     gv['original_filename'], gv['video_size'], gv['created_at'])
                )

        # 3. Merge achievements — INSERT OR IGNORE keeps target's if both have same key
        guest_achievements = gc.execute("SELECT * FROM achievements").fetchall()
        for ach in guest_achievements:
            tc.execute(
                "INSERT OR IGNORE INTO achievements (key, achieved_at) VALUES (?, ?)",
                (ach['key'], ach['achieved_at'])
            )

        target_conn.commit()
    finally:
        guest_conn.close()
        target_conn.close()

    return merged_count


def _migrate_guest_profile(guest_user_id: str, recovered_user_id: str) -> None:
    """Merge guest's games/achievements into recovered account's default profile.

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

        # 3. Resolve target: recovered account's default profile
        target_profile_id = read_selected_profile_from_r2(recovered_user_id)
        target_db_path = USER_DATA_BASE / recovered_user_id / "profiles" / target_profile_id / "database.sqlite"

        if not target_db_path.exists():
            # Brand new account that never loaded — initialize it
            user_session_init(recovered_user_id)

        # 4. Merge guest data into target profile
        merged_count = _merge_guest_into_profile(guest_db_path, target_db_path)

        # 5. Upload modified target DB to R2
        original_profile_id = get_current_profile_id()
        try:
            set_current_profile_id(target_profile_id)
            upload_to_r2(recovered_user_id, "database.sqlite", target_db_path)
        finally:
            set_current_profile_id(original_profile_id)

        logger.info(
            f"[Auth] Merged guest {guest_user_id} ({game_count} games, {merged_count} new) "
            f"→ {recovered_user_id} profile {target_profile_id}"
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
        from app.utils.retry import retry_async_call, TIER_1

        async def _verify_google_token():
            async with httpx.AsyncClient(timeout=10.0) as client:
                return await client.get(
                    f"https://oauth2.googleapis.com/tokeninfo?id_token={body.token}"
                )

        resp = await retry_async_call(
            _verify_google_token, operation="google_oauth", **TIER_1,
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

    # Auto-reset NUF test accounts: wipe all data so login is always fresh (non-prod only)
    if email.lower() in NUF_RESET_EMAILS and APP_ENV != "production":
        existing_test = get_user_by_email(email)
        if existing_test:
            _reset_test_account(existing_test['user_id'], email)
            # After reset, fall through to the first-time flow below

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

    # T610: Track activity for account cleanup
    update_last_seen(session["user_id"])

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

    # T610: Track activity for account cleanup
    update_last_seen(user_id)

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
