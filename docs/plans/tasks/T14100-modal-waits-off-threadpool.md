# T14100: Modal waits must not hold threadpool threads

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

Every Modal export wait runs on the shared default threadpool: `services/modal_client.py` blocks a thread per progress step via `loop.run_in_executor(None, get_generator)` / `run_in_executor(None, next_item, gen)` (lines ~832/853, ~1041/1062, ~1272/1293) and calls `asyncio.to_thread(fn.remote, ...)` (~564, ~626, ~1473, ~1535). The same pool (32 threads, `main.py` ~158) runs every sync `def` handler and `validate_session` on every authenticated request (`db_sync.py` ~611). A thread is held for the WHOLE export, including time queued on Modal. Measured by the audit (scratch simulation): with 31 held waits a request's threadpool handoff took 6 ms; at 32 it took 2,905 ms. An evening burst of 20 to 40 exports (plus R2 syncs on the same pool, T2250) freezes every logged-in request, including `/api/health`.

## Solution

Use Modal's async API (`remote_gen.aio` / `.remote.aio`) so an in-flight export holds no thread, and add one global export semaphore sized to the Modal GPU quota (see T14130) with a visible "queued" state on the export job instead of an unbounded pile-up.

## Context

### Relevant Files
- `src/backend/app/services/modal_client.py`
- `src/backend/app/main.py` (threadpool sizing)
- `src/backend/app/services/export_helpers.py` / export job status (queued state)
- frontend export progress UI (queued label)

### Notes
Load: modal-gpu.md, export-pipeline.md, backend-services.md (Request concurrency model). Related: T14130 (quota number feeds the semaphore), T2250 (background sync also uses the pool).

## Acceptance Criteria

- [ ] With 40 held (stubbed) Modal waits, `/api/health` and an authenticated GET stay under 200 ms (test with a slow stub, same counterfactual style as test_t8000_admin_analytics_concurrency)
- [ ] No `run_in_executor(None, ...)` / `to_thread(fn.remote...)` left on the export wait path (grep-provable)
- [ ] Exports beyond the semaphore show a queued state, never a silent hang
- [ ] Relevant export tests pass; Branch CI green
