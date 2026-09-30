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

from contextvars import ContextVar, Token
from typing import cast

_UNSET = object()
_current_user_id: ContextVar[str | object] = ContextVar(
    'current_user_id', default=_UNSET
)

# Request-id ContextVar. Set by middleware from the X-Request-ID header so
# downstream log lines (R2_CALL, session-init restores, slow DB queries) can
# all be correlated to the originating HTTP request.
_current_req_id: ContextVar[str] = ContextVar('current_req_id', default='')

_current_platform: ContextVar[str] = ContextVar('current_platform', default='unknown')

# T6390: the request method + path, set by middleware alongside req_id, so the
# sync-conflict diagnostics (marker payload + the storage.py [SYNC_CONFLICT] CRITICAL)
# can name the gesture that hit a CAS refusal without threading them through the
# background-sync call chain. Background workers leave these empty (honest — there is
# no request), never a fabricated value.
_current_method: ContextVar[str] = ContextVar('current_method', default='')
_current_path: ContextVar[str] = ContextVar('current_path', default='')

# T1515: when an admin is impersonating a user ("Login as User"), this holds the
# admin's user_id for the request. Analytics writers check it to skip recording so
# impersonation leaves no footprint on the impersonated user's activity data.
_current_impersonator_id: ContextVar[str | None] = ContextVar(
    'current_impersonator_id', default=None
)


def get_current_impersonator_id() -> str | None:
    """Return the impersonating admin's user_id, or None if not impersonating."""
    return _current_impersonator_id.get()


def set_current_impersonator_id(impersonator_id: str | None) -> None:
    """Set (or clear) the impersonator id for this request context."""
    _current_impersonator_id.set(impersonator_id or None)


def get_current_req_id() -> str:
    """Return the request id for the current context, or '' if none set."""
    return _current_req_id.get()


def set_current_req_id(req_id: str) -> None:
    """Set the request id for this request context."""
    _current_req_id.set(req_id or '')


def get_current_platform() -> str:
    return _current_platform.get()


def get_current_method() -> str:
    """Request method for the current context, or '' outside a request (T6390)."""
    return _current_method.get()


def set_current_method(method: str) -> None:
    _current_method.set(method or '')


def get_current_path() -> str:
    """Request path for the current context, or '' outside a request (T6390)."""
    return _current_path.get()


def set_current_path(path: str) -> None:
    _current_path.set(path or '')


_VALID_PLATFORMS = {'pwa-mobile', 'pwa-desktop', 'webapp-mobile', 'webapp-desktop'}


def set_current_platform(platform: str) -> None:
    _current_platform.set(platform if platform in _VALID_PLATFORMS else 'unknown')


def get_current_user_id() -> str:
    """
    Get the current user ID for this request context.

    Raises RuntimeError if no user context has been set — this indicates
    a code path that bypassed middleware or forgot to set user context.
    """
    value = _current_user_id.get()
    if value is _UNSET:
        raise RuntimeError(
            "No user context set. All requests must go through auth middleware "
            "which sets user context from session cookie. If you're in a test, "
            "call set_current_user_id() first."
        )
    return cast(str, value)


def set_current_user_id(user_id: str) -> Token:
    """Set the current user ID for this request context.

    Returns the ContextVar Token so a caller that temporarily points the
    context at ANOTHER user's DB (T5085: the JIT seam running for a foreign
    profile — share resolution, admin cross-user reads) can restore the
    prior value with reset_user_id_token() in a finally block. Existing
    callers that set-and-forget can ignore the return value.
    """
    return _current_user_id.set(user_id)


def reset_user_id_token(token: Token) -> None:
    """Restore the user id to the value captured before set_current_user_id().

    Unlike reset_user_id() (test-only, always clears to unset), this restores
    whatever the prior value was — including "no value", which Token.reset()
    handles correctly since ContextVar.set() was never called on this task
    before the token's set() call."""
    _current_user_id.reset(token)


def reset_user_id() -> None:
    """Clear the user context (used in test teardown)."""
    _current_user_id.set(_UNSET)
