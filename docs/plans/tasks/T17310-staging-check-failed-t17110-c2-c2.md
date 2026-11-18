# T17310: Staging check failed: T17110:C2 C2: The same at 360x640 and 768x1024.

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #820 merged (group g-t17080-4, 08a772d17). Impact and complexity are unscored defaults.

**Steps:** After PR #820 merged (08a772d17), run `npx playwright test e2e/checks/T17110.check.spec.js --grep 'T17110:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C2: The same at 360x640 and 768x1024.

**Actual:** fail: TimeoutError: locator.click: Timeout 60000ms exceeded.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
