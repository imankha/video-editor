# T12490: Phone "Tags and Notes" dialog has no Done button

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N5 (severity HIGH). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

At 390 "Tags and Notes" opens a full-screen dialog whose only exit is a 32 px unlabeled X at the top right. The Done button underneath is unreachable until the user finds the X. The toggle then reads "View Tags and Notes".

Screenshots: rr-67-m390-play-editor-tags.

## Solution

Add a full-width "Done" at the bottom of the dialog and give the X an accessible name "Close" and a 44 px target.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/annotate/components/AddDetailsPopup.jsx`
- `src/frontend/src/modes/annotate/components/DetailsFields.jsx`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12490:`

## Acceptance Criteria

- [ ] At 390 the dialog has a visible bottom Done that closes it
- [ ] The Close X has an accessible name and a 44 px tap target
- [ ] Test written first

## Evidence screenshots

Kept in `screens/T12490/` (delete that folder when this task is archived):

- [rr-67-m390-play-editor-tags.jpg](screens/T12490/rr-67-m390-play-editor-tags.jpg)
