# T17640: Staging check failed: T17500:C4 C4: Normal H.264 videos show no message anywhere.

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #830 merged (group g-t17500-2, ce8988c54). Impact and complexity are unscored defaults.

**Steps:** After PR #830 merged (ce8988c54), run `npx playwright test e2e/checks/T17500.check.spec.js --grep 'T17500:C4'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C4: Normal H.264 videos show no message anywhere.

**Actual:** fail: Error: Timeout 60000ms exceeded while waiting on the predicate

## Acceptance Criteria

- [x] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/e2e/helpers/frameVideoCheck.js`: `openFrame`, fixed under T17630.
- `src/frontend/e2e/checks/T17640.check.spec.js`: runs T17500:C4's flow.

### Cause (2026-11-18)

Same as T17630: the check opened the first play in `/projects`, which on the shared staging account sits on game 2, whose upload never finished, so Frame showed "Game video still uploading" and never mounted a `<video>`. No app bug; T17630's `openFrame` fix (open a play whose `playback-url` answers 200) makes T17500:C4 pass on staging.
