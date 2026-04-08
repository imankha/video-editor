"""
Request Context Middleware — user context + database sync.

Combines user/profile context setup with R2 database synchronization in a
SINGLE BaseHTTPMiddleware. This is critical because BaseHTTPMiddleware's
call_next() copies the asyncio context for the inner app. If user context
and sync were in separate BaseHTTPMiddleware classes, ContextVar changes
(user_id, profile_id) set in one middleware would be invisible to the other
after call_next() returns. By combining them, all ContextVar reads/writes
happen in the same context — before and after a single call_next() boundary.

Flow:
1. Resolve user_id: rb_session cookie → auth DB → user_id (T405)
   Fallback: X-User-ID header (backward compat for tests/dev)
2. If no user_id and path is not allowlisted → 401
3. Set profile_id from header (or session init)
4. Initialize write tracking context (mutable dict)
5. call_next() — route handler runs, may write to DB
6. Check mutable dict for writes, sync to R2 if needed
7. Clean up context

Also tracks sync failure state per user and surfaces it via X-Sync-Status
header so the frontend can show a warning indicator.
"""

import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from ..database import (
    init_request_context,
    clear_request_context,
    sync_db_to_cloud_if_writes,
    sync_user_db_to_cloud_if_writes,
    sync_db_to_r2_explicit,
    sync_user_db_to_r2_explicit,
    get_request_has_writes,
    get_request_has_user_db_writes,
    mark_sync_pending,
    clear_sync_pending,
    has_sync_pending,
)
from ..profile_context import set_current_profile_id, get_current_profile_id
from ..session_init import user_session_init
from ..services.auth_db import validate_session
from ..storage import R2_ENABLED
from ..user_context import set_current_user_id, get_current_user_id

logger = logging.getLogger(__name__)

PROFILING_ENABLED = os.getenv("PROFILING_ENABLED", "false").lower() == "true"

# Thresholds for slow request warnings (in seconds)
SLOW_SYNC_THRESHOLD = 0.5  # 500ms - warn if DB sync takes this long
SLOW_REQUEST_THRESHOLD = 0.2  # 200ms - warn if total request takes this long (profiling target)

# In-memory sync failure tracking per user.
# Set to True when R2 upload fails; cleared on next successful sync.
_sync_failed: dict[str, bool] = {}


def is_sync_failed(user_id: str) -> bool:
    """Check if the given user has a pending sync failure."""
    return _sync_failed.get(user_id, False)


