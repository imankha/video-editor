# T13770: At 390 the Guidance switch covers the close button of the Plays drawer and the Play details sheet

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Tier:** M (frontend layout)
**Created:** 2026-10-27
**Updated:** 2026-10-27
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA pass 2, 2026-10-27, 390x844 touch, account imankh+stg-qa-20261025@gmail.com. Found while verifying T13460, which only measured the closed Home and Annotate screens.

## Problem

In Annotate on a phone, two full-height panels open over the screen: the Plays drawer (header button with the play count) and the Play details sheet (after tapping a play's info button). In both, the Guidance switch (box 269..374 x 16..60) is drawn above the panel header and sits exactly over its close control, so the close button cannot be seen or tapped. A tap on the panel's back arrow at the left reopened the Plays drawer instead of closing it. In the Play details sheet a floating timeline tooltip ("0:51 | 4. Play 3") also draws over the "My athlete / Team" toggle.

## Repro steps

1. 390x844 touch, Guidance on, account above, Default profile.
2. Home > Games > open "Vs Carlsbad QA".
3. Tap the plays-count button in the header (the "6" chip left of the switch). The Plays drawer opens.
4. Compare the Guidance switch box with the drawer's close X (top right of the drawer, about x 290..320, y 10..45).
5. Tap the "i" button on the "4. Play 3" row to open Play details; look at the header and the Who is this play about row.

**Expected:** the switch does not cover any control of the open panel; the close button is visible and tappable; no timeline tooltip draws over the panel content.
**Actual:** switch covers the close X in both panels; the tooltip covers the toggle.

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro and record the switch box and the close button box (they intersect); add the open drawer and the open Play details sheet at 390 to `guide-no-overlap.spec.js` and see them fail for that reason.
2. **After the fix:** rerun at 390 and 768; no intersection with any visible control while each panel is open; spec passes.

## Acceptance Criteria

- [ ] With the Plays drawer open at 390, the Guidance switch intersects no visible button
- [ ] Same for the Play details sheet, and the timeline tooltip does not draw over it
- [ ] Spec cases fail before, pass after
