"""T6200: the ONE way to run blocking I/O off the event loop from a request.

The request path runs in a single-worker uvicorn process with a single asyncio
event loop. Any blocking call (psycopg2, sqlite3, R2/boto3) made directly on the
loop stalls EVERY other in-flight request and, worse, prevents uvicorn from
flushing any already-finished response until it returns — so a concurrent burst
serializes and drains together (the T6200 HAR fingerprint). The fix is to offload
blocking work to a worker thread; psycopg2 and sqlite3 release the GIL during
their I/O, so offloaded calls genuinely overlap.

`run_in_context` is the greppable primitive for handler-body offloads. Unlike a
bare `asyncio.to_thread`, it copies the request's contextvars into the worker
thread, so `get_current_user_id()` / `get_current_profile_id()` / the req-id
resolve there instead of raising "No user context set" (the bootstrap.py
landmine — see .claude/knowledge/backend-services.md). Use it for any blocking
function that reads request context. A call that takes NO context (e.g.
`validate_session(session_id)` run before the user context is even set) can use a
bare `asyncio.to_thread` directly.
"""
from __future__ import annotations

import asyncio
import contextvars
from collections.abc import Callable
from typing import TypeVar

_T = TypeVar("_T")


async def run_in_context(fn: Callable[..., _T], *args) -> _T:
    """Run a blocking `fn(*args)` on a worker thread WITH the caller's contextvars.

    Copies the current context so `get_current_*()` resolve inside the thread,
    then submits to the loop's default executor (T6200 sets a bounded I/O pool in
    lifespan()). Awaitable: the event loop stays free while the thread runs.
    """
    ctx = contextvars.copy_context()
    return await asyncio.to_thread(ctx.run, fn, *args)
