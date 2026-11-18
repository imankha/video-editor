# T17130: Failed upload tile text cut off

**Status:** STAGING
**Impact:** 3
**Complexity:** 1
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

On Home, a game whose upload did not finish shows a red "Upload incomplete" tile with the sentence "Upload didn't finish. Retry to resume, or discard". On a desktop the end of that sentence runs under the "Retry" and "Discard" buttons, so the parent reads "...Retry to resume, or" and the rest is hidden. The full sentence should be readable.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as e2e@test.local, at desktop 1440x900.

## Repro steps

1. Sign in as e2e@test.local (has several failed uploads) at 1440x900.
2. Home, Games tab, look at any "Upload incomplete" tile.

**Expected:** the whole sentence is visible above the buttons.
**Actual:** the last word "discard" is covered by the buttons.
**Repeats:** always (every failed tile)
**Also checked at:** not checked at phone size.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/r2-B12-failed-tile-text.png` (local, not in git)
- Console, network, server log: nothing relevant.

## Solution

The failed-upload tile's sentence is fully readable at every size.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: At 1440x900 the whole sentence on a failed-upload tile is visible and not covered by its buttons.
- [ ] C2: The same at 390x844 and 768x1024.
