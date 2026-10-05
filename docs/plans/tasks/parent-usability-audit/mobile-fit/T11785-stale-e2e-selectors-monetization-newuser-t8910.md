# T11785: Stale e2e selectors block t4940, new-user-flow and T8910 specs

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-10-04
**Decision gate:** none (test-only bug fix)

## Epic Context

Epic B: [Fits on phones and tablets](EPIC.md). Found by T11770's proof-verifier/reviewer
while fixing a different stale-copy issue in these same specs. These are pre-existing,
unrelated to T11770's credit-cost-row change (confirmed stale on `origin/master` too), so
T11770 reported and left them for a dedicated task rather than scope-creeping.

## Problem

Three e2e specs are each blocked by their own stale selector/string, independent of each
other and of T11770:

1. `src/frontend/e2e/t4940-monetization-qa.spec.js:102,126` clicks `/Add Game/`, but the
   production button now reads "Upload game" — both of t4940's cases fail before reaching
   any of their real assertions (including the retention-copy check T11770 just fixed, which
   is consequently unproven live).
2. `src/frontend/e2e/new-user-flow.spec.js:~420` asserts `'Drop your whole game here'`, which
   no longer exists in production (now "Review game footage").
3. `src/frontend/e2e/T8910-add-footage-in-annotate.qa.spec.js` — the `beforeEach` checks
   `isEnabled()` before `annotateGameId` has wired up, so it skips on the seeded dev account
   even though the game IS loadable; separately, a line-83 `Close` click is flaky.

## Solution

Fix each spec's stale selector/ordering independently:
1. Update t4940's `/Add Game/` click to the current "Upload game" label (and re-verify its
   `/home/games` nav assumption still holds).
2. Update new-user-flow's dropzone string assertion to "Review game footage".
3. Fix T8910's `beforeEach` to wait for `annotateGameId` before checking enablement; stabilize
   the line-83 `Close` click (likely needs a wait condition, not a blind click).

## Relevant Files

- `src/frontend/e2e/t4940-monetization-qa.spec.js`
- `src/frontend/e2e/new-user-flow.spec.js`
- `src/frontend/e2e/T8910-add-footage-in-annotate.qa.spec.js`

## Acceptance Criteria

1. t4940's two cases reach and pass their real assertions (including the retention-copy
   check), run locally.
2. new-user-flow's dropzone assertion matches current copy, run locally.
3. T8910 no longer skips on the seeded dev account; the Close click is stable across 3 runs.

## Tests

Run each spec locally (Branch CI does not run Playwright) before and after the fix.
