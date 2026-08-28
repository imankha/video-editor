# T8000: Admin analytics handlers block the event loop; share-funnel does one R2 HEAD per sharer — both bite at scale

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-08-28
**Updated:** 2026-08-28

## Problem

Filed alongside the admin dashboard audit (2026-08-28) in response to "what needs to change for
this panel to support thousands of users?" Escalated to the expert agent per CLAUDE.md (real
architecture/performance tradeoffs). Verdict: the scale risk is **not** Postgres aggregate query
cost — at 10k users `user_segments` is ~10k rows and `user_actions` is ~0.5-1M rows, and a Postgres
seq-scan + hash-aggregate over that is a few hundred ms, invisible.

The real problems, in priority order:

1. **Every analytics handler is `async def` with blocking psycopg2 calls inline**
   (`admin.py:978, 1049, 1099, 1170, 1531, 1822`), i.e. they run ON the single uvicorn event loop.
   Per `.claude/knowledge/backend-services.md` § request concurrency model, a handler that blocks
   the loop for N seconds stalls **every user's** request for N seconds — not just the admin's.
   Today N is ~5ms (invisible). At 10k users N becomes 1-4s, and one admin page load becomes a
   site-wide request freeze. **This is the only item that hits customers, not just the admin.**
2. **`share-funnel` has an N+1 that scales with share count, not user count** (`admin.py:1142-1147`):
   it loops distinct sharers calling `share_view_counts` -> `get_user_db_connection(foreign_user_id)`,
   which per `user_db.py:327-357` does an **R2 HEAD per sharer** (and can trigger a full DB
   download). At `limit=100` links spanning ~100 sharers that's ~100 sequential network round-trips
   on the event loop — seconds to tens of seconds. This degrades FIRST, before the other endpoints,
   because share count grows independently of and likely faster than user count early on.
3. **Cohort query has no history bound** (`admin.py:1188-1239`): four full-history aggregations
   run on every admin page load, and that history only grows forever (never a bounded window today).

## Solution

1. Convert the analytics handlers to plain `def` (bodies are wholly synchronous DB calls; FastAPI
   runs sync `def` handlers in a threadpool, off the event loop — contextvars still propagate).
   Do NOT convert to `async def` + `await` wrapping without threading the DB call itself; the fix
   is removing the loop-blocking, not adding async ceremony.
2. Bound `share-funnel`'s default `limit` down from 100 (~25) and/or make per-row view counts
   opt-in/lazy rather than eagerly fetched for every row up front.
3. Add a default bounded window to the cohort query (e.g. `WHERE s.acquired_at >= now() -
   interval '12 months'`) so `idx_segments_acquired` drives a small segment set instead of a
   full-table aggregate; keep it overridable via existing `date_from`/`date_to` params if present.

Explicitly OUT of scope (expert verdict: premature at this stage) — do not add caching, a
materialized-view/rollup table for cohorts+channels, or new indexes for these queries. This is an
admin-only, single-digit-QPS surface; bounded full-scan aggregation stays sub-second at 10k users.
Revisit only if the admin panel is still slow after items 1-3, or past ~100k users.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — handler signatures at lines 978, 1049, 1099, 1170, 1531,
  1822 (convert `async def` -> `def`); share-funnel N+1 at lines 1142-1147; cohort query at lines
  1188-1239
- `src/backend/app/services/user_db.py` — `get_user_db_connection` R2 HEAD behavior (lines
  327-357), called per-sharer from share-funnel
- `.claude/knowledge/backend-services.md` — request concurrency model (read before implementing)

### Related Tasks
- Filed alongside the same audit as T7960/T7970/T7980/T7990, but independent — this is a
  performance/scale concern, not a correctness bug; no shared code with those four
- T2540 (referenced elsewhere in PLAN.md re: HTTP/2 at the edge) is unrelated infra, not a
  dependency

### Technical Notes
- Confirm no other request handler in admin.py (outside analytics) shares this `async def` +
  blocking-psycopg2 pattern while in the file for this task — if found, note it but don't scope-creep
  the fix into non-analytics endpoints without filing separately.
- This task intentionally does NOT touch schema, indexes, or add a caching layer — see "explicitly
  out of scope" above; don't reintroduce those during implementation without discussing with the
  founder first.

## Implementation

### Steps
1. [ ] Convert the 6 analytics handlers from `async def` to `def`; verify FastAPI threadpool
       dispatch behaves correctly under existing tests
2. [ ] Lower share-funnel's default/max `limit` and/or make view counts lazy per row
3. [ ] Add a default 12-month bound to the cohort query, overridable via existing date params
4. [ ] Load-test or reason through: confirm a slow admin analytics call no longer blocks a
       concurrent normal user request (can be a targeted async test simulating a slow DB call
       alongside a fast one, rather than a full load test)

### Progress Log

**2026-08-28**: Filed from admin dashboard scaling assessment (expert agent verdict).

## Acceptance Criteria

- [ ] A slow/expensive admin analytics request does not delay concurrent non-admin requests
      (verified via test, not just code inspection)
- [ ] share-funnel's R2 HEAD fan-out is bounded and doesn't scale linearly with share count at
      default limits
- [ ] Cohort query has a default bounded window and no longer scans full signup history by default
- [ ] No new caching layer, materialized view, or index added (out of scope per this task's design)
