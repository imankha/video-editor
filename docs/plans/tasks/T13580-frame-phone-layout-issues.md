# T13580: Frame on a phone: trim lane hidden, landscape overlaps, cut-off hint, Settings ignores Escape

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Tier:** M (frontend layout)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26 (report bugs 20, 21, 23, 24, 25, 26).

## Problem and repro steps (each a separate check, Guidance on)

**A. Trim and slow motion opens off-screen (bug 21), 390x844.** Frame a play > Preview highlight > tap "Trim and slow motion". Nothing visible changes: the speed/trim lane opens below the fold behind the fixed bottom panel (~330 of 844 px). Expected: the lane comes into view. Screenshot `BUG-21-trim-lane-below-fold-390.png`.

**B. Phone landscape (bug 20), 844x390.** Rotate to landscape in Frame. The Guidance switch covers the top of Preview in the right rail, the clock at bottom-left is clipped, the "More room in landscape" tip covers part of the crop box. Expected: nothing overlaps. Screenshot `BUG-20-landscape-switch-over-preview-844.png`.

**C. Loading state (bug 23), 390x844.** Open Frame: "No video loaded" shows for ~5 s before the video. Expected: a loading indicator.

**D. Rotate hint cut off (bug 24), 390x844.** The hint reads "larger video / Everything here also works upright"; its first words are hidden behind the icon. Expected: full sentence visible.

**E. Switch over the crop status icon (bug 25), 390x844.** The Guidance switch overlaps the framing-status icon in the header (same class as T13460).

**F. Settings sheet ignores Escape (bug 26).** Open Settings, press Escape: it stays open (also after rotating and back).

**G. Play starts late with no indicator (bug 54), 1440x900.** Veo-made game in Frame, press Play: clock stays ~1.3 s for ~25 s with no spinner, then plays. Console: repeated `[VIDEO] Waiting ... (phantom)`.

## Context

### Relevant Files
- Frame screen layout, bottom action panel, rotate hint, Settings sheet
- `.claude/knowledge/keyframes-framing.md`

### Related Tasks
- T13460 (switch overlaps headers)

## Verify the fix (required, before and after)

1. **Before the fix:** run A-G at the stated sizes and keep a screenshot/measurement of each failure (for A: the lane's top vs the bottom panel's top); add layout tests for A, B, F that fail.
2. **After the fix:** rerun A-G on the same play at the same sizes and attach the passing results.

## Acceptance Criteria

- [ ] A-G pass
- [ ] Tests fail before, pass after
