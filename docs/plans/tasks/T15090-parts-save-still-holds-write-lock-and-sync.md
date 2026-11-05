# T15090: T15030 acceptance miss: PATCH /parts still holds the per-user lock across a full profile.sqlite R2 sync

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Tier:** M (backend + frontend)
**Created:** 2026-11-04
**Updated:** 2026-11-04
**Milestone:** Production incident 2026-11-04 follow-ups, see PLAN.md

## Source

Post-merge review of PR #706 (T15030 + T15060), reviewer run 2026-11-04, plus the two-flow Playwright check against the g-t15030-4 stack.

## Problem

T15030's first criterion (no `WRITE_LOCK_WAIT` above 2 s on `/parts` in a 10-file clip batch with a 2 s sync delay) was not met and PR #706 merged anyway. Playwright saw 3.6 s and 5.2 s waits when two flows overlapped.

`middleware/db_sync.py` holds the per-user asyncio lock across the whole handler plus the R2 sync of `profile.sqlite`, for every POST/PUT/PATCH/DELETE. T15030 cut the PATCH count (11 to 2 for an 11-part file) but not the cost of each. T15060 made each sync slower (checkpoint, `backup()` into a temp file, upload). The task's "light write" option (update `parts_json` without marking the DB dirty for the R2 sync) was not taken.

## Solution

Expert agent first: what exactly holds the lock in the overlapping-flow run (reproduce with the 2 s sync delay), then either:
- make `/parts` a light write (resume state is validated against R2 on prepare), so only prepare and finalize sync; or
- record in T15030 that the criterion is knowingly waived, with the measured numbers.
Also decide whether the `backup()` snapshot cost needs a size threshold (note in `persistence-sync.md`).

## Acceptance Criteria

- [x] 10-file clip batch with a 2 s artificial sync delay shows no `WRITE_LOCK_WAIT` above 2 s on `/parts` (log evidence)
- [x] Finalize stays a durable write (T4320); crash-resume still resumes from the last saved batch
- [x] Knowledge doc records the chosen cadence and what holds the lock

## Outcome

Light write, plus a resume rebuilt from R2 ListParts (a light write alone resumed 0 of 16 saved parts after a hard crash). Criterion 1 is measured on a model (real middleware and lock code, FakeR2 with a 2 s upload delay), not Playwright; the two-tab stack check and a staging ETag check remain. Finalize and prepare still wait behind the in-lock retry. See persistence-sync.md section T15090.

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py`
- `src/backend/app/routers/games_upload.py`
- `src/backend/app/storage.py`

### Related Tasks
- T15020, T15030, T15040, T15050, T15060 (merged in PR #706)
