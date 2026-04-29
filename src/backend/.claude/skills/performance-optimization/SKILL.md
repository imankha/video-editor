---
name: performance-optimization
description: "Performance optimization workflow for slow endpoints. Correlate frontend wall-time to backend sub-steps via req_id. If instrumentation is missing, fix attribution FIRST — don't guess at causes. Verify fixes by grepping req_id through the log chain."
license: MIT
author: video-editor
version: 1.0.0
---

# Performance Optimization Workflow

When an endpoint is slow, don't speculate — attribute. Every millisecond over budget
must trace to a named sub-step (R2 call, DB query, cache miss, lock wait). If you
can't attribute it, the instrumentation is the bug, not the code.

## When to Apply

- User reports a slow request (e.g. `[SLOW FETCH]` from frontend console)
- `[SLOW REQUEST]` warning in backend logs
- Wall time > handler_ms + sync_ms (gap is in middleware/init code)
- Any endpoint exceeding its latency target

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Attribute before fixing | CRITICAL | `perf-attribute-` |
| 2 | Instrument hot paths with req_id | CRITICAL | `perf-instrument-` |
| 3 | Verify via grep chain | HIGH | `perf-verify-` |

---

## The Workflow

```
Slow request observed (frontend or [SLOW REQUEST])
    │
    ▼
1. CAPTURE: frontend log (wall time + req_id) + backend log (same window)
    │
    ▼
2. ATTRIBUTE: grep req_id=<x> in backend log → see every tagged sub-step
    │   If sub-steps don't carry req_id → STOP, fix instrumentation first (rule 2)
    ▼
3. IDENTIFY hot path: total_ms − handler_ms − sync_ms = middleware gap
    │   Which tagged sub-step dominates? Is it avoidable on this path?
    ▼
4. FIX: move / skip / parallelize / cache. Prefer skipping work on paths that
    don't need it (e.g. /me doesn't need profile.sqlite). Next choice: parallelize
    independent I/O. Last choice: cache.
    │
    ▼
5. VERIFY: re-run, grep req_id=<new>, confirm chain is (a) shorter, (b) still
    attributable. Not attributable = regression, even if fast.
```

## The Req-id Rule

**Every log line emitted during a request must carry `req_id=<id>`** if it's
tagging work that could contribute to the request's wall time. That includes:

- `[REQ]` entry and `[REQ_TIMING]` exit (middleware-level)
- `[SLOW REQUEST]` warnings
- `[R2_CALL]` / `[DB_CALL]` per external I/O operation
- `[Restore]` / `[Cleanup]` / `[Migration]` sub-step logs
- Any route-level "big work" log (`[list_games]`, `[export]`, etc.)

Use a ContextVar set by middleware, not a parameter passed through every call.
ContextVars survive across `await` boundaries and don't require touching every
function signature.

See [perf-instrument-req-id.md](rules/perf-instrument-req-id.md) for the
ContextVar + per-log-site pattern.

## Accessing Prod Logs (T2020)

Fly.io's built-in log buffer only retains ~47 lines. Logs are also written to
`/tmp/logs/app.log` with daily rotation (1 backup). Access them remotely via
debug endpoints (gated by `DEBUG_ENDPOINTS_ENABLED=true`, already on in prod):

```bash
# List available log files with sizes
curl https://<host>/api/_debug/logs

# Read last 200 lines (default)
curl https://<host>/api/_debug/logs/app.log

# Tail + grep for a specific req_id
curl "https://<host>/api/_debug/logs/app.log?tail=2000&grep=req_id%3Dabc123"

# Grep for slow requests
curl "https://<host>/api/_debug/logs/app.log?tail=2000&grep=SLOW%20REQUEST"
```

Rotated files are named `app.log.YYYY-MM-DD`. Logs are lost on machine restart
(ephemeral `/tmp`), but survive between checks on a running machine.

## Anti-Patterns

- **Speculating without the chain.** "It's probably the R2 call" — maybe, but
  without req_id attribution you're guessing. Fix instrumentation first.
- **Grepping by timestamp proximity.** Works until requests overlap. Once
  `inflight_entry > 1`, timestamps lie about causality.
- **Optimizing without a baseline req_id.** If you can't produce a before/after
  grep of the same req_id shape, you can't prove the fix worked.
- **Hiding slow work behind a cache without measuring cold vs warm.** Every
  restart re-pays the cold cost; dev hot-reload exposes it.

## Real Example (reference)

The `/me` endpoint was observed at 780ms on cold cache (post-uvicorn reload).
Without req_id attribution, the `[R2_CALL] HeadObject elapsed_ms=825` log line
couldn't be definitively tied to /me — only inferred by timestamp proximity.

Fix landed in two parts:
1. **Attribution** — ContextVar-published `req_id`, appended to `[R2_CALL]`,
   `[Restore]`, and `[REQ]` entry lines. Now `grep req_id=<x>` returns the
   full causal chain end-to-end.
2. **Skip unnecessary work** — /me doesn't need profile.sqlite; added
   `SKIP_SESSION_INIT_PATHS` so identity-only auth routes bypass
   `user_session_init` entirely.

Result: /me 780ms → 15ms (52×). Grep-by-req_id confirms the cold-path R2
restore moved to `/api/games` (the next request), exactly as intended.
