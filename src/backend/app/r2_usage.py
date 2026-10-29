"""T13930: attribute every server-side R2 call to the app activity that issued it.

A ContextVar names the issuer ("source"):
  - a request: its matched route TEMPLATE (`PUT /api/clips/raw/{clip_id}`), set by
    RequestContextMiddleware.dispatch -- never the raw path, so no ids reach the keys;
  - background work: an R2Source literal, set where the unit of work starts;
  - anything else: `untagged`, which is itself the signal that an issuer needs a tag.

storage._register_r2_timing's after-call hook reads it, logs `source=` on [R2_CALL], and
calls record_r2_call, which increments an in-memory (day, env, source, op_class, op)
counter -- memory only, no I/O on the R2 hot path. app.services.analytics_store drains
the buffer into analytics.sqlite.

Leaf module: no app imports, so storage.py can import it without cycles.
"""

import functools
import inspect
import logging
import threading
from collections import defaultdict
from contextvars import ContextVar
from datetime import UTC, datetime
from enum import Enum

from starlette.routing import Match, Mount

logger = logging.getLogger(__name__)


class R2Source(str, Enum):
    UNTAGGED = "untagged"
    UNMATCHED = "unmatched"  # a request no route matched (404): never the raw path
    SWEEP = "sweep"
    EXPORT_WORKER = "export_worker"
    POSTER_WARMER = "poster_warmer"
    PENDING_SHARE = "pending_share_materialize"
    SHUTDOWN_SYNC = "shutdown_sync"
    ANALYTICS_STORE = "analytics_store"
    R2_USAGE_ALERT = "r2_usage_alert"


class OpClass(str, Enum):
    A = "A"
    B = "B"
    FREE = "free"
    UNCLASSIFIED = "unclassified"


# botocore operation name -> Cloudflare R2 pricing class.
OP_CLASS: dict[str, OpClass] = {
    **{op: OpClass.A for op in (
        "ListBuckets", "CreateBucket", "ListObjects", "ListObjectsV2", "PutObject",
        "CopyObject", "CreateMultipartUpload", "UploadPart", "UploadPartCopy",
        "CompleteMultipartUpload", "ListMultipartUploads", "ListParts", "PutBucketCors",
        "PutBucketLifecycleConfiguration", "PutBucketEncryption",
    )},
    **{op: OpClass.B for op in (
        "HeadObject", "GetObject", "HeadBucket", "GetBucketCors", "GetBucketLocation",
        "GetBucketLifecycleConfiguration", "GetBucketEncryption",
    )},
    # Cloudflare lists deletes as free; batch DeleteObjects is not named explicitly.
    **{op: OpClass.FREE for op in (
        "DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload",
    )},
}

_current_r2_source: ContextVar[str] = ContextVar("current_r2_source", default=R2Source.UNTAGGED.value)


def get_r2_source() -> str:
    return _current_r2_source.get()


def set_r2_source(source: str) -> None:
    """Plain set: only for a caller that owns a fresh context (the request middleware,
    a fresh contextvars.Context). Background work uses r2_source_scope."""
    _current_r2_source.set(str(getattr(source, "value", source)))


class r2_source_scope:
    """Set the source for a block, resetting it afterwards so it cannot leak into later
    work on the same thread/task. Usable as `with r2_source_scope(...)` or as a
    decorator on a sync or async function."""

    def __init__(self, source: str):
        self._source = str(getattr(source, "value", source))
        self._tokens: list = []

    def __enter__(self):
        self._tokens.append(_current_r2_source.set(self._source))
        return self

    def __exit__(self, *exc):
        _current_r2_source.reset(self._tokens.pop())
        return False

    def __call__(self, fn):
        source = self._source
        if inspect.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def async_wrapper(*args, **kwargs):
                with r2_source_scope(source):
                    return await fn(*args, **kwargs)
            return async_wrapper

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            with r2_source_scope(source):
                return fn(*args, **kwargs)
        return wrapper


def _route_label(method: str, route) -> str:
    if isinstance(route, Mount):
        return f"{method} {route.path}/*"
    return f"{method} {route.path_format}"


def route_source(app, scope) -> str:
    """The route template a request will be routed to, resolved ahead of Starlette's
    own routing (which only happens inside call_next -- too late for the middleware's
    pre-handler restore and post-handler sync, which also issue R2 calls)."""
    method = scope["method"]
    partial = None
    for route in app.router.routes:
        match, _ = route.matches(scope)
        if match is Match.FULL:
            return _route_label(method, route)
        if match is Match.PARTIAL and partial is None:
            partial = route  # path matched, method didn't (405)
    return _route_label(method, partial) if partial is not None else R2Source.UNMATCHED.value


_warned_unclassified: set[str] = set()
_warned_lock = threading.Lock()


def op_class(op: str) -> str:
    cls = OP_CLASS.get(op)
    if cls is not None:
        return cls.value
    with _warned_lock:
        first = op not in _warned_unclassified
        _warned_unclassified.add(op)
    if first:
        logger.warning(f"[R2_USAGE] op={op} has no R2 pricing class; counted as unclassified")
    return OpClass.UNCLASSIFIED.value


UsageKey = tuple[str, str, str, str, str]  # (day, env, source, op_class, op)


class UsageBuffer:
    """In-memory counters, swapped out whole on drain (the _DailyCounterBuffer shape)."""

    def __init__(self):
        self._counts: dict[UsageKey, int] = defaultdict(int)
        self._lock = threading.Lock()

    def increment(self, key: UsageKey, n: int = 1) -> None:
        with self._lock:
            self._counts[key] += n

    def peek(self) -> dict[UsageKey, int]:
        with self._lock:
            return dict(self._counts)

    def drain(self, timeout_s: float | None = None) -> dict[UsageKey, int] | None:
        """Swap the counters out. Returns None if the lock was not acquired in time
        (only the shutdown path passes a timeout -- see AnalyticsStore.final_flush)."""
        if not self._lock.acquire(timeout=-1 if timeout_s is None else timeout_s):
            return None
        try:
            drained, self._counts = dict(self._counts), defaultdict(int)
            return drained
        finally:
            self._lock.release()

    def restore(self, drained: dict[UsageKey, int]) -> None:
        """Re-merge counts whose flush failed."""
        with self._lock:
            for key, n in drained.items():
                self._counts[key] += n


_usage_buffer = UsageBuffer()


def usage_buffer() -> UsageBuffer:
    return _usage_buffer


def record_r2_call(op: str, source: str, env: str) -> None:
    """Hot path (botocore after-call hook): one dict increment under a lock."""
    day = datetime.now(UTC).date().isoformat()
    _usage_buffer.increment((day, env, source, op_class(op), op))
