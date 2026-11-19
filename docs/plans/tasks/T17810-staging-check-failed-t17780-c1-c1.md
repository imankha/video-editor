# T17810: Staging check failed: T17780:C1 C1: A browser check at the stated real-touch sizes confirms

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-19
**Updated:** 2026-11-19

## Problem

Found by the staging check after PR #840 merged (group g-t17780-3, 7f0328136). Impact and complexity are unscored defaults.

**Steps:** After PR #840 merged (7f0328136), run `npx playwright test e2e/checks/T17780.check.spec.js --grep 'T17780:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: A browser check at the stated real-touch sizes confirms every listed control is at least 44 x 44 pixels.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeEnabled[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.

## Owner-session findings on staging (2026-11-19, after PR #840 deployed)

Looked at the screens by hand as e2e-gate@test.local. The check never reached the Delete text control; the failure is in its setup, not in the T17780 fix.

- The account has no framed project (`has_working_video` false on both), only two single-play drafts, both named "Play 2" (projects 9 and 10, from game `game-desktop`); balance 15 credits.
- Opening `/focus/p/10` at 1440x900 shows no "Sharpen my highlight" button at all. Instead: "We couldn't read this play's frame rate, so its framing can't be timed correctly and it can't be made into a highlight", "This highlight has nothing to show", and in the stage "Game video still uploading". The check's `toBeEnabled` on Sharpen times out there.
- The same game opens and plays in Mark Plays (Annotate), and its 6 plays list fine.

To do: find out whether this is broken seeded data on the gate account (game upload never finalized / fps missing) or a real Frame bug on a play from an uploaded game. If it is data, make the check able to reach Spotlight on staging (e.g. a seeded framed project on the gate account per e2e/STAGING-GATE.md) rather than sharpening at check time; if it is a product bug, file it separately and keep this task about the check. T17780:C2 timed out on the same setup.
