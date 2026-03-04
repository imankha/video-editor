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
1. Set user_id and profile_id from headers (or session init)
2. Initialize write tracking context (mutable dict)
3. call_next() — route handler runs, may write to DB
4. Check mutable dict for writes, sync to R2 if needed
5. Clean up context

Also tracks sync failure state per user and surfaces it via X-Sync-Status
header so the frontend can show a warning indicator.
"""

import logging
import re
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from ..constants import DEFAULT_USER_ID
from ..database import (
    init_request_context,
    clear_request_context,
    sync_db_to_cloud_if_writes,
    get_request_has_writes,
)
from ..profile_context import set_current_profile_id
from ..session_init import user_session_init
from ..storage import R2_ENABLED
from ..user_context import set_current_user_id

logger = logging.getLogger(__name__)

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

    async def dispatch(self, request: Request, call_next) -> Response:
        """Set user context, process request, sync DB if writes occurred."""

        # --- User context setup ---
        user_id = request.headers.get('X-User-ID', DEFAULT_USER_ID)
        sanitized = ''.join(c for c in user_id if c.isalnum() or c in '_-')
        if not sanitized:
            sanitized = DEFAULT_USER_ID

        set_current_user_id(sanitized)

        profile_id = request.headers.get('X-Profile-ID')
        if profile_id and re.match(r'^[a-f0-9]{8}$', profile_id):
            set_current_profile_id(profile_id)
        else:
            if profile_id:
                logger.warning(f"Invalid X-Profile-ID format: '{profile_id}', falling back to session init")
            user_session_init(sanitized)

        # --- Skip sync for certain paths ---
        should_sync = R2_ENABLED and not any(
            request.url.path.startswith(prefix) for prefix in self.SKIP_SYNC_PATHS
        )

        if not should_sync:
            return await call_next(request)

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
            if had_writes:
                sync_start = time.perf_counter()
                try:
                    sync_success = sync_db_to_cloud_if_writes()
                except Exception as sync_error:
                    logger.error(f"Sync to R2 raised exception: {sync_error}")
                    sync_success = False
                sync_duration = time.perf_counter() - sync_start

                set_sync_failed(sanitized, not sync_success)

                if sync_success:
                    logger.info(f"[SYNC] {request.method} {request.url.path} → R2 sync OK ({sync_duration:.2f}s)")
                else:
                    logger.warning(f"[SYNC] {request.method} {request.url.path} → R2 sync FAILED ({sync_duration:.2f}s)")

            # Add X-Sync-Status header if this user has a pending sync failure
            if is_sync_failed(sanitized):
                response.headers["X-Sync-Status"] = "failed"

            return response

        except Exception as e:
            # On exception, still try to sync (changes may have been committed)
            try:
                had_writes = get_request_has_writes()
                if had_writes:
                    sync_start = time.perf_counter()
                    try:
                        sync_success = sync_db_to_cloud_if_writes()
                    except Exception as sync_error:
                        logger.error(f"Sync to R2 raised exception after request error: {sync_error}")
                        sync_success = False
                    sync_duration = time.perf_counter() - sync_start

                    set_sync_failed(sanitized, not sync_success)
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
