# perf-instrument-req-id

**Priority:** CRITICAL
**Category:** Instrument hot paths with req_id

## Rule

Every log line that tags work on the request critical path must carry
`req_id=<id>`. Use a ContextVar set by middleware so downstream code doesn't
need to thread `req_id` through every call.

## What must be tagged

| Log pattern | Why |
|---|---|
| `[REQ]` entry | Start of request — pair with `[REQ_TIMING]` exit |
| `[REQ_TIMING]` exit | Wall-time breakdown: total / handler / sync |
| `[SLOW REQUEST]` / `[SLOW DB SYNC]` | Alert paired to its request |
| `[R2_CALL]` | Per-S3-op timing (botocore event hook) |
| `[Restore]` / `[Cleanup]` / `[Migration]` | Stateful sub-steps that can be slow |
| Route-level "big work" (`[list_games]`, `[export]`, ...) | DB scans, large result sets |

## The ContextVar pattern

```python
# user_context.py (or shared module)
from contextvars import ContextVar
_current_req_id: ContextVar[str] = ContextVar('current_req_id', default='')

def get_current_req_id() -> str:
    return _current_req_id.get()

def set_current_req_id(req_id: str) -> None:
    _current_req_id.set(req_id or '')
```

Middleware publishes it once at dispatch start:

```python
req_id = request.headers.get("X-Request-ID", "")
set_current_req_id(req_id)
```

Per-log-site usage:

```python
from .user_context import get_current_req_id
req_id = get_current_req_id()
suffix = f" req_id={req_id}" if req_id else ""
logger.info(f"[R2_CALL] op={op} elapsed_ms={elapsed_ms:.0f}{suffix}")
```

## Why ContextVar, not a parameter

- Survives `await` boundaries automatically (asyncio copies the context).
- No signature changes — a single edit per log site, no fan-out.
- Thread-safe for `ThreadPoolExecutor`-dispatched work when the executor runs
  inside a request that has already set the ContextVar (the submitting thread's
  context is captured).
- Graceful when unset: `default=''` means background jobs and startup code
  emit the same log line without `req_id=` noise.

## Anti-Patterns

- **Threading `req_id` as a function parameter.** Every new I/O call adds a new
  signature change. You'll miss one and silently lose attribution.
- **Emitting logs without req_id because "this is a background task."** If the
  background task was triggered by a request, it should inherit that request's
  id. Capture the ContextVar at submit time and restore it in the worker.
- **Appending req_id only on slow/error paths.** Then you can't prove the fast
  path is actually fast for that request — the chain is incomplete.

## Verification

After adding `req_id` to a log site, re-run a slow request and
`grep req_id=<x>`. The output must be a complete ordered chain:

```
[REQ] GET /api/foo ... req_id=<x>
[R2_CALL] op=HeadObject elapsed_ms=110 req_id=<x>
[R2_CALL] op=GetObject  elapsed_ms=144 req_id=<x>
[Restore] ... took 0.30s req_id=<x>
[SLOW REQUEST] ... req_id=<x>
[REQ_TIMING] ... total_ms=349 handler_ms=25 sync_ms=0 req_id=<x>
```

If any line in that chain lacks req_id, it's a bug in the instrumentation.
