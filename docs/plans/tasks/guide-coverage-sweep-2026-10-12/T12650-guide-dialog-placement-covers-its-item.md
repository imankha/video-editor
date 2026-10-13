# T12650: Guide dialog placement: it covers the item it describes on phones and sits beside, not above, bottom items on desktop

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity HIGH at 390, MED elsewhere). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

Placement rule (T12590): near the item, on the side facing the screen centre, never covering the item or the primary action. Failures observed 2026-10-12:

- 390x844 Focus step 2 ("Tap Play"): the docked dialog (y 434 to 574) sits exactly over the video control row, so Play is hidden until Got it ([f1-390](../../ux/2026-10-11-guide-coverage-sweep/screens/f1-390.jpg); [f-free-390](../../ux/2026-10-11-guide-coverage-sweep/screens/f-free-390.jpg) shows where Play is). Step 3 (pause and drag) has the same cover.
- 390 Home Games "Open Finished" and Clips: the docked dialog covers the lower half of the game card or clip tile that is the sharp cutout ([h-games-390](../../ux/2026-10-11-guide-coverage-sweep/screens/h-games-390.jpg), [h-Clips-390](../../ux/2026-10-11-guide-coverage-sweep/screens/h-Clips-390.jpg)).
- 1440, 1024 and 768 Focus step 4 (Preview highlight is the bottom-right band tile): the dialog is placed left of the tile, over the Generate and Trim tiles, instead of above it ([f4-1024](../../ux/2026-10-11-guide-coverage-sweep/screens/f4-1024.jpg), [f4-768](../../ux/2026-10-11-guide-coverage-sweep/screens/f4-768.jpg)).
- 1440 Annotate watch steps: a full-width docked strip covers the timeline and the Mark play cards, which are below the fold at 900 px ([t1-annotate-markplay-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-annotate-markplay-1440.jpg)).
- 1024 and 768 Annotate selected play: the docked dialog covers Make highlight; the anchor (Edit play) is off-screen with no shade ([a-open-1024](../../ux/2026-10-11-guide-coverage-sweep/screens/a-open-1024.jpg), [a-open-768](../../ux/2026-10-11-guide-coverage-sweep/screens/a-open-768.jpg)).

Passes: Home at 1440 and 1024 (dialog beside the card), 768 Annotate Mark play (above), 390 Focus step 4 (above), 768 Focus step 1 (below the video).

## Solution

In `placement.js`, prefer the vertical side facing the centre for items in the bottom or top 25 percent of the viewport, and on phones dock on the side opposite the anchor so it never overlaps the anchor rect. Add a unit test per case above using real rects (anchor and dialog must not intersect).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/placement.js`
- `src/frontend/src/components/instructions/FloatingCoach.jsx`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12650:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
