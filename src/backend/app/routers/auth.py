"""
Authentication and session initialization endpoints.

/api/auth/init — Frontend calls this once on app mount (post-login). Performs
all per-user setup (profile load/create, DB init). Returns profile_id for
subsequent X-Profile-ID headers.
/api/auth/google — Verify Google ID token, find-or-create user by email,
create session cookie.
/api/auth/send-otp, /api/auth/verify-otp — Email OTP auth.
/api/auth/me — Check if current session is valid.
/api/auth/logout — Invalidate session and clear cookie.

T1330: Guest accounts and guest→auth migration are removed. Every user row
has a non-null email. Unauthenticated visitors have no user_id; mutating
actions must go through the auth modal first.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
import httpx
import logging
import os
import re
import secrets
import shutil
from pathlib import Path

import sqlite3

from app.analytics import create_user_milestones, record_milestone, update_session
from app.user_context import get_current_user_id, set_current_user_id
from app.profile_context import set_current_profile_id
from app.database import USER_DATA_BASE
from app.session_init import user_session_init, invalidate_user_cache
from app.storage import (
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
    generate_user_id,
    get_user_by_id,
    update_last_seen,
    update_picture_url,
    get_auth_db,
)

# Test accounts that auto-reset on every login (fresh new-user experience).
# Read from nuf-reset-emails.txt at module load time.
def _load_nuf_reset_emails():
    """Load NUF reset emails from config file. One email per line, # for comments."""
    candidates = [
        Path(__file__).parent.parent.parent / "nuf-reset-emails.txt",
        Path(__file__).parent.parent.parent.parent.parent / "nuf-reset-emails.txt",
    ]
    for config_path in candidates:
        if config_path.exists():
            emails = set()
            for line in config_path.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    emails.add(line.lower())
            return emails
    return set()

NUF_RESET_EMAILS = _load_nuf_reset_emails()

logger = logging.getLogger(__name__)


def _reset_test_account(user_id: str, email: str) -> None:
    """Wipe all data for a test account so next login is a fresh new-user experience."""
    logger.info(f"[Auth] Resetting test account: {email} (user_id={user_id})")

    user_path = USER_DATA_BASE / user_id
    if user_path.exists():
        shutil.rmtree(user_path)
        logger.info(f"[Auth] Deleted local folder: {user_path}")

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

    invalidate_user_sessions(user_id)
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        # Reset recipient-side share state so share links can be re-materialized
        cur.execute(
            """UPDATE share_games SET materialized_at = NULL, recipient_profile_id = NULL
               WHERE share_id IN (SELECT id FROM shares WHERE recipient_email = %s)""",
            (email,),
        )
        cur.execute(
            """UPDATE pending_teammate_shares SET resolved_at = NULL
               WHERE share_id IN (SELECT id FROM shares WHERE recipient_email = %s)""",
            (email,),
        )
        cur.execute("DELETE FROM user_milestones WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM referrals WHERE referrer_id = %s OR referred_id = %s", (user_id, user_id))
        cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
    logger.info(f"[Auth] Cleared auth DB records for {user_id}")


router = APIRouter(prefix="/api/auth", tags=["auth"])

from app.utils.cookies import set_cookie as _set_cookie, delete_cookie as _delete_cookie


class InitResponse(BaseModel):
    user_id: str
    profile_id: str
    is_new_user: bool


@router.post("/init", response_model=InitResponse)
async def init_session():
    """
    Initialize user session. Frontend calls this once on app mount AFTER login.

    Creates default profile if needed, ensures database exists. Returns
    profile_id for the frontend to include as X-Profile-ID header on all
    subsequent requests.
    """
    user_id = get_current_user_id()
    cancel_active_vacuum(user_id)
    result = user_session_init(user_id)

    return InitResponse(
        user_id=user_id,
        profile_id=result["profile_id"],
        is_new_user=result["is_new_user"],
    )


@router.get("/whoami")
async def whoami():
    """Return the current user ID and terms acceptance status."""
    user_id = get_current_user_id()
    needs_terms = False
    with get_auth_db() as db:
        cur = db.cursor()
        cur.execute(
            "SELECT terms_accepted_at FROM users WHERE user_id = %s", (user_id,)
        )
        row = cur.fetchone()
        if row and not row["terms_accepted_at"]:
            needs_terms = True
    return {"user_id": user_id, "needs_terms_acceptance": needs_terms}


