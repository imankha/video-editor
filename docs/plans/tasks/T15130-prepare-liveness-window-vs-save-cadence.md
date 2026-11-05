# T15130: T15040's 60 s liveness window is shorter than T15030's save interval: a live slow upload looks dead

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Tier:** M (backend + frontend)
**Created:** 2026-11-04
**Updated:** 2026-11-04
**Milestone:** Production incident 2026-11-04 follow-ups, see PLAN.md

## Source

Post-merge review of PR #706 (T15040 + T15030), reviewer run 2026-11-04, plus the two-flow Playwright check against the g-t15030-4 stack.

## Problem

`last_part_at` is stamped only when a session is created, when prepare resumes it, and on a `PATCH /parts` save. After T15030 a save happens only every 8 parts (40 MB), or once at the end for a file of 8 parts or fewer. `IN_FLIGHT_WINDOW_SECONDS = 60`. On a ~5 Mbps uplink a batch takes ~65 s, and a file of 40 MB or less has no save until the end.

A second flow (same file re-picked in another tab, or a retry) that calls prepare after 60 s without a save sees `is_live = 0`, takes the resume branch, gets presigned URLs and re-uploads the same parts. That is the duplicate-upload and finalize race T15040 exists to stop, and it hits the users with the worst connections. Neither T15040 test covers the interaction (the in_progress wait test mocks `fetch`; the backend test sets `last_part_at` by hand).

## Solution

Design note first. Options, cheapest first:
- stamp `last_part_at` on a lightweight heartbeat the client sends while parts are in flight (a light write that does not mark the profile DB dirty, see T15090), so liveness does not depend on save cadence;
- bound the client save batch by time as well as count (save at least every ~20 s);
- widen the window to comfortably exceed the longest save interval (weakest: only moves the cliff).

## Acceptance Criteria

- [ ] Backend test: a session whose last save is older than the window but whose heartbeat is recent returns `in_progress`; a session with no heartbeat and no save for the window resumes
- [ ] A slow-uplink scenario (throttled upload, file under 40 MB) re-picked in a second flow never starts a second part upload
- [ ] Knowledge doc `backend-services.md` states the liveness signal and the interval-versus-window rule

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py`
- `src/frontend/src/services/uploadManager.js`
- `src/backend/tests/test_t15040_prepare_in_flight_guard.py`

### Related Tasks
- T15020, T15030, T15040, T15050, T15060 (merged in PR #706)
