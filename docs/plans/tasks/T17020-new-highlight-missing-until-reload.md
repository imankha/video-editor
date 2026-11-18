# T17020: New highlight missing until reload

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

When a parent's highlight finishes sharpening, the app tells them "Your highlight is ready. Tap it to share it or download it." But the Highlights tab on Home does not show the new highlight until the page is reloaded. On a phone the list was empty under the "Your highlights" heading, so there was nothing to tap. On desktop and iPad the tab counter and the game's group count stayed at the old number and the new highlight was missing from its game's group. This happened after all three sharpens in the pass. The new highlight should appear in the list, with the right counts, the moment it is ready.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as imankh+qa-2026-11-17b@gmail.com, at phone 390x844, desktop 1440x900 and iPad 768x1024.

## Repro steps

1. Sign in as a parent with Guidance on, at phone size 390x844.
2. Make a highlight from a play and tap "Sharpen my highlight".
3. While it sharpens, tap the back arrow to Home (Plays tab).
4. When the tile changes to "Nothing in progress. Your highlight is in Highlights.", tap "Go to Highlights".
5. Wait 10 seconds. Do not reload.

**Expected:** the new highlight's tile is in the list and the counts include it.
**Actual:** phone: Highlights tab shows "1" but the list has no tile at all; the tile appears only after reload. Desktop (second highlight, via Done then Home, Highlights): tab says "1" while two highlights exist; "2" after reload. iPad (third highlight, waiting on the Highlights tab): the game's group still said 1 and the new tile was missing; "2 new 2" and the tile after reload.
**Repeats:** always (3 of 3 sharpens, three devices)
**Also checked at:** all three device classes, as above.

## Evidence

- Screenshots: `qa/qa-pass-2026-11-17/bugs/r2-B03-phone-no-tile.png`, `r2-B03-phone-after-reload.png`, `r2-B03-desktop-count-1-of-2.png`, `r2-B03-ipad-group-stale.png` (local, not in git)
- Console: no errors; desktop warnings only ("[ExportButtonContainer] Duplicate export trigger ignored", video buffering).
- Network: no failing requests.
- Server log: no errors in `fly logs` for the window.

## Solution

When a sharpen finishes, Home's Highlights list, tab counter and group counts update to include the new highlight without a reload.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: At 390x844, after a sharpen finishes while the parent is on Home, "Go to Highlights" shows the new highlight's tile without a reload.
- [ ] C2: At 1440x900 and 768x1024, the Highlights tab counter and the game's group count include the new highlight without a reload.
