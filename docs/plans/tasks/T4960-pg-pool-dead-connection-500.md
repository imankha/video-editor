# T4960: PG pool serves dead connections — first request after idle returns 500

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-12
**Updated:** 2026-07-12

## Problem

On staging (and by code-identity, prod), the FIRST request that touches Postgres
after the Fly machine sits idle fails with a 500; the immediate retry succeeds.
Observed 4x during the 2026-07-12 derisk sweep on `POST /api/auth/test-login`
and `POST /api/auth/dev-login` (machine `d8933d5f417308`), but any first
PG-touching request after idle is exposed — for a real user this is "I opened
the app after lunch and login errored".

Fly logs show the root cause:

```
psycopg2.OperationalError: server closed the connection unexpectedly
```

The connection pool in `app/services/pg.py` hands out a connection that the
Postgres server (or Fly's proxy) already closed during the idle window. There
is no checkout validation and no recycle-by-age, so the first caller eats the
dead socket.

**Repro** (staging): let staging idle 10+ minutes, then
`curl -X POST -H "X-Test-Mode: true" https://reel-ballers-api-staging.fly.dev/api/auth/test-login`
→ 500; repeat immediately → 200.

## Solution

Make the pool never hand a dead connection to application code. Standard
options, in preference order (Architect note below):

1. **Retry-once-on-checkout**: in the `get_pg()` context manager, validate the
   connection with a cheap `SELECT 1` before yielding; on `OperationalError`,
   discard it (`pool.putconn(conn, close=True)`) and get a fresh one. One extra
   round-trip per checkout (~1ms local socket) — measure, and if too hot, only
   validate when the connection has been idle > N seconds (track last-used
   timestamp per connection).
2. Recycle-by-age: proactively close connections older than e.g. 5 minutes.
   Less precise; still leaves a race window.

Option 1 is the recommended fix: it is deterministic and matches what
SQLAlchemy's `pool_pre_ping` does. This codebase uses psycopg2 +
`psycopg2.pool` directly, so the pre-ping must be hand-rolled in `get_pg()`.

**Do NOT** wrap callers in retries — the fix belongs at the pool checkout
(single write path / no defensive fixes elsewhere, per CLAUDE.md).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/pg.py` — pool init (`init_pg_pool`) and the
  `get_pg()` context manager (the ONLY place to change)
- `src/backend/tests/test_session_pinning.py` / `tests/test_shares.py` — examples
  of pg-touching tests; add the new test file alongside

### Related Tasks
- Sibling of T4870 (admin credits) only in that both surfaced from admin/auth
  probes; no dependency.

### Technical Notes
- The pool is created once per process (`init_pg_pool`); Fly keeps machines
  warm-but-idle, and Fly Postgres closes idle client connections — hence the
  after-idle signature.
- `SELECT 1` validation must run OUTSIDE any caller transaction semantics
  (autocommit or immediately-rolled-back) so it can't leak transaction state.
- Log at WARNING when a dead connection is discarded (`[PG] discarded stale
  connection, age Ns`) so frequency is observable in Fly logs.

## Implementation

### Steps
1. [ ] In `get_pg()`, before yielding: `cur.execute("SELECT 1")` inside
       try/except `psycopg2.OperationalError` / `InterfaceError`.
2. [ ] On failure: `pool.putconn(conn, close=True)`, log WARNING, `getconn()`
       again (bound: 2 attempts, then raise).
3. [ ] Unit test: monkeypatch a pool that returns a first connection whose
       `cursor().execute` raises `OperationalError`, then a healthy one —
       assert `get_pg()` yields the healthy connection and the dead one was
       closed. Assert a single failure of BOTH attempts still raises.
4. [ ] Optional perf guard: if measured checkout overhead matters on the hot
       path (bootstrap does several PG reads), add the idle-age gate.
5. [ ] Verify on staging after deploy: idle 10+ min, first login returns 200.

### Progress Log

**2026-07-12**: Found + root-caused during the staging derisk sweep (fly logs
traceback). Documented repro; scripts/e2e in the sweep now retry logins as a
workaround — remove those retries' necessity, but keep them (they're harmless).

## Acceptance Criteria

- [ ] First PG-touching request after 10+ min staging idle returns 200 (manual
      staging verification, curl repro above)
- [ ] Unit test for the discard-and-retry path passes
- [ ] No caller-side retries added; change confined to `pg.py`
- [ ] WARNING log line appears when a stale connection is discarded
