# T15080: Every in_progress poll books an upload-attempted milestone and takes the per-user write lock

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Tier:** M (backend + frontend)
**Created:** 2026-11-04
**Updated:** 2026-11-05
**Milestone:** Production incident 2026-11-04 follow-ups, see PLAN.md

## Source

Post-merge review of PR #706 (T15040), reviewer run 2026-11-04, plus the two-flow Playwright check against the g-t15030-4 stack.

## Problem

In `prepare_upload`, `record_milestone(... game_upload_attempted / clip_upload_attempted)` and the R2 HEAD dedup check and balance check run BEFORE the pending-session lookup where the `in_progress` return sits. A waiting flow polls every 5 s (`IN_PROGRESS_POLL_MS`), so 60 s of waiting is 12 inflated "tried" counts and 12 Postgres writes. The code comments call tried >= succeeded load-bearing; this is a new inflation path with no cap.

Each poll is also a POST, so it takes the per-user write lock (`middleware/db_sync.py`) and does R2 and Postgres round trips while holding it. During the 2026-11-04 Playwright check, overlapping flows showed 3.6 s and 5.2 s `WRITE_LOCK_WAIT` on `PATCH /parts`; these polls are the likely contributor (see T15090).

## Solution

- Do the live-session check before the attempted milestone, the R2 HEAD and the balance check, so an `in_progress` answer does no side-effect work.
- Or make the status poll a read-only GET that bypasses the write lock.
- Backend test: N `in_progress` prepares for one session add zero `*_upload_attempted` milestones beyond the first.

## Acceptance Criteria

- [ ] N consecutive in_progress prepares record exactly one attempted milestone for the flow (test)
- [ ] An in_progress prepare does not take the per-user write lock or touch Postgres (test or log evidence)
- [ ] Re-run the two-flow Playwright check from the T15030-T15060 review: no `WRITE_LOCK_WAIT` above 2 s on `/parts`

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py`
- `src/backend/app/middleware/db_sync.py`
- `src/frontend/src/services/uploadManager.js`

### Related Tasks
- T15020, T15030, T15040, T15050, T15060 (merged in PR #706)
