# T17350: Staging check failed: T17230:C2 C2: Changing the shape after positions exist asks to confirm,

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #823 merged (group g-t17200-4, 9876c5da0). Impact and complexity are unscored defaults.

**Steps:** After PR #823 merged (9876c5da0), run `npx playwright test e2e/checks/T17230.check.spec.js --grep 'T17230:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C2: Changing the shape after positions exist asks to confirm, from wherever it is changed.

**Actual:** fail: Error: a project whose game video Frame can play

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
