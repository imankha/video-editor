# T15300: Upload-failure beacon test reads back before the background write lands (flaky on slow disks)

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Tier:** S/M (backend test or beacon path; no schema change)
**Created:** 2026-11-08
**Updated:** 2026-11-08

## Problem

`tests/test_t15050_upload_observability.py::TestReasonlessBeacon::test_a_beacon_with_a_reason_is_still_terminal`
is flaky when per-user SQLite I/O is slow. It was found by the /dotask verifier on group g-t14940-1
(HEAD eb503e4c4: 3 of 8 isolated runs failed with `IndexError: list index out of range` from
`_beacon_rows()`, each run 40 to 100 s). That group's fixer showed it is not a T14940 regression:

- The same branch commit run from a fast-disk worktree (`/tmp`): 3 of 3 pass in 6 to 9 s.
- Master's own commit 526e6ed60 with `user_data` on the slow `/workspace` mount (9p/drvfs in the
  task container): the same `IndexError` (1 of 9 runs) and the same `[SLOW REQUEST] ... 1.9s`
  signature.

Mechanism: `upload_failure_beacon` awaits `run_in_context`, which runs `record_upload_failure`'s two
separate DB writes on a worker thread. Under slow per-user SQLite I/O the test's synchronous
read-back can run before those writes land. CI (fast disk) does not see it; task containers can.

## Solution

Decide first whether the race matters outside the test: if a beacon's `upload_failures` row can be
lost or late in production (a request that ends before the thread's write commits), fix the beacon
path; otherwise make the test wait on the write deterministically (join the worker or poll with a
bound), never a sleep.

## Context

### Relevant Files (REQUIRED)
- `src/backend/tests/test_t15050_upload_observability.py` (`TestReasonlessBeacon`, `_beacon_rows`)
- `src/backend/app/routers/games_upload.py` (`upload_failure_beacon`)
- `src/backend/app/services/upload_failures.py` (`record_upload_failure`)

## Acceptance Criteria

- [ ] With `user_data` on a slow mount the test passes 10 of 10 isolated runs.
- [ ] Either the production beacon write is shown to be durable before the 204, or it is made so.
