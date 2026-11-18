# T16920: Staging check failed: T16890:C2 C2: The complete card form is reachable at 768 x

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #813 merged (group g-t16890-1, 1e4e0998f). Impact and complexity are unscored defaults.

**Steps:** After PR #813 merged (1e4e0998f), run `npx playwright test e2e/checks/T16890.check.spec.js --grep 'T16890:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C2: The complete card form is reachable at 768 x 1024, 1024 x 768 and the supported desktop sizes, with touch checks on phone and tablet.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
