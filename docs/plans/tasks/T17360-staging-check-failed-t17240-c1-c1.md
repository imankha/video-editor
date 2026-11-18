# T17360: Staging check failed: T17240:C1 C1: No two reel cards on one profile share a

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #823 merged (group g-t17200-4, 9876c5da0). Impact and complexity are unscored defaults.

**Steps:** After PR #823 merged (9876c5da0), run `npx playwright test e2e/checks/T17240.check.spec.js --grep 'T17240:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: No two reel cards on one profile share a name.

**Actual:** fail: Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
