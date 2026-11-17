# T16730: Staging check failed: T16525:C2 A parent who returns later sees the same message and

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Problem

Found by the staging check after PR #796 merged (group g-t16525-1, 94928afa1). Impact and complexity are unscored defaults.

**Steps:** After PR #796 merged (94928afa1), run `npx playwright test e2e/checks/T16525.check.spec.js --grep 'T16525:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** A parent who returns later sees the same message and finds the highlight in Highlights.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

**History (added 2026-11-17).** This criterion has failed twice on the same code, so it is intermittent, not a one-off:
- On the dev stack, the /dotask verify round on 8b3b543ac (2026-11-17 about 05:30 UTC) failed T16525:C2; a later run on the same commit (06:39 UTC) passed it.
- On staging after #796 merged (94928afa1), it failed again (07:11 UTC); C1, C3 and C5 passed.

Likely cause to test first: a timing race. C2 reloads /home right after the sharpen and expects the recovery card to say "Your highlight is in Highlights". If the card reads GET /api/exports/unacknowledged before the server's automatic finish (T16520) has published the final video, `finished` is false and the card shows the old "ready" text. If that is it, it is a real product bug (a parent who comes back quickly sees the old message), not only a weak check: fix the product, not the check's wait. If instead the check reloads too early for any parent to be there, say so with evidence and fix the check.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
