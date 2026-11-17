# T16810: Staging check failed: T16750:C1 With Preview playing, Sharpen, then Finished opens: the Frame video

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Problem

Found by the staging check after PR #806 merged (group g-t16750-2, 3e14ab3a3). Impact and complexity are unscored defaults.

**Steps:** After PR #806 merged (3e14ab3a3), run `npx playwright test e2e/checks/T16750.check.spec.js --grep 'T16750:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** With Preview playing, Sharpen, then Finished opens: the Frame video is paused (browser check reading every `<video>` element's `paused`).

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeEnabled[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
