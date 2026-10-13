# T12620: Guide shade leaves the control the sentence names shaded and unclickable

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity HIGH). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

T12580 shades everything except the step's anchor. For several rules the anchor is not the control the sentence names, so the user cannot do what the dialog says until they press Got it. Observed on staging 2026-10-12:

- `home.clips.*` ("Pick up where you left off. Tap a clip to finish its highlight." and the empty Clips state "Open a game in Games"): the sharp cutout is the heading "Highlights in progress"; the clip tile, the Games tab and the Upload highlight button are shaded ([h-Clips-1024](../../ux/2026-10-11-guide-coverage-sweep/screens/h-Clips-1024.jpg), [blank Clips 1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-blank-Clips-focused-1440.jpg)).
- `home.finished.first` ("Tap it to share it or download it"): the cutout is the caption "View your completed work."; the highlight, Share and Download are shaded ([t2-finished-tab-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t2-finished-tab-1440.jpg)).
- Home Games after a finish ("Your highlight is ready to share. Open Finished."): the cutout is the game card; the Finished tab the text names is shaded ([h-games-390](../../ux/2026-10-11-guide-coverage-sweep/screens/h-games-390.jpg)).
- `annotate.editor` ("Drag the green ends ... Pick how good it was, then tap Done"): only Done is sharp; the ends and the rating buttons are shaded ([t1-play-editor-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-play-editor-1440.jpg)).
- `annotate.selected.*` ("Tap Edit play to adjust this play"): the cutout is the Edit play card while Portrait and Landscape Make highlight (the shortest path to an export) are shaded and, at 768 and 390, covered by the dialog ([t1-after-esc-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-after-esc-1440.jpg), [a-open-768](../../ux/2026-10-11-guide-coverage-sweep/screens/a-open-768.jpg)).

## Solution

Make every guide rule's cutout contain every control its sentence tells the user to press (a per-rule `keepClear` list, or point the anchor at the real control), and make the selected-play step point at Make highlight, not Edit play. Add a test per rule that asserts the named control is inside the cutout.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/components/instructions/catalog.js`
- `src/frontend/src/components/instructions/FloatingCoach.jsx`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12620:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
