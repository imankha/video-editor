# T12540: Report a problem button, toasts and the scroll chevron cover controls

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N8, N9 (severity MED). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

Report a problem covers the Copy link icon, the right end of Delete play and the Add footage card; the "Finished" toast covers Create share link and "Highlight with spotlight ready" covers the "Done for now" tile; the amber scroll chevron covers a toast, a timeline marker and, in landscape 844x390, the Upload game button (where the guide also hides the tabs).

Screenshots: rr-53, rr-06, rr-05, rr-52, rr-51, rr-74-m390-play3-after-done-0.5s, sweep-annotate-320x568, sweep-home-games-844x390.

## Solution

Move Report a problem off content (header menu) or give it a gutter; stack toasts clear of CTAs; keep the chevron out of controls. Check at 1440, 390 and 844x390.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/ReportProblemButton.jsx`
- `src/frontend/src/components/shared/Toast.jsx`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12540:`

## Acceptance Criteria

- [ ] No floating element covers a control at 1440, 390 and 844x390 on the screens in the evidence

## Evidence screenshots

Kept in `screens/T12540/` (delete that folder when this task is archived):

- [rr-05-annotate-ready-1440.jpg](screens/T12540/rr-05-annotate-ready-1440.jpg)
- [rr-05-annotate-scrolled-to-cards-1440.jpg](screens/T12540/rr-05-annotate-scrolled-to-cards-1440.jpg)
- [rr-06-annotate-play-editor-1440.jpg](screens/T12540/rr-06-annotate-play-editor-1440.jpg)
- [rr-51-overlay-ready-1440.jpg](screens/T12540/rr-51-overlay-ready-1440.jpg)
- [rr-52-after-finish-1440.jpg](screens/T12540/rr-52-after-finish-1440.jpg)
- [rr-53-share-modal-1440.jpg](screens/T12540/rr-53-share-modal-1440.jpg)
- [rr-74-m390-play3-after-done-0.5s.jpg](screens/T12540/rr-74-m390-play3-after-done-0.5s.jpg)
- [sweep-annotate-320x568.jpg](screens/T12540/sweep-annotate-320x568.jpg)
- [sweep-home-games-844x390.jpg](screens/T12540/sweep-home-games-844x390.jpg)
