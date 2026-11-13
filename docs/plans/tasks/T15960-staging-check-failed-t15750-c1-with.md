# T15960: Staging check failed: T15750:C1 With Edit play open in portrait fullscreen, the picture is

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the staging check after PR #741 merged (group g-t15750-4, 9634b6862). Impact and complexity are unscored defaults.

**Steps:** After PR #741 merged (9634b6862), run `npx playwright test e2e/checks/T15750.check.spec.js --grep 'T15750:C1'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** With Edit play open in portrait fullscreen, the picture is at least 50% of the screen width.

**Actual:** fail: Error: dev-accounts/full failed (404): {"detail":"Not Found"}

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.

## Ruling

**Check problem, not a product bug** (owner, 2026-11-10). The staging check failed on a dev-only login (404), and after that was fixed the check skips because headless Chromium cannot enter real phone fullscreen. T15750:C1 and C2 are now `human` checks (a real iPhone). Resolve this task from the board; nothing is left to build.
