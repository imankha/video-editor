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