def set_sync_failed(user_id: str, failed: bool) -> None:
    """Set or clear the sync failure flag for a user."""
    was_failed = _sync_failed.get(user_id, False)
    if failed:
        _sync_failed[user_id] = True
        if not was_failed:
            logger.warning(f"[SYNC] User {user_id} entered degraded state — R2 sync failed")
    else:
        _sync_failed.pop(user_id, None)
        if was_failed:
            logger.info(f"[SYNC] User {user_id} recovered — R2 sync succeeded")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """
    Combined middleware for user context setup and R2 database sync.

    Merges UserContextMiddleware and DatabaseSyncMiddleware into one class
    to avoid ContextVar isolation across BaseHTTPMiddleware boundaries.
    """

    # Skip sync for these path prefixes (static files, health checks, auth, etc.)
    SKIP_SYNC_PATHS = (
        '/docs',
        '/redoc',
        '/openapi.json',
        '/api/health',
        '/api/auth',
        '/static',
    )

    # T450: Routes that work WITHOUT prior user context (they establish it).
    # These get passed through even when no session cookie or X-User-ID is present.
    AUTH_ALLOWLIST_PREFIXES = (
        '/api/auth/',      # All auth sub-routes (init-guest, google, email/*, me, logout, retry-migration)
        '/api/health',     # Health check
        '/docs',           # API docs
        '/redoc',          # API docs
        '/openapi.json',   # OpenAPI spec
    )

    def _is_allowlisted(self, request: Request) -> bool:
        """Check if this request can proceed without user context."""
        # OPTIONS preflight never needs user context
        if request.method == "OPTIONS":
            return True
        path = request.url.path
        return any(path.startswith(prefix) for prefix in self.AUTH_ALLOWLIST_PREFIXES)

    async def dispatch(self, request: Request, call_next) -> Response:
        """Set user context, process request, sync DB if writes occurred."""

        # --- User context setup (T405: cookie-first, header-fallback) ---
        user_id = None
        auth_source = "none"

        # 1. Try session cookie → central auth DB
        session_id = request.cookies.get("rb_session")
        if session_id:
            session = validate_session(session_id)
            if session:
                user_id = session["user_id"]
                auth_source = "session"

        # 2. Fallback: X-User-ID header (backward compat for dev/tests)
        if not user_id:
            raw_user_id = request.headers.get('X-User-ID')
            if raw_user_id:
                sanitized = ''.join(c for c in raw_user_id if c.isalnum() or c in '_-')
                if sanitized:
                    user_id = sanitized
                    auth_source = "header"

        # 3. T450: No default fallback — if no user and not allowlisted, reject
        if not user_id:
            if self._is_allowlisted(request):
                # Auth/health endpoints proceed without user context
                logger.info(
                    f"[REQ] {request.method} {request.url.path} | "
                    f"user=none (allowlisted) | "
                    f"origin={request.headers.get('origin', '-')}"
                )
                return await call_next(request)
            else:
                logger.warning(
                    f"[REQ] {request.method} {request.url.path} | "
                    f"REJECTED — no session cookie or X-User-ID | "
                    f"origin={request.headers.get('origin', '-')}"
                )
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication required. Please refresh the page to initialize a session."},
                )

        logger.info(
            f"[REQ] {request.method} {request.url.path} | "
            f"user={user_id} (via {auth_source}) | "
            f"origin={request.headers.get('origin', '-')}"
        )

        set_current_user_id(user_id)

        profile_id = request.headers.get('X-Profile-ID')
        if profile_id and re.match(r'^[a-f0-9]{8}$', profile_id):
            set_current_profile_id(profile_id)
        else:
            if profile_id:
                logger.warning(f"Invalid X-Profile-ID format: '{profile_id}', falling back to session init")
            user_session_init(user_id)

        # --- Skip sync for certain paths ---
        should_sync = R2_ENABLED and not any(
            request.url.path.startswith(prefix) for prefix in self.SKIP_SYNC_PATHS
        )

        if not should_sync:
            return await call_next(request)

        # --- T930: Retry pending sync from previous failed request ---
        if has_sync_pending(user_id):
            logger.info(f"[SYNC] Retrying pending sync for user {user_id}")
            try:
                retry_ok = sync_db_to_cloud_if_writes()
                user_retry_ok = sync_user_db_to_cloud_if_writes()
                if (retry_ok == "ok" or retry_ok is True) and user_retry_ok:
                    clear_sync_pending(user_id)
                    set_sync_failed(user_id, False)
                    logger.info(f"[SYNC] Retry succeeded for user {user_id}")
                else:
                    logger.warning(f"[SYNC] Retry still failing for user {user_id}")
            except Exception as e:
                logger.warning(f"[SYNC] Retry failed for user {user_id}: {e}")

        # --- Request with sync tracking ---
        request_start = time.perf_counter()
        sync_duration = 0.0

        try:
            # Initialize request context for write tracking
            init_request_context()

            # Process the request
            response = await call_next(request)

            # After request, sync if writes occurred
            had_writes = get_request_has_writes()
            had_user_db_writes = get_request_has_user_db_writes()
            if had_writes or had_user_db_writes:
                # T930: Mark pending BEFORE sync attempt — survives crash
                mark_sync_pending(user_id)

                sync_start = time.perf_counter()
                sync_status = "ok"
                try:
                    if had_writes and had_user_db_writes:
                        # Both need syncing — run in parallel using explicit
                        # functions that take args instead of relying on ContextVars
                        _user_id = get_current_user_id()
                        _profile_id = get_current_profile_id()
                        timing = {}

                        def _sync_profile():
                            t0 = time.perf_counter()
                            result = sync_db_to_r2_explicit(_user_id, _profile_id)
                            timing['profile_ms'] = (time.perf_counter() - t0) * 1000
                            return result

                        def _sync_user():
                            t0 = time.perf_counter()
                            result = sync_user_db_to_r2_explicit(_user_id)
                            timing['user_ms'] = (time.perf_counter() - t0) * 1000
                            return result

                        with ThreadPoolExecutor(max_workers=2) as executor:
                            profile_future = executor.submit(_sync_profile)
                            user_future = executor.submit(_sync_user)
                            profile_ok = profile_future.result()
                            user_ok = user_future.result()

                        # Map explicit sync return values to middleware expectations
                        db_status = "ok" if profile_ok else "failed"
                        user_sync_success = user_ok

                        if PROFILING_ENABLED:
                            parallel_ms = (time.perf_counter() - sync_start) * 1000
                            p_ms = timing.get('profile_ms', 0)
                            u_ms = timing.get('user_ms', 0)
                            logger.info(
                                f"[PROFILE] R2 sync: {parallel_ms:.0f}ms parallel "
                                f"(would be {p_ms + u_ms:.0f}ms sequential: "
                                f"profile: {p_ms:.0f}ms + user: {u_ms:.0f}ms)"
                            )
                    elif had_writes:
                        db_status = sync_db_to_cloud_if_writes()
                        user_sync_success = True
                    else:
                        # had_user_db_writes only
                        db_status = "ok"
                        user_sync_success = sync_user_db_to_cloud_if_writes()

                    if db_status == "conflict":
                        sync_status = "conflict"
                    elif db_status == "failed" or not user_sync_success:
                        sync_status = "failed"
                except Exception as sync_error:
                    logger.error(f"Sync to R2 raised exception: {sync_error}")
                    sync_status = "failed"
                sync_duration = time.perf_counter() - sync_start

                if sync_status == "ok":
                    clear_sync_pending(user_id)  # T930: Only clear on success
                    set_sync_failed(user_id, False)
                    logger.info(f"[SYNC] {request.method} {request.url.path} → R2 sync OK ({sync_duration:.2f}s)")
                elif sync_status == "conflict":
                    set_sync_failed(user_id, True)
                    logger.warning(f"[SYNC] {request.method} {request.url.path} → version conflict ({sync_duration:.2f}s)")
                else:
                    set_sync_failed(user_id, True)
                    logger.warning(f"[SYNC] {request.method} {request.url.path} → R2 sync FAILED ({sync_duration:.2f}s)")

            # T950: Distinguish conflict from failure in header
            if is_sync_failed(user_id):
                response.headers["X-Sync-Status"] = sync_status if (had_writes or had_user_db_writes) else "failed"

            return response

        except Exception as e:
            # On exception, still try to sync (changes may have been committed)
            try:
                had_writes = get_request_has_writes()
                had_user_db_writes = get_request_has_user_db_writes()
                if had_writes or had_user_db_writes:
                    sync_start = time.perf_counter()
                    try:
                        db_status = sync_db_to_cloud_if_writes()
                        user_sync_success = sync_user_db_to_cloud_if_writes()
                        overall_ok = (db_status == "ok") and user_sync_success
                    except Exception as sync_error:
                        logger.error(f"Sync to R2 raised exception after request error: {sync_error}")
                        overall_ok = False
                    sync_duration = time.perf_counter() - sync_start

                    set_sync_failed(user_id, not overall_ok)
            except Exception as tracking_error:
                logger.error(f"Failed to track sync state after error: {tracking_error}")

            # Re-raise the original exception
            raise

        finally:
            # Always clean up request context
            clear_request_context()

            # Log warnings for slow operations
            total_duration = time.perf_counter() - request_start
            path = request.url.path
            method = request.method

            if sync_duration >= SLOW_SYNC_THRESHOLD:
                logger.warning(
                    f"[SLOW DB SYNC] {method} {path} - sync took {sync_duration:.2f}s "
                    f"(threshold: {SLOW_SYNC_THRESHOLD}s). Consider background sync."
                )

            if total_duration >= SLOW_REQUEST_THRESHOLD:
                logger.warning(
                    f"[SLOW REQUEST] {method} {path} - total {total_duration:.2f}s "
                    f"(sync: {sync_duration:.2f}s, handler: {total_duration - sync_duration:.2f}s)"
                )


# Keep old name for backward compatibility with imports
DatabaseSyncMiddleware = RequestContextMiddleware
