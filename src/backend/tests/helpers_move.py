"""Shared test helper for direct (non-DI) calls to the move-to-profile handlers.

T6350 gave `move_reels_to_profile` / `finish_move_reels_to_profile` a
`request: Request` param so they can register the truthful
`move_source_cleanup_failed` 503 body on `request.state` (read by the middleware,
bypassed when a test calls the handler function directly). A namespace with a
settable `.state` is all a direct call needs. Centralised here because several test
modules construct this same fake request.
"""

from types import SimpleNamespace


def make_move_request():
    """A minimal stand-in Request whose `.state` accepts attribute assignment."""
    return SimpleNamespace(state=SimpleNamespace())
