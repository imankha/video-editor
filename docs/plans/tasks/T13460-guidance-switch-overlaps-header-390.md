# T13460: At 390 the Guidance switch overlaps the Home header and the Annotate header

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Tier:** M (frontend layout)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, at 390x844 (report bugs 1 and 11). Screenshots `home-390.png`, `home2-390.png`, `annotate-390.png` in `C:\Users\imank\Desktop\staging-qa-part2-2026-10-26\`.

## Problem

The Guidance switch is a fixed floating pill at the top centre. At 390:

- **Home:** it sits over the header row between the credits chip and the download icon, and covers the top of the ReelBallers logo.
- **Home while loading:** it overlaps the "Connecting to server..." banner and hides the account icon on the right.
- **Annotate:** it butts against and overlaps the play-count button ("4") beside the game title.

Same class of issue as T13190 (Finished viewer header), which was fixed opt-in per screen.

## Solution

Give the switch a reserved slot in each header at narrow widths (or a shared header layout that reserves it) instead of floating over content. Check Home (loaded and loading), Annotate, Frame, Overlay at 390 and 768.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/GuidanceToggle.jsx`
- Home header, Annotate header components
- `src/frontend/e2e/guide-no-overlap.spec.js`
- `.claude/knowledge/guidance.md`

### Related Tasks
- T13190 (same issue in the Finished viewer)

## Acceptance Criteria

- [ ] At 390 and 768 the switch overlaps no logo, icon, button or banner on Home (loaded and loading) and Annotate
- [ ] `guide-no-overlap.spec.js` covers these screens at 390

## Repro steps

1. 390x844, Guidance on. Load /home/games; screenshot during "Connecting to server" and after load.
2. Open any game in Annotate; screenshot the header.
3. For each, compare the switch's bounding box with the logo, account icon, credit chip, banner and plays button boxes.

**Expected:** no intersection.
**Actual (before fix):** switch covers the logo top and the account icon (loading), and overlaps the plays-count button in Annotate.

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro, record the overlapping boxes; add these screens at 390 to `guide-no-overlap.spec.js` and see them fail.
2. **After the fix:** rerun at 390 and 768; no intersections; spec passes.

## Progress Log
- 2026-10-27 QA pass 2 (staging): PARTIAL VERIFIED at 390 only: switch box has no intersecting buttons on Home and in Annotate. 768 not run. See T13770 for the open Plays drawer / Play details sheet at 390.
