# T6240: App boot serializes for ~22s — `user_session_init` blocks the event loop

**Status:** WIP
**Impact:** 9
**Complexity:** 5
**Created:** 2026-07-31
**Updated:** 2026-07-31

Epic task 1/6. See [EPIC.md](EPIC.md) for the capture, the dev/StrictMode caveats, and the
measure-then-fix rule.

## Problem

From the 2026-07-31 HAR, the first eight requests of the session:

| start | duration | request |
|-------|----------|---------|
| 0ms | **20644ms** | `GET /api/profiles` |
| 1ms | **22146ms** | `GET /api/downloads/count` |
| 1ms | **22148ms** | `GET /api/credits` |
| 1ms | **22148ms** | `GET /api/quests/progress` |
| 2ms | **22147ms** | `GET /api/admin/me` |
| 34ms | **22116ms** | `GET /api/projects` |
| 37ms | **22135ms** | `GET /api/settings` |
| 37ms | **23556ms** | `GET /api/games` |

Eight requests issued within 37ms, every one taking ~22 seconds, all finishing within ~40ms of
each other. **That is the exact serialization fingerprint T6200 diagnosed and fixed for the
project-open path — here it is at boot, 15x larger.** Five `/api/health` checks in the same
window returned status **0** (aborted): the backend was unresponsive throughout.

The app is unusable for 22 seconds on a cold boot.

## Hypothesis (measure before fixing — this is NOT established)

T6200 offloaded `validate_session` but **deliberately left `user_session_init` on the event
loop** (`db_sync.py` ~L700), judging it "rare on the hot path — normal clients send
`X-Profile-ID`, so `init_ms` is ~0". Its Stage-7 note in
`.claude/knowledge/backend-services.md` records it as a deferred follow-up.

That judgement looks wrong at boot. The **first** request of a session is `/api/profiles` —
whose entire purpose is to discover which profiles exist, so it cannot send `X-Profile-ID`.
That should route straight into `user_session_init`, which does a blocking R2 download of
`user.sqlite` + `profile.sqlite` on the loop. Everything issued behind it queues.

Consistent with this: `/api/profiles` is the **shortest** of the eight (20644ms) while the
others are ~22.1s — i.e. it did the work and the rest waited on it.

**Confirm before fixing.** `scripts/concurrency_probe.py --no-profile` (committed by T6200)
forces exactly this path. Compare against `--user`/`--profile` (with header) at N=1,2,4,8.

## Solution

1. Reproduce with the probe: `--no-profile` vs. with-profile, N=1,2,4,8. Linear scaling +
   tiny finish-spread on the no-profile variant confirms it.
2. Attribute the time inside `user_session_init` — R2 GET vs. sqlite open vs. version check.
   22s is large enough that it may be more than one blocking call, or a retry loop.
3. Offload it using the existing primitive: `run_in_context` (`app/utils/offload.py`, added by
   T6200) — it copies contextvars into the worker thread so `get_current_*()` resolve there.
   Do NOT use a bare `asyncio.to_thread` if the call reads request context.
4. Re-measure and prove it with a fresh browser HAR of a cold boot.

Also check whether 22s is itself reasonable. Even fully offloaded, a 22s first paint is bad —
if the R2 download is the bulk, that is a separate question worth stating (parallel downloads,
smaller payload, or serving the app before the DB is ready).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/middleware/db_sync.py` — `user_session_init` call site (~L700), the
  `X-Profile-ID` branch, `SKIP_SESSION_INIT_PATHS`
- `src/backend/app/utils/offload.py` — `run_in_context`, the one offload primitive (T6200)
- `src/backend/app/main.py` — `lifespan()` bounded I/O executor (32 threads, T6200)
- `src/backend/app/services/pg.py` — `get_pg()` + the `BoundedSemaphore` checkout gate (T6200)
- `scripts/concurrency_probe.py` — has the `--no-profile` flag for exactly this
- `.claude/knowledge/backend-services.md` § Request concurrency model — what T6200 established

### Related Tasks
- **T6200** — parent diagnosis; this is its explicitly deferred item. Read its design doc
  (`docs/plans/tasks/T6200-design.md`) before starting; do not re-derive the concurrency model.
- **T6290** — the boot poster batch competes for connections in this same window.

### Technical Notes
- **Do not add `uvicorn --workers`.** T6200 rejected it for a load-bearing reason:
  `_USER_WRITE_LOCKS` would become per-process instead of per-machine, letting two workers write
  the same user's `profile.sqlite` concurrently. That is the CAS/data-loss hazard the lock
  exists to prevent.
- The `/api/games` x8 burst at t=81739 (1470-2813ms each) may be this same contention. Re-check
  it after the fix before filing separate work.
- Watch the contextvar-into-thread landmine — a bare `to_thread` on a function calling
  `get_current_user_id()` raises `RuntimeError: No user context set` inside the thread.

## Implementation

### Steps
1. [ ] Reproduce with `concurrency_probe.py --no-profile` at N=1,2,4,8; record the table
2. [ ] Attribute the ~22s inside `user_session_init` (R2 / sqlite / version check)
3. [ ] Offload the blocking work via `run_in_context`
4. [ ] Re-run the probe; durations must stop scaling with N
5. [ ] Fresh cold-boot HAR; boot requests must show varied durations + real finish-spread
6. [ ] Re-check the `/api/games` x8 burst; note whether it survived
7. [ ] Update `.claude/knowledge/backend-services.md` (remove the "rare on the hot path" claim)

### Progress Log

**2026-07-31**: Filed from the post-T6190/T6200 verification HAR. Not yet reproduced with the
probe — the boot table above is the only evidence so far.

## Acceptance Criteria

- [ ] The boot serialization is confirmed or refuted with the probe (not just the one HAR)
- [ ] If confirmed: the blocking call is named with timing attributing the wait to it
- [ ] Concurrent boot-shaped requests no longer scale linearly in duration
- [ ] A fresh cold-boot HAR shows the 8 boot requests with varied durations, not a ~22s clump
- [ ] `/api/health` no longer aborts (status 0) during boot
- [ ] The `.claude/knowledge/backend-services.md` "rare on the hot path" note is corrected
- [ ] Backend tests pass
