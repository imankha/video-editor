"""
Database Sync Middleware for R2 storage.

Handles database synchronization at request boundaries:
- Start of request: Check if R2 has newer database version
- End of request: Sync to R2 if writes occurred

This enables batched syncing - multiple database writes in a single request
result in only one R2 upload, reducing latency and API calls.

Also tracks sync failure state per user and surfaces it via X-Sync-Status header
so the frontend can show a warning indicator (T87).
"""

import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from ..database import (
    init_request_context,
    clear_request_context,
    sync_db_to_cloud_if_writes,
    get_request_has_writes,
)
from ..storage import R2_ENABLED
from ..user_context import get_current_user_id

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
    if failed:
        _sync_failed[user_id] = True
    else:
        _sync_failed.pop(user_id, None)


class DatabaseSyncMiddleware(BaseHTTPMiddleware):
    """
    Middleware that manages database synchronization with R2 at request boundaries.

    On each request:
    1. Initialize request context for write tracking
    2. Process the request (database operations may occur)
    3. If writes occurred, sync database to R2
    4. Clean up request context

    This ensures:
    - Multiple writes in a request = single R2 upload
    - No sync overhead for read-only requests
    - Consistent state across requests

    Additionally tracks sync failures per user and returns X-Sync-Status: failed
    header when the user's database is out of sync with R2.
    """

    # Skip sync for these path prefixes (static files, health checks, etc.)
    SKIP_PATHS = (
        '/docs',
        '/redoc',
        '/openapi.json',
        '/api/health',
        '/static',
    )

    async def dispatch(self, request: Request, call_next) -> Response:
        """Process request with database sync at boundaries."""

        # Skip middleware for paths that don't use the database
        if any(request.url.path.startswith(prefix) for prefix in self.SKIP_PATHS):
            return await call_next(request)

        # Skip if R2 is not enabled
        if not R2_ENABLED:
            return await call_next(request)

        request_start = time.perf_counter()
        sync_duration = 0.0

        try:
            # Initialize request context for write tracking
            init_request_context()

            # Process the request
            response = await call_next(request)

            # After successful request, sync if writes occurred
            # Note: We sync even on error responses because the database
            # changes may have been committed before the error
            had_writes = get_request_has_writes()
            if had_writes:
                sync_start = time.perf_counter()
                try:
                    sync_success = sync_db_to_cloud_if_writes()
                except Exception as sync_error:
                    logger.error(f"Sync to R2 raised exception: {sync_error}")
                    sync_success = False
                sync_duration = time.perf_counter() - sync_start

                user_id = get_current_user_id()
                set_sync_failed(user_id, not sync_success)

            # Add X-Sync-Status header if this user has a pending sync failure
            user_id = get_current_user_id()
            if is_sync_failed(user_id):
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

                    user_id = get_current_user_id()
                    set_sync_failed(user_id, not sync_success)
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
