# T16700: Staging check failed: T16660:C3 C3: An admin account still sees the Admin Panel as

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-16
**Updated:** 2026-11-16

## Problem

Found by the staging check after PR #795 merged (group g-t16660-2, b52b61c71). Impact and complexity are unscored defaults.

**Steps:** After PR #795 merged (b52b61c71), run `npx playwright test e2e/checks/T16660.check.spec.js --grep 'T16660:C3'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C3: An admin account still sees the Admin Panel as before.

**Actual:** fail: Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
