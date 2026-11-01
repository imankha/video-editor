# T14250: Journey rollup sweep blocks the admin request for ~40 s at 1,000 users

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Tier:** M
**Created:** 2026-11-01
**Updated:** 2026-11-01

Found while landing T14030 (2026-11-01).

## Problem

The T14030 exit/dwell/retry rollup sweep runs inside the admin request that triggers it. It
walks every user's `user.sqlite` through the JIT seam. T14030's landing fix added 8 read workers
(`map_users` in `analytics_journey_rollup.py`), but each user still costs one R2 HEAD
(`confirm_current_before_write`, T4315) plus the read. That is still about 40 s per 1,000 users.
At 10K registered users this exceeds a reasonable request timeout, and while it runs it holds
read workers and PG pool slots.

It stays synchronous on purpose: background work is deferred until T2250, under the
no-fire-and-forget rule.

## Solution

Measure first, then choose one of the following:
- **(a)** Run the sweep as a tracked background job once T2250's write-back exists. The admin
  click starts the job and the panel shows progress and the last finished run.
- **(b)** Make it incremental: skip users whose `user.sqlite` has not changed since the
  previous run (R2 ETag or `db_version` recorded in `rollup_meta`), so the steady-state cost is
  only the active users.

Option (b) needs no T2250 and is probably enough on its own.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_journey_rollup.py` - `sweep`, `map_users`, `_walk_user`, `rollup_meta`
- `src/backend/app/routers/admin.py` - rollup trigger endpoint
- `src/backend/tests/test_analytics_journey_rollup.py`

### Related Tasks
- Depends on: T14030 (landed in PR #689)
- Related: T2250 (write-back sync, unblocks option a), T14140 (other O(users) walks), T14190 (load test)

### Technical Notes
- The no-fire-and-forget rule stays in force until sessions are pinned to one machine.
- Each user still needs a JIT migration before it is read. A skip must never read a user whose
  DB is below head.

## Acceptance Criteria

- [ ] Measured: sweep wall time at 1,000 and 10,000 synthetic users, before and after the change
- [ ] A second sweep with no user changes reads no users' DBs (if b), or the admin request returns in under 2 s (if a)
- [ ] The rollup output is identical to a full sweep's on the same data
