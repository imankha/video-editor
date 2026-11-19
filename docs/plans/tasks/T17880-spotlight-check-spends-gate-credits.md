# T17880: The Spotlight staging check spends the gate account's credits and then cannot run

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-19
**Updated:** 2026-11-19

## In plain words

The T17780 browser check (Spotlight "Delete text" control is a finger-sized target) has never run on staging. The staging test account (`e2e-gate@test.local`) has no project that already has a sharpened video, so the check sharpens a draft play itself first. Every run spends real credits on that account. On 2026-11-19, after PR #843 fixed the check's earlier setup problem, a hand run against staging got as far as Sharpen and stopped at "Buy credits": the export needed 8 credits and the account had 7 (it had 15 that morning). The check then timed out after 8 minutes. T17780:C2 never ran because it shares the same setup.

The Mark Plays checks (T17790:C1, C2) passed on staging in the same run, so only the Spotlight check is affected. The product change from T17780 has still not been seen on staging by any check.

## Evidence

- Run: 2026-11-19 ~14:20 PT, master d72db6dfd, `E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local npx playwright test e2e/checks/T17790.check.spec.js e2e/checks/T17780.check.spec.js`: 2 passed (T17790), 1 failed (T17780:C1, `locator.waitFor` 480000 ms on `focus-publish-action-bar`).
- Failure screenshot: Frame on draft "Play 6" (game `game-desktop`) with the Buy credits modal open: "This export requires 8 credits for 8.0s of video. Your balance: 7 credits. You need 1 more."
- Earlier the same day the account held two "Play 2" drafts that Frame refused (frame rate unreadable, "Game video still uploading"); see T17810's task file.

## Solution

Make the check not depend on spending credits at check time:

- Preferred: seed the gate account with one project that already has a sharpened (working) video, alongside its other fixture data (see `src/frontend/e2e/STAGING-GATE.md` and the gate seeding scripts it names), and make the check use it. The check then only opens Spotlight and measures.
- If a sharpen at check time is truly required, the check must fail fast and clearly when the balance is short (read the balance through the API first) instead of waiting 8 minutes on a modal, and the gate account's credits need a top-up path that does not rely on someone noticing.
- Do not quietly top up credits on staging as the fix; that only hides the drain until next time.

## Relevant Files

- `src/frontend/e2e/checks/T17780.check.spec.js`
- `src/frontend/e2e/STAGING-GATE.md`

## Acceptance Criteria

- [ ] C1: The T17780 check, run against staging as `e2e-gate@test.local`, reaches the Spotlight text timeline and measures the Delete text control without sharpening anything, so the account's credit balance is the same before and after the run.
- [ ] C2: Run twice in a row against staging, both T17780 checks (C1, C2) pass both times.
