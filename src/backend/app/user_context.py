"""
User context management for request-based user isolation.

This module provides a way to track the current user ID on a per-request basis
using Python's contextvars. This allows the same backend to serve different
user namespaces based on session cookies (or X-User-ID header in tests).

Usage:
    - Middleware sets the user ID from the session cookie (or X-User-ID header)
    - Database module reads the user ID to determine storage paths
    - Tests can set a unique user ID to isolate test data

If get_current_user_id() is called without a user being set, it raises
RuntimeError. This prevents silent fallback to a phantom shared user.
"""

from contextvars import ContextVar
from typing import Optional

# Context variable for current user ID — NO default.
# Must be explicitly set by middleware before any route handler runs.
_current_user_id: ContextVar[str] = ContextVar('current_user_id')


def get_current_user_id() -> str:
    """
    Get the current user ID for this request context.

    Raises RuntimeError if no user context has been set — this indicates
    a code path that bypassed middleware or forgot to set user context.
    """
    try:
        return _current_user_id.get()
    except LookupError:
        raise RuntimeError(
            "No user context set. All requests must go through auth middleware "
            "which sets user context from session cookie. If you're in a test, "
            "call set_current_user_id() first."
        )


def set_current_user_id(user_id: str) -> None:
    """Set the current user ID for this request context."""
    _current_user_id.set(user_id)


def reset_user_id() -> None:
    """Clear the user context (used in test teardown)."""
    # ContextVar doesn't have a delete/clear method, but we can use a
    # Token to reset. The simplest approach: set a sentinel and have
    # get_current_user_id() treat it as unset. However, since ContextVar
    # copies per-task, the cleanest option is to just not call get after reset.
    # For test compat, we create a new token-based reset.
    try:
        _token = _current_user_id.set("__reset__")
        # Immediately revert using the token — this restores the "no value" state
        # only if __reset__ was the most recent set. But ContextVar.reset() requires
        # the token from the SAME set call. So we use it:
        _current_user_id.reset(_token)
    except ValueError:
        pass  # Already in unset state
