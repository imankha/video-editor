# T13560: At 390 the upload dialog's Game Type buttons overflow and the dialog scrolls sideways

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Tier:** S (frontend layout + copy)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, 390x844 (report bug 15, screenshot `BUG-15-upload-details-sideways-390.png`).

## Problem

In Upload game > Game details (optional), the Game Type row (Unknown / Home / Away / Tournament) is 330 px wide inside a 300 px box: "Tournament" sticks out past the card and the details panel scrolls sideways (visible horizontal scrollbar). Same row appears in the Veo "Make a game" picker and Edit Game Details. Also the selected 10 KB file shows as "0.0 MB".

## Repro steps

1. Viewport 390x844, Home > Upload game.
2. Choose `formal annotations/test.short/game2-test.mp4`.
3. Open "Game details (optional)".
4. Run `[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1 && e.clientWidth>200).length`.

**Expected:** 0 overflowing elements, all four buttons inside the card; size shows "10 KB".
**Actual (before fix):** 4 overflowing containers, Tournament cut at the edge, "0.0 MB".

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro and record the overflow count and the size text; a component/e2e test at 390 asserting no horizontal overflow must fail.
2. **After the fix:** same steps: 0 overflow, readable size.

## Acceptance Criteria

- [ ] No sideways scroll in the details step at 390 (also check the Veo picker and Edit Game Details)
- [ ] Small files show a sensible size
- [ ] Test fails before, passes after
