# T8010: Two more admin analytics handlers still block the event loop (T8000 follow-up)

**Status:** WAITING ON USER
**Impact:** 4
**Complexity:** 2
**Created:** 2026-08-28 (filed by T8000 per its own "found but out of scope" note)

## Problem

T8000 converted 6 admin analytics handlers from `async def` (with blocking psycopg2 calls
inline) to plain `def` so FastAPI threadpools them off the single event loop, fixing the
site-wide-request-freeze risk at scale. While implementing that fix, T8000 noted two more
handlers in the same file share the exact same pattern but were out of scope for that task:

- `analytics_journey` (`src/backend/app/routers/admin.py:1376`) — still `async def` with
  blocking psycopg2 calls inline
- `analytics_user_actions` (`src/backend/app/routers/admin.py:1522`) — same

Same mechanism T8000 fixed: a blocking call inside `async def` runs ON the single uvicorn
event loop (`.claude/knowledge/backend-services.md` § request concurrency model), so a slow
query in either of these two handlers would stall every user's request, not just the admin's,
at the exact same scale threshold T8000's design doc analyzed for the other 6.

## Solution

Convert `analytics_journey` and `analytics_user_actions` from `async def` to plain `def`,
identically to T8000's fix for the other 6 handlers (FastAPI runs sync `def` handlers in a
threadpool automatically — no `await`/asyncio ceremony needed, just remove `async`). Verify
each handler's body has no other `await` calls that would break once the `async` keyword is
removed.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py:1376` — `analytics_journey`
- `src/backend/app/routers/admin.py:1522` — `analytics_user_actions`
- `.claude/knowledge/backend-services.md` — request concurrency model (read before implementing)

### Related Tasks
- Follow-up from T8000 (admin analytics event-loop blocking + share-funnel scale), which fixed
  the other 6 handlers in the same file and explicitly flagged these two as out of scope

### Technical Notes
- Same pattern, same fix — should be a small, mechanical S/M-tier change. Confirm no other
  `async def` handler in `admin.py` shares this pattern while in the file (T8000 already did
  this sweep once; a second confirmation costs little).

## Implementation

### Steps
1. [x] Convert `analytics_journey` and `analytics_user_actions` from `async def` to `def`
2. [x] Verify neither handler body contains an `await` that would break under the sync signature
3. [x] Run the relevant admin/analytics test set to confirm no regression

### Progress Log

**2026-08-28**: Implemented inline (S-tier, no container). Both handlers converted, neither
had an `await`. Extended T8000's `test_all_six_analytics_handlers_are_sync_def` regression
guard to `test_all_eight_...` to cover both new handlers. 33 tests in
`test_t8000_admin_analytics_concurrency.py` + `test_analytics_dashboards.py` green.

## Acceptance Criteria

- [x] Both handlers are plain `def`, dispatched to FastAPI's threadpool like the other 6
- [x] Existing admin/analytics tests still pass
