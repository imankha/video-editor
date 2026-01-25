"""
Middleware package for Video Editor API.

Contains FastAPI middleware for cross-cutting concerns:
- DatabaseSyncMiddleware: Handles R2 database sync at request boundaries
"""

from .db_sync import DatabaseSyncMiddleware

__all__ = ['DatabaseSyncMiddleware']
