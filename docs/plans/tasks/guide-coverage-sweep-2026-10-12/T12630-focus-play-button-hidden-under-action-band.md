# T12630: Focus: the Play button the guide names is under the action band at 1440x900 and 1024x768, and Generate stays locked until the user plays

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity HIGH). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

At 1440x900 and 1024x768 the Focus action band (`data-testid="action-band"`, 233 px tall from y=667 at 1440x900) covers the video's own control row. `document.elementFromPoint` on the Play button returns the band, so "Step 2 of 5: Tap Play and watch your athlete" names a button the user cannot press ([t1-focus-step2-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-focus-step2-1440.jpg), [t1-focus-free-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-focus-free-1440.jpg), [f4-1024](../../ux/2026-10-11-guide-coverage-sweep/screens/f4-1024.jpg) where the same band hides the video bottom). The T12580 cutout includes the covered region, so it does not help.

Worse, Generate highlight stayed disabled ("Drag the box onto your player to unlock") after the box was dragged; it only unlocked after the video was played and paused with the Space key, a hidden gesture. This is parent-audit finding 1 (CRITICAL) still half open: the visible label names one unlock step, the real gate needs two, and one of them is not clickable at these sizes. At 768x1024 and 390x844 the Play button is reachable.

## Solution

Reserve the band's height under the video (layout, not overlay) at 1440x900 and 1024x768, or move the Play control above the band. Make the unlock label list what really unlocks Generate (drag, then play), or drop the play requirement. T12440 was marked fixed; re-open its acceptance check at these two sizes and add a Playwright check that Play is reachable by `elementFromPoint`.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/focus/FramingActionRow.jsx`
- `src/frontend/src/modes/FocusModeView.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12630:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
