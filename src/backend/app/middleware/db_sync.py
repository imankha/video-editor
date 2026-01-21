"""
Database Sync Middleware for R2 storage.

Handles database synchronization at request boundaries:
- Start of request: Check if R2 has newer database version
- End of request: Sync to R2 if writes occurred

This enables batched syncing - multiple database writes in a single request
result in only one R2 upload, reducing latency and API calls.
"""

import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from ..database import (
    init_request_context,
    clear_request_context,
    sync_db_to_cloud_if_writes,
)
from ..storage import R2_ENABLED

logger = logging.getLogger(__name__)


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

        try:
            # Initialize request context for write tracking
            init_request_context()

            # Process the request
            response = await call_next(request)

            # After successful request, sync if writes occurred
            # Note: We sync even on error responses because the database
            # changes may have been committed before the error
            sync_db_to_cloud_if_writes()

            return response

        except Exception as e:
            # On exception, still try to sync (changes may have been committed)
            try:
                sync_db_to_cloud_if_writes()
            except Exception as sync_error:
                logger.error(f"Failed to sync database after error: {sync_error}")

            # Re-raise the original exception
            raise

        finally:
            # Always clean up request context
            clear_request_context()