@router.post("/accept-terms")
async def accept_terms(request: Request):
    """Record terms acceptance for the current user (passive consent)."""
    user_id = get_current_user_id()
    body = await request.json()
    version = body.get("terms_version", "2026-05-07")
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET terms_accepted_at = now(), terms_version = %s WHERE user_id = %s",
            (version, user_id),
        )
    logger.info(f"[Auth] Terms accepted: user={user_id} version={version}")
    return {"accepted": True}


@router.delete("/user")
async def delete_user():
    """
    Delete the current user's entire data folder.
    Use with caution — primarily for test cleanup.
    """
    user_id = get_current_user_id()
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


# --- T405: Google OAuth + Session management (shared auth DB) ---

class GoogleAuthRequest(BaseModel):
    token: str
    ref: Optional[str] = None


class AuthResponse(BaseModel):
    email: str
    user_id: str


async def _verify_google_token(token: str) -> dict:
    """Verify a Google ID token and return its claims dict.

    Raises HTTPException on any verification failure.
    """
    try:
        from app.utils.retry import retry_async_call, TIER_1

        async def _call():
            async with httpx.AsyncClient(timeout=10.0) as client:
                return await client.get(
                    f"https://oauth2.googleapis.com/tokeninfo?id_token={token}"
                )

        resp = await retry_async_call(_call, operation="google_oauth", **TIER_1)
    except httpx.TimeoutException:
        raise HTTPException(status_code=503, detail="Google token verification timed out")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach Google: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    token_data = resp.json()

    expected_aud = os.getenv("GOOGLE_CLIENT_ID")
    if not expected_aud:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID not configured")
    if token_data.get("aud") != expected_aud:
        raise HTTPException(status_code=401, detail="Token audience mismatch")
    if not token_data.get("email") or token_data.get("email_verified") != "true":
        raise HTTPException(status_code=401, detail="Email not verified by Google")
    return token_data


def _find_or_create_user(email: str, *, google_id: str | None = None, ref: str | None = None) -> tuple[str, bool]:
    """Find a user row by email, or create a fresh one with a new UUID.

    Returns (user_id, is_new) where is_new indicates a freshly created account.
    """
    # Auto-reset NUF test accounts: wipe all data so login is always fresh.
    if email.lower() in NUF_RESET_EMAILS:
        existing_test = get_user_by_email(email)
        if existing_test:
            _reset_test_account(existing_test['user_id'], email)

    existing = get_user_by_email(email)
    if existing:
        user_id = existing['user_id']
        logger.info(f"[Auth] login — existing user: {user_id} ({email})")
        update_last_seen(user_id)
        return user_id, False

    user_id = generate_user_id()
    create_user(
        user_id,
        email=email,
        google_id=google_id,
        verified_at=datetime.utcnow().isoformat(),
    )
    attributed = False
    if ref:
        logger.info(f"[Auth] login — created user: {user_id} ({email}) referred_by={ref}")
        try:
            from app.services.sharing_db import resolve_invite_code, record_referral
            referrer_id = resolve_invite_code(ref)
            if referrer_id:
                attributed = record_referral(referrer_id, user_id, "invite_link", ref)
        except Exception:
            logger.warning(f"[Auth] referral attribution failed for ref={ref}", exc_info=True)
    else:
        logger.info(f"[Auth] login — created user: {user_id} ({email})")

    if not attributed:
        try:
            from app.services.sharing_db import attribute_from_existing_shares
            attribute_from_existing_shares(user_id, email)
        except Exception:
            logger.warning(f"[Auth] share-based attribution failed for {email}", exc_info=True)

    return user_id, True


def _get_origin_for_user(user_id: str) -> tuple[str, str | None]:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT channel FROM referrals WHERE referred_id = %s", (user_id,))
        row = cur.fetchone()
    if row:
        return "viral", row["channel"]
    return "organic", None


def _issue_session_cookie(user_id: str, payload: dict) -> JSONResponse:
    invalidate_user_sessions(user_id)
    session_id = create_session(user_id)
    response = JSONResponse(content=payload)
    _set_cookie(response, "rb_session", session_id)
    fly_machine_id = os.getenv("FLY_MACHINE_ID", "")
    if fly_machine_id:
        _set_cookie(response, "fly_machine_id", fly_machine_id)
    return response


