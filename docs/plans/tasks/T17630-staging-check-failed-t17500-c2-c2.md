# T17630: Staging check failed: T17500:C2 C2: Opening Frame on a play whose saved clip is

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #830 merged (group g-t17500-2, ce8988c54). Impact and complexity are unscored defaults.

**Steps:** After PR #830 merged (ce8988c54), run `npx playwright test e2e/checks/T17500.check.spec.js --grep 'T17500:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C2: Opening Frame on a play whose saved clip is HEVC, in a browser without HEVC, shows the message instead of a silent black box.

**Actual:** fail: Error: Timeout 60000ms exceeded while waiting on the predicate

## Acceptance Criteria

- [x] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/e2e/helpers/frameVideoCheck.js` (new): `openFrame` and the fixture helpers, moved out of the T17500 check.
- `src/frontend/e2e/checks/T17500.check.spec.js`: uses the helper.

### Cause (2026-11-18)

The check opened the first play in `/projects` with a clip. On the shared staging account both listed plays sit on game 2, whose upload never finished (`storage_status` 'uploading'), so Frame showed "Game video still uploading" and never mounted a `<video>`; the check timed out waiting for it. `/projects` leaves out finished highlights, which is why no other play was offered. No app bug: `openFrame` now opens a play whose `playback-url` answers 200, an expired game's saved clip first (the C2 case itself).
