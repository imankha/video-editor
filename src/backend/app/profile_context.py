"""
Profile context management for request-based profile isolation.

This module provides a way to track the current profile ID on a per-request basis
using Python's contextvars. The profile ID determines which subdirectory of the
user's R2 namespace is used for data storage.

The profile is loaded once via /api/auth/init, and the frontend sends it as
X-Profile-ID header on all subsequent requests.

Usage:
    - /api/auth/init calls user_session_init() which sets the profile
    - UserContextMiddleware reads X-Profile-ID header and sets it per-request
    - storage.py reads it via get_current_profile_id() to construct R2 keys
    - database.py reads it via get_current_profile_id() to construct local paths
"""

from contextvars import ContextVar, Token

# Context variable for current profile ID
# Default is None — get_current_profile_id() raises if not set,
# ensuring any code path that runs before /api/auth/init fails loudly.
_current_profile_id: ContextVar[str | None] = ContextVar('current_profile_id', default=None)


def get_current_profile_id() -> str:
    """Get the current profile ID for this request context.

    Raises RuntimeError if profile ID has not been set. This means either:
    - The frontend hasn't called /api/auth/init yet
    - The X-Profile-ID header is missing from the request
    - A test forgot to call set_current_profile_id()
    """
    value = _current_profile_id.get()
    if value is None:
        raise RuntimeError(
            "Profile ID not set — call /api/auth/init first, "
            "or set X-Profile-ID header on the request"
        )
    return value


def set_current_profile_id(profile_id: str) -> Token:
    """Set the current profile ID for this request context.

    Returns the ContextVar Token so a caller that temporarily overrides the
    profile (e.g. resolving another user's share against their profile DB) can
    restore the prior value with reset_profile_id_token() in a finally block.
    Existing callers that set-and-forget can ignore the return value.
    """
    return _current_profile_id.set(profile_id)


def reset_profile_id_token(token: Token) -> None:
    """Restore the profile ID to the value captured before set_current_profile_id().

    ContextVars are task-local, so this never leaks across requests; the token
    restores whatever the prior value was (another profile, or unset/None)."""
    _current_profile_id.reset(token)


def reset_profile_id() -> None:
    """Reset profile ID to None (unset)."""
    _current_profile_id.set(None)
