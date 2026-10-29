# T13830: A restart-orphan progress loop that crashes leaves `export_progress[job_id]` at "processing", so every later resume is declined for the life of the process

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-28
**Updated:** 2026-10-28
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Problem

T13780 added a guard to `resume_progress` (`src/backend/app/routers/exports.py:1121-1127`): if `job_id in export_progress` and no loop is active, an in-band task in this process owns the render, so the endpoint returns "In-band render owns this job" without starting a loop. That is correct for a WS blip.

The orphan progress loop it starts (`:1132-1237`) writes `export_progress[job_id] = {status: "processing", ...}` every 5 s (`:1229`). Its `except Exception` (`:1234`) only logs, and `finally` (`:1237`) only discards `_active_progress_loops`. So if the loop dies (reconcile raises, finalize raises, DB hiccup), the entry stays at "processing" with no loop and no in-band owner. The client's next reconnect POSTs `/resume-progress`, the guard reads the stale entry as "owned", declines, and the export is stuck exactly the way T13780 fixed, until the process restarts.

Seen as test pollution in PR #660's first CI run (the same leaked entry made `test_t12820...::test_resume_progress_complete_once_finalized` fail); the production version is this.

## Solution

In the loop's `except Exception` branch, after logging: `export_progress.pop(job_id, None)` so the next client reconcile can start a fresh loop (finalize's stage CAS, T7210, makes a repeated finalize safe). Log at WARNING that the loop died and the entry was cleared so the client may retry.

Do not clear on the success/error exits: those entries are "complete"/"error" and the guard declining there is right (the client learns the outcome from `/modal-status`).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/exports.py` (`progress_loop` except branch)
- `src/backend/tests/test_t13780_resume_progress_guard.py` (add: loop raises -> entry popped -> second `resume_progress` starts a loop)

### Related Tasks
- T13780 (introduced the guard), T12820, T10360, T7210 (finalize CAS)

## Implementation

### Steps
1. [ ] Failing test: patch `reconcile_dispatched_export` to raise; run the loop task; assert `JOB_ID not in export_progress` and a second `_call_resume()` yields one background task
2. [ ] Pop the entry in the except branch + WARNING
3. [ ] Curated tests (`test_t13780_resume_progress_guard.py`, `test_t12820_recovery_complete_requires_finalize.py`) + lint + commit

## Acceptance Criteria

- [ ] After an orphan loop crashes, the next `POST /resume-progress` for that job starts a loop
- [ ] A live in-band render and a finished job are still declined (existing tests unchanged)
- [ ] Test fails before, passes after
