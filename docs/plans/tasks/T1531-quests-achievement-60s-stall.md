# T1531: Quests achievement endpoint 60s stall blocks project load

**Status:** TODO
**Impact:** 9 (blocks reel load — user-visible 60s freeze)
**Complexity:** 3
**Created:** 2026-04-15
**Updated:** 2026-04-15

## Problem

Observed on staging 2026-04-15 20:41-20:42:

```
[SLOW REQUEST] POST /api/quests/achievements/opened_framing_editor
  total 60.89s (sync: 0.24s, handler: 60.65s)
[SLOW REQUEST] GET /api/projects/4
  total 60.90s (sync: 0.00s, handler: 60.90s)
  inflight_entry=2
```

`GET /api/projects/4` (the reel load) queued behind the achievement call via the
per-user `_INFLIGHT` serializer — so the user saw a 60s UI freeze when opening a reel.

The handler is trivial (one INSERT OR IGNORE + one SELECT on `achievements`), so the
60s is not SQL work. Candidates:

1. `ensure_database()` pulling profile.sqlite from R2 with slow/retrying network
   (a `[db_sync_upload] ReadTimeoutError` fired 13s earlier — R2 was flaky).
2. SQLite WAL busy_timeout (30s) hit twice due to concurrent writer.
3. Something in the FastAPI dependency chain.

A hotfix commit added per-step timing in `record_achievement`
([src/backend/app/routers/quests.py:380](src/backend/app/routers/quests.py#L380))
— next occurrence will log `[SLOW ACHIEVEMENT] conn_ms=... write_ms=... read_ms=...`
so we can attribute.

## Goal

1. Identify which step inside `record_achievement` consumes the 60s.
2. Remove the serialization dependency between this fire-and-forget achievement
   write and the reel load (`GET /api/projects/*`). An achievement write should
   never block a user-visible read.

## Proposed Approach

- Wait for one more occurrence with the new `[SLOW ACHIEVEMENT]` log to confirm the
  hot step (conn vs write vs read).
- If it's `conn_ms` (R2 pull in `ensure_database`): add a fast path that skips R2
  refresh for idempotent achievement writes, OR move achievements to an async
  background task so they don't block the request.
- If it's `write_ms` (WAL busy): investigate concurrent writers; achievements
  should not block project reads regardless. Consider firing the achievement
  POST with `keepalive: true` and not awaiting in the frontend.
- Either way: make the frontend call non-blocking (don't gate UI state on its
  response) — this is the real fix.

## Related

- T1530 (comprehensive cProfile strategy) — will provide function-level attribution
  for this exact class of bug.
- The `_INFLIGHT` counter surfaced this: two requests queued on the same user,
  second one inherits first one's wall time.

## Acceptance Criteria

- [ ] `[SLOW ACHIEVEMENT]` log captured from a real 60s incident.
- [ ] Root cause identified (conn/write/read).
- [ ] Achievement writes no longer block `GET /api/projects/*` (either async
      handler, frontend fire-and-forget, or per-user lock bypass).
- [ ] Regression test: project load latency when an achievement write is in-flight.

## Progress log

- 2026-04-15: Instrumentation shipped to master ahead of the architectural fix.
  Scope expanded to T1530's full backend profiling story — when staging catches
  the next `[SLOW ACHIEVEMENT]` or any other slow call, AI has everything it
  needs to attribute without asking for additional logs.

  **Landed:**
  - `[R2_CALL] client=<default|sync|transfer> op=<Op> status=<code> elapsed_ms=<n>`
    on every S3 call (all three R2 clients), including retry-sleep.
    ([storage.py](src/backend/app/storage.py))
  - Request-scoped cProfile middleware in
    [db_sync.py](src/backend/app/middleware/db_sync.py) — wraps ALL paths
    through `RequestContextMiddleware.dispatch`. Gated by
    `PROFILE_ON_BREACH_ENABLED` (default false, staging true) or header
    `X-Profile-Request: 1`. Dumps only on breach (`PROFILE_ON_BREACH_MS`,
    default 1000) to `/tmp/profiles/{ts}_{method}_{pathslug}_{ms}ms_{user}.prof`
    plus a paired `.txt` (pstats top-50 cumtime + tottime) that is readable
    with `cat` alone.
  - `[SLOW REQUEST]` log line augmented with `profile=<abs path>` — one grep
    gives AI the path to the profile for that breach.
  - `_sync_profile` / `_sync_user` ThreadPoolExecutor workers get their own
    per-thread cProfile (cProfile only traces its own thread). Sibling dump
    tagged `_syncthread_profile_{user}` / `_syncthread_user_{user}`.
  - `[SLOW QUERY]` log (pre-existing in `TrackedCursor.execute`) now includes
    `db=<profile|user>` and covers `executemany`. Attributes WAL contention /
    slow SQL without opening a profile.
  - Debug router `/api/_debug/profiles[/{name}]` gated on
    `DEBUG_ENDPOINTS_ENABLED`. Lists dumps; reads the `.txt` sibling as
    plain text. Lets staging diagnostics run via curl + cookie.
  - Profile directory rotation (`PROFILE_KEEP_LAST`, default 100) on each
    dump — bounded disk.
  - Unit + integration tests in
    [test_profiling.py](src/backend/tests/test_profiling.py) (5 pass).

  **Removed:** the bespoke cProfile around `record_achievement` — the
  middleware now covers it generically. Per-step `conn_ms`/`write_ms`/`read_ms`
  timing stays in place.

  **Frontend-to-backend correlation (QA workflow):**
  - Frontend fetch/axios interceptors in
    [sessionInit.js](src/frontend/src/utils/sessionInit.js) now send
    `X-Request-ID: <8-hex>` on every API call and log
    `[SLOW FETCH] <method> <path> <ms>ms req_id=<id> status=<code>` when
    elapsed >= 500ms (user-perceptible threshold).
  - Backend middleware reads `X-Request-ID` and includes it in
    `[REQ_TIMING]`, `[SLOW REQUEST]`, `[SLOW DB SYNC]`, and the profile
    filename (`{ts}_{method}_{path}_{ms}ms_{req_id}.prof`).
  - QA workflow: user reports delay → copy browser console (`/logdump`) →
    AI sees `[SLOW FETCH] ... req_id=abc12345` → greps backend log for
    `req_id=abc12345` → finds matching `[SLOW REQUEST] ... profile=/tmp/profiles/..._abc12345.prof`
    → reads the `.txt` sibling → attributes the time without needing
    backend shell access.

  **Next (blocked on evidence):** when a real `[SLOW ACHIEVEMENT]` fires,
  attribute from per-step timing + `[R2_CALL]` lines + profile `.txt`,
  then pick between 202 + BackgroundTask, `_INFLIGHT` bypass, or
  per-event-type lock.

- 2026-04-18: New benchmark data from frontend profiling (T1570):
  ```
  [SLOW FETCH] POST /api/quests/achievements/opened_framing_editor
    total=768ms ttfb=767ms body=1ms req_id=<id> status=200
  ```
  This is not the 60s stall (no R2 flakiness this time) but still 768ms for
  a trivial achievement write -- well above the 500ms perceptible threshold.
  The time is all TTFB (handler + R2 sync), not body transfer. Confirms this
  endpoint is consistently slow even without the pathological 60s case, and
  should be made non-blocking (fire-and-forget from frontend, or 202 +
  BackgroundTask on backend).
