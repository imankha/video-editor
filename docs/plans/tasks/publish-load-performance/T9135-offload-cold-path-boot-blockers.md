# T9135: Offload the two cold-path boot blockers T9120 found outside the burst

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-08

## Epic Context

Follow-up within [Publish Load Performance](EPIC.md). Filed by T9130, which fixed the 9
Publish-page-burst handlers + the `list_projects` poster-warm amplifier but deliberately did
NOT fold in the two cold-path offenders T9120 also measured. They are the same fix class
(blocking call on the event loop) but sit OUTSIDE the Publish-page burst itself, and one of them
carries the T6240 main-loop landmine that warrants its own focused review rather than riding
T9130's mechanical handler-flip diff.

## Problem (both confirmed and measured by T9120)

1. **`app/routers/auth.py:198` `init_session`** is `async def` and calls `user_session_init()`
   INLINE on the loop — the un-offloaded twin of the T6240 middleware fix (`db_sync.py:966`
   already offloads the middleware path; this explicit endpoint does not). Measured **2145ms** of
   loop block on a cold process. This runs on the literal first request of a cold session, so it
   blocks the whole boot burst behind it.
2. **`app/session_init.py:408` `_schedule_startup_recovery` -> `_run_startup_recovery`** is a
   fire-and-forget LOOP task that calls `recover_orphaned_jobs`
   (`app/services/export_worker.py:435-500`, blocking sqlite + `modal.FunctionCall.from_id(...).get()`
   network calls) directly on the loop, competing with the user's first page load.

## Solution

Same fix class as T6240/T9130 (`run_in_context` / offload the blocking chain), applied to these
two sites.

- **`init_session`:** `await run_in_context(user_session_init, ...)`, then re-apply
  `set_current_profile_id(result["profile_id"])` on the request context afterward (the copied
  context in the worker thread does not propagate back — same note T6240 left on the middleware
  twin). **Watch the signature:** `run_in_context(fn, *args)` takes positional args only — it has
  no `**kwargs`, so `user_session_init`'s `hint_profile_id` must be threaded positionally or via a
  small closure. Mirror exactly how `db_sync.py:966` calls it.
- **`_schedule_startup_recovery`:** offload the blocking recovery, but preserve the T6240
  worker-thread landmine fix — a fire-and-forget loop task offloaded to a thread loses
  `get_running_loop()`, so it must schedule back onto the captured main loop
  (`session_init.set_main_loop()` / `call_soon_threadsafe` -> `create_task(..., context=copy_context())`),
  NOT fall back to `asyncio.run(...)` on an ephemeral loop. See
  `.claude/knowledge/backend-services.md` § Request concurrency model and
  `tests/test_t6240_session_init_concurrency.py`'s second test for the exact shape.

## Context

### Related Tasks
- Filed by: T9130 (the Publish-burst fix)
- Same fix class as: T6240 (`user_session_init` middleware offload), T9130 (the 9 burst handlers)

### Technical Notes
- Preserve `run_in_context`'s contextvar-copy behavior — a bare `asyncio.to_thread` on a call
  reading `get_current_user_id()` raises "No user context set" in the thread.
- Add a concurrency regression guard in the shape of
  `tests/test_t6240_session_init_concurrency.py` (the ticker / overlap-property style), asserting
  a cold `init_session` no longer serializes the boot burst.

## Acceptance Criteria

- [x] `init_session` offloads `user_session_init` via `run_in_context` and re-applies the profile
      id on the request context afterward
- [x] `_schedule_startup_recovery`'s recovery chain is offloaded without reintroducing the T6240
      ephemeral-loop `asyncio.run` fallback (fire-and-forget onto the captured main loop)
- [x] A concurrency regression test proves the cold boot burst no longer serializes on
      `init_session`

## Resolution (2026-09-09)

Both blockers fixed as scoped, plus the second half of item 2 — `recover_orphaned_jobs` itself
(export_worker.py) was `async def` with a fully-blocking body and no `await` inside it, so it was
flipped to plain `def` (matching the T6200 "whole body is synchronous -> should just be def" shape)
and is now called via `await run_in_context(recover_orphaned_jobs)` from `_run_startup_recovery`.
`_schedule_startup_recovery`'s own main-loop scheduling (the T6240 landmine fix) was already correct
and untouched — verified by the existing `test_offloaded_startup_recovery_is_fire_and_forget_on_main_loop`
guard, which still passes.

`process_modal_queue` was deliberately left unchanged: it does real async work via `asyncio.gather`
and its sync prefix is a near-empty table check (no task types are currently enqueued in this app),
so it wasn't in scope of the two named blockers.

New guard: `tests/test_t9135_cold_boot_offload.py` — 4 tests, both fixes counterfactual-proven
(reverting either offload reintroduces serialization / a blocked loop and fails red). Existing
regression suite unaffected: `test_t6240_session_init_concurrency.py`, `test_session_init_recovery.py`
(one mock updated to match `recover_orphaned_jobs`'s new sync signature),
`test_vacuum_on_signout.py` (its AST-based `init_session` structural check updated to detect
`user_session_init` referenced via `run_in_context`, not only called directly), and
`test_t9130_publish_burst_concurrency.py` all green. 49/49 relevant tests pass.

Knowledge doc updated: `.claude/knowledge/backend-services.md` § Request concurrency model.

**Merge note:** a concurrent session sharing this same working tree independently implemented and
merged this exact task as PR #376 while this work was in progress. Both implementations converged
on the same approach (including the same two incidental bugs from lint-driven cleanup). Rather than
redo the shipped work, the two real bugs a Reviewer pass caught were landed as a small follow-up,
PR #377: `test_vacuum_on_signout.py::test_init_calls_cancel_active_vacuum` used `ast.walk()`
discovery order (breadth-first, not source order) to check ordering, so it silently stopped
enforcing "cancel_active_vacuum before user_session_init" after the offload — fixed by comparing
`ast` line numbers instead. `auth.py`'s two fire-and-forget background tasks used
`task.add_done_callback(lambda t: t.exception())` to silence a RUF006 finding, which discarded any
real exception instead of logging it and didn't fix the underlying GC hazard — fixed with a shared
module-level task set (real strong reference) + a logging done-callback. 145 tests green across
both PRs' relevant sets.
