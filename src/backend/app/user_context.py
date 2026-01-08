"""
User context management for request-based user isolation.

This module provides a way to track the current user ID on a per-request basis
using Python's contextvars. This allows the same backend to serve different
user namespaces based on the X-User-ID header.

Usage:
    - Middleware sets the user ID from the X-User-ID header
    - Database module reads the user ID to determine storage paths
    - Tests can set a unique user ID to isolate test data
"""

from contextvars import ContextVar
from typing import Optional

from .constants import DEFAULT_USER_ID

# Context variable for current user ID
# Uses DEFAULT_USER_ID when no user is set (normal development)
_current_user_id: ContextVar[str] = ContextVar('current_user_id', default=DEFAULT_USER_ID)


def get_current_user_id() -> str:
    """Get the current user ID for this request context."""
    return _current_user_id.get()


def set_current_user_id(user_id: str) -> None:
    """Set the current user ID for this request context."""
    _current_user_id.set(user_id)


def reset_user_id() -> None:
    """Reset to default user ID."""
    _current_user_id.set(DEFAULT_USER_ID)