@router.post("/google", response_model=AuthResponse)
async def google_auth(body: GoogleAuthRequest, request: Request):
    """Verify Google ID token, find-or-create user by email, issue session."""
    user_agent = request.headers.get("user-agent", "unknown")
    req_id = request.headers.get("x-request-id", "?")
    logger.info(f"[Auth] Google auth attempt: req_id={req_id}, ua={user_agent}")

    try:
        token_data = await _verify_google_token(body.token)
    except HTTPException:
        logger.warning(f"[Auth] Google token verification failed: req_id={req_id}, ua={user_agent}")
        raise

    email = token_data["email"]
    google_id = token_data.get("sub")
    logger.info(f"[Auth] Google token verified: email={email}, req_id={req_id}")

    user_id, is_new = _find_or_create_user(email, google_id=google_id, ref=body.ref)

    if is_new:
        origin_type, origin_channel = _get_origin_for_user(user_id)
        create_user_milestones(user_id, origin_type, origin_channel, signup_method="google")

    picture_url = token_data.get("picture")
    if picture_url:
        update_picture_url(user_id, picture_url)

    return _issue_session_cookie(
        user_id,
        {"email": email, "user_id": user_id, "picture_url": picture_url},
    )


@router.get("/me")
async def auth_me(request: Request):
    """
    Check if current session is valid. Called on app load.

    Returns user info if session cookie is valid, 401 if not.
    In dev/test: also accepts X-User-ID header (same as middleware fallback).
    """
    # E2E test bypass: X-User-ID header acts as valid auth (mirrors middleware behavior)
    # SECURITY: Only enabled in dev/staging -- never in production.
    if APP_ENV != "production":
        x_user_id = request.headers.get("X-User-ID")
        if x_user_id:
            sanitized = ''.join(c for c in x_user_id if c.isalnum() or c in '_-')
            if sanitized:
                logger.info(f"[Auth] /me: X-User-ID header bypass user={sanitized} (env={APP_ENV})")
                return {
                    "email": f"{sanitized}@test.local",
                    "user_id": sanitized,
                    "is_authenticated": True,
                    "picture_url": None,
                    "impersonator": None,
                }

    session_id = request.cookies.get("rb_session")
    if not session_id:
        logger.debug("[Auth] /me: no rb_session cookie")
        raise HTTPException(status_code=401, detail="No session")

    # Degrade to 401 on auth-DB transients. /me is the very first call on
    # every page load — a 500 here bricks the whole app; a 401 lets the
    # frontend fall through to the unauthenticated path.
    try:
        session = validate_session(session_id)
    except Exception:
        logger.exception("[Auth] /me: validate_session raised — degrading to 401")
        raise HTTPException(status_code=401, detail="Session check failed")

    if not session:
        logger.info("[Auth] /me: invalid/expired session")
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    user_id = session["user_id"]
    email = session.get("email")

    try:
        update_last_seen(user_id)
    except Exception:
        logger.exception(f"[Auth] /me: update_last_seen failed for user={user_id} (ignored)")

    is_pwa = request.headers.get("X-PWA") == "1"
    update_session(user_id, is_pwa=is_pwa)

    logger.info(f"[Auth] /me: valid session — user={user_id}, email={email}")

    picture_url = None
    needs_terms_acceptance = False
    try:
        user_record = get_user_by_id(user_id)
        if user_record:
            picture_url = user_record["picture_url"]
            needs_terms_acceptance = not user_record.get("terms_accepted_at")
    except Exception:
        logger.exception(f"[Auth] /me: get_user_by_id failed for user={user_id} (ignored)")

    # T1510: surface impersonation state so the frontend can show the banner.
    impersonator = None
    if session.get("impersonator_user_id"):
        impersonator = {
            "id": session["impersonator_user_id"],
            "email": session.get("impersonator_email"),
            "expires_at": session.get("impersonation_expires_at"),
        }

    return {
        "email": email,
        "user_id": user_id,
        "is_authenticated": True,
        "picture_url": picture_url,
        "impersonator": impersonator,
        "needs_terms_acceptance": needs_terms_acceptance,
    }


@router.post("/pwa-installed")
async def pwa_installed():
    """Record that the user installed the PWA."""
    user_id = get_current_user_id()
    record_milestone(user_id, "pwa_installed")
    return {"recorded": True}


# --- T401: Email OTP Auth ---

_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

_MAX_CODES_PER_HOUR = 3
_MAX_ATTEMPTS_PER_CODE = 5
_OTP_EXPIRY_MINUTES = 10


class SendOtpRequest(BaseModel):
    email: str


class VerifyOtpRequest(BaseModel):
    email: str
    code: str
    ref: Optional[str] = None


