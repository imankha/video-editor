"""
Middleware package for Video Editor API.

Contains FastAPI middleware for cross-cutting concerns:
- RequestContextMiddleware: User context setup + R2 database sync (combined)
"""

from .db_sync import RequestContextMiddleware, DatabaseSyncMiddleware

__all__ = ['RequestContextMiddleware', 'DatabaseSyncMiddleware']
