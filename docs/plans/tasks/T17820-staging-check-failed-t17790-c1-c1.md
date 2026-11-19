# T17820: Staging check failed: T17790:C1 C1: A browser check at the stated real-touch sizes confirms

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-19
**Updated:** 2026-11-19

## Problem

Found by the staging check after PR #840 merged (group g-t17780-3, 7f0328136). Impact and complexity are unscored defaults.

**Steps:** After PR #840 merged (7f0328136), run `npx playwright test e2e/checks/T17790.check.spec.js --grep 'T17790:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: A browser check at the stated real-touch sizes confirms every listed control is at least 44 x 44 pixels.

**Actual:** fail: Error: annotate-mark-play-button rendered

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.

## Owner-session findings on staging (2026-11-19, after PR #840 deployed)

The product fix is live and correct; the check's setup is what failed.

- Measured by hand on staging, as e2e-gate@test.local, 844x390 with touch, game `game-desktop` (6 plays) in Mark Plays: Mark play, Watch plays, Share game and Add video are each 126.5 x 44, the All filter is 44 x 44, labels fully visible, no overlaps.
- Why the check failed: `openClippedGame` presses "Forward 5 seconds" 30 times to reach open video. This game is only 1:29 long, so the playhead clamps at the end, inside Play 2 (1:23 onward). With a play under the playhead, the action bar swaps to "Edit play / Make new highlight" and the four tiles never render ("annotate-mark-play-button rendered" fails). On the dev fixture the game is long enough that 150 s lands in a gap.
- Fix the check, not the app: step forward only until `annotate-mark-play-button` is visible (stop as soon as it is), or seek to a gap computed from the game's clip ranges; fail loudly if no gap exists. The playhead at 0:00 on this game already shows the four tiles.