@router.post("/send-otp")
async def send_otp(body: SendOtpRequest, request: Request):
    """Generate a 6-digit OTP code and send it via email (Resend)."""
    user_agent = request.headers.get("user-agent", "unknown")
    req_id = request.headers.get("x-request-id", "?")
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        logger.warning(f"[Auth] OTP send rejected — invalid email: '{email}', req_id={req_id}, ua={user_agent}")
        raise HTTPException(status_code=400, detail="Invalid email address")

    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) as cnt FROM otp_codes WHERE email = %s AND created_at > now() - interval '1 hour'",
            (email,),
        )
        if cur.fetchone()["cnt"] >= _MAX_CODES_PER_HOUR:
            raise HTTPException(
                status_code=429,
                detail="Too many codes requested. Please try again later.",
            )

    code = str(secrets.randbelow(900000) + 100000)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=_OTP_EXPIRY_MINUTES)

    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO otp_codes (email, code, expires_at) VALUES (%s, %s, %s)",
            (email, code, expires_at),
        )

    from app.services.email import send_otp_email

    try:
        await send_otp_email(email, code)
    except ValueError:
        raise HTTPException(status_code=500, detail="Email service not configured")
    except Exception as e:
        logger.error(f"[Auth] Failed to send OTP email to {email}: {e}")
        raise HTTPException(status_code=503, detail="Failed to send email. Please try again.")

    logger.info(f"[Auth] OTP sent to {email}")
    return {"sent": True}


@router.post("/verify-otp")
async def verify_otp(body: VerifyOtpRequest, request: Request):
    """Verify a 6-digit OTP code, find-or-create user by email, issue session."""
    user_agent = request.headers.get("user-agent", "unknown")
    req_id = request.headers.get("x-request-id", "?")
    email = body.email.strip().lower()
    code = body.code.strip()

    if not _EMAIL_RE.match(email):
        logger.warning(f"[Auth] OTP verify rejected — invalid email: '{email}', req_id={req_id}, ua={user_agent}")
        raise HTTPException(status_code=400, detail="Invalid email address")

    if not re.match(r'^\d{6}$', code):
        logger.warning(f"[Auth] OTP verify rejected — invalid code format: '{code}', email={email}, req_id={req_id}, ua={user_agent}")
        raise HTTPException(status_code=400, detail="Invalid code format")

    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, code, expires_at, attempts
               FROM otp_codes
               WHERE email = %s AND used_at IS NULL
               ORDER BY created_at DESC LIMIT 1""",
            (email,),
        )
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=400, detail="No pending code. Please request a new one.")

    if row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code expired. Please request a new one.")

    if row["attempts"] >= _MAX_ATTEMPTS_PER_CODE:
        raise HTTPException(status_code=400, detail="Too many attempts. Please request a new code.")

    if row["code"] != code:
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE otp_codes SET attempts = attempts + 1 WHERE id = %s",
                (row["id"],),
            )
        remaining = _MAX_ATTEMPTS_PER_CODE - row["attempts"] - 1
        logger.warning(f"[Auth] OTP code mismatch for {email}: {remaining} attempts left, req_id={req_id}, ua={user_agent}")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.",
        )

    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE otp_codes SET used_at = now() WHERE id = %s",
            (row["id"],),
        )

    user_id, is_new = _find_or_create_user(email, ref=body.ref)
    logger.info(f"[Auth] OTP verified for {email}, user_id={user_id}, req_id={req_id}")

    if is_new:
        origin_type, origin_channel = _get_origin_for_user(user_id)
        create_user_milestones(user_id, origin_type, origin_channel, signup_method="otp")

    return _issue_session_cookie(
        user_id,
        {"email": email, "user_id": user_id, "picture_url": None},
    )


_active_vacuum_conns: dict[str, sqlite3.Connection] = {}
_users_who_archived: set[str] = set()


def mark_user_archived(user_id: str) -> None:
    """Record that this user archived a project during their session."""
    _users_who_archived.add(user_id)


def cancel_active_vacuum(user_id: str) -> None:
    """Interrupt any in-progress VACUUM for this user. Safe to call from any thread."""
    conn = _active_vacuum_conns.pop(user_id, None)
    if conn:
        logger.info(f"[Logout VACUUM] Interrupting active VACUUM for {user_id} (user logged back in)")
        conn.interrupt()


def _vacuum_user_dbs(user_id: str) -> None:
    """VACUUM all profile DBs for a user. Runs in a background thread."""
    profiles_dir = USER_DATA_BASE / user_id / "profiles"
    if not profiles_dir.exists():
        return
    for profile_dir in profiles_dir.iterdir():
        db_path = profile_dir / "profile.sqlite"
        if not db_path.is_file():
            continue
        try:
            size_before = db_path.stat().st_size
            conn = sqlite3.connect(str(db_path))
            _active_vacuum_conns[user_id] = conn
            conn.execute("VACUUM")
            _active_vacuum_conns.pop(user_id, None)
            conn.close()
            size_after = db_path.stat().st_size
            logger.info(
                f"[Logout VACUUM] {user_id}/{profile_dir.name}: "
                f"{size_before // 1024}KB -> {size_after // 1024}KB "
                f"({(size_before - size_after) // 1024}KB freed)"
            )
        except Exception as e:
            _active_vacuum_conns.pop(user_id, None)
            try:
                conn.close()
            except Exception:
                pass
            logger.warning(f"[Logout VACUUM] Failed for {user_id}/{profile_dir.name}: {e}")


@router.post("/logout")
async def logout(request: Request):
    """Invalidate current session and clear cookie."""
    session_id = request.cookies.get("rb_session")
    user_id = None
    if session_id:
        session = validate_session(session_id)
        if session:
            user_id = session["user_id"]
            invalidate_user_cache(user_id)
        invalidate_session(session_id)

    if user_id and user_id in _users_who_archived:
        _users_who_archived.discard(user_id)
        import asyncio
        asyncio.ensure_future(asyncio.to_thread(_vacuum_user_dbs, user_id))

    response = JSONResponse(content={"logged_out": True})
    _delete_cookie(response, "rb_session")
    return response


# --- T1650: Report a Problem ---

# Backend gate: set ENABLE_PROBLEM_REPORT=false to disable
_ENABLE_PROBLEM_REPORT = os.getenv("ENABLE_PROBLEM_REPORT", "true").lower() != "false"
_MAX_REPORTS_PER_HOUR = 20
# In-memory rate limit tracker: {ip_or_email: [timestamps]}
_report_rate_tracker: dict[str, list[datetime]] = {}


class ProblemReportRequest(BaseModel):
    logs: list[dict]   # [{level, message, ts}, ...]
    user_agent: str
    page_url: str
    email: str | None = None
    description: str | None = None
    screenshot: str | None = None  # base64 data URL (image/jpeg)
    build: str | None = None       # frontend commit hash
    actions: list[dict] | None = None  # [{action, detail, ts}, ...]
    editor_context: dict | None = None  # snapshot of editor state at report time


@router.post("/report-problem")
async def report_problem(body: ProblemReportRequest, request: Request):
    """Accept a client-side problem report: store in Postgres, upload assets to R2, send notification email.

    Gated by ENABLE_PROBLEM_REPORT env var (default: enabled).
    """
    if not _ENABLE_PROBLEM_REPORT:
        raise HTTPException(status_code=404, detail="Not found")

    req_id = request.headers.get("x-request-id", "?")

    # 1. Insert bug into Postgres
    import base64 as _b64
    from psycopg2.extras import Json
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO bug_reports
                (reporter_email, description, page_url, user_agent, build,
                 editor_context, actions, console_logs)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            body.email,
            body.description,
            body.page_url,
            body.user_agent,
            body.build,
            Json(body.editor_context) if body.editor_context is not None else None,
            Json(body.actions) if body.actions is not None else None,
            Json(body.logs) if body.logs is not None else None,
        ))
        bug_id = cur.fetchone()["id"]

        # 2. Upload screenshot to R2 if present
        from app.storage import get_r2_client, r2_global_key, R2_BUCKET
        from app.utils.retry import retry_r2_call, TIER_2
        import binascii

        screenshot_r2_key = None
        if body.screenshot and body.screenshot.startswith("data:image/"):
            try:
                parts = body.screenshot.split(",", 1)
                if len(parts) != 2 or not parts[1]:
                    logger.warning(f"[Auth] Bug screenshot has malformed data URL (no base64 payload), bug_id={bug_id}")
                else:
                    screenshot_bytes = _b64.b64decode(parts[1])
                    max_bytes = 10 * 1024 * 1024
                    if len(screenshot_bytes) > max_bytes:
                        from PIL import Image
                        from io import BytesIO
                        img = Image.open(BytesIO(screenshot_bytes))
                        quality = 60
                        while len(screenshot_bytes) > max_bytes and quality >= 10:
                            w, h = img.size
                            img = img.resize((w * 3 // 4, h * 3 // 4), Image.LANCZOS)
                            buf = BytesIO()
                            img.save(buf, format="JPEG", quality=quality)
                            screenshot_bytes = buf.getvalue()
                            quality -= 10
                        logger.info(f"[Auth] Bug screenshot downscaled to {len(screenshot_bytes) / (1024*1024):.1f}MB, bug_id={bug_id}")
                    client = get_r2_client()
                    if client:
                        key = r2_global_key(f"bugs/{bug_id}/screenshot.jpg")
                        retry_r2_call(
                            client.put_object,
                            Bucket=R2_BUCKET, Key=key,
                            Body=screenshot_bytes, ContentType="image/jpeg",
                            operation=f"bug_screenshot {bug_id}", **TIER_2,
                        )
                        screenshot_r2_key = key
            except binascii.Error as e:
                logger.warning(f"[Auth] Bug screenshot has invalid base64: {e}, bug_id={bug_id}")
            except Exception as e:
                error_type = type(e).__name__
                if "AccessDenied" in str(e) or "NoSuchBucket" in str(e):
                    logger.error(f"[Auth] R2 config error uploading bug screenshot: {error_type}: {e}, bug_id={bug_id}")
                else:
                    logger.error(f"[Auth] Bug screenshot upload failed after retries: {error_type}: {e}, bug_id={bug_id}")

        # 3. Upload formatted console logs to R2
        logs_r2_key = None
        if body.logs:
            try:
                from app.services.email import format_log_text
                log_text = format_log_text(body.logs)
                client = get_r2_client()
                if client:
                    key = r2_global_key(f"bugs/{bug_id}/console-logs.txt")
                    retry_r2_call(
                        client.put_object,
                        Bucket=R2_BUCKET, Key=key,
                        Body=log_text.encode("utf-8"), ContentType="text/plain",
                        operation=f"bug_logs {bug_id}", **TIER_2,
                    )
                    logs_r2_key = key
            except Exception as e:
                error_type = type(e).__name__
                if "AccessDenied" in str(e) or "NoSuchBucket" in str(e):
                    logger.error(f"[Auth] R2 config error uploading bug logs: {error_type}: {e}, bug_id={bug_id}")
                else:
                    logger.error(f"[Auth] Bug logs upload failed after retries: {error_type}: {e}, bug_id={bug_id}")

        # 4. Update row with R2 keys
        if screenshot_r2_key or logs_r2_key:
            cur.execute(
                "UPDATE bug_reports SET screenshot_r2_key = %s, logs_r2_key = %s WHERE id = %s",
                (screenshot_r2_key, logs_r2_key, bug_id),
            )

    logger.info(f"[Auth] Bug #{bug_id} reported: from={body.email or 'anonymous'}, "
                f"screenshot={'yes' if screenshot_r2_key else 'no'}, "
                f"logs={'yes' if logs_r2_key else 'no'}, "
                f"log_count={len(body.logs)}, req_id={req_id}")
    return {"sent": True, "bug_id": bug_id}


@router.post("/invalidate-sessions/{user_id}")
async def invalidate_sessions(user_id: str, request: Request):
    """Invalidate all sessions for a user. Dev/staging only.

    Called by reset scripts to flush the in-memory session cache
    so deleted users can't access data via stale cookies.
    """
    env = os.getenv("ENV", "development")
    if env == "production":
        raise HTTPException(status_code=404, detail="Not found")

    invalidate_user_sessions(user_id)
    logger.info(f"[Auth] Invalidated all sessions for user {user_id}")
    return {"invalidated": True, "user_id": user_id}


@router.post("/test-login")
async def test_login(request: Request):
    """E2E/QA test login — bypasses Google OAuth.

    Only available in development and staging environments (never production).
    Requires X-Test-Mode header.
    """
    env = os.getenv("ENV", "development")
    if env == "production":
        raise HTTPException(status_code=404, detail="Not found")

    test_mode = request.headers.get("x-test-mode")
    if not test_mode:
        raise HTTPException(status_code=403, detail="X-Test-Mode header required")

    email = "e2e@test.local"
    existing = get_user_by_email(email)
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = generate_user_id()
        create_user(user_id, email=email, verified_at=datetime.utcnow().isoformat())

    set_current_user_id(user_id)
    logger.info(f"[Auth] Test login for {user_id} ({email})")

    return _issue_session_cookie(
        user_id,
        {"email": email, "user_id": user_id},
    )
