# T12470: Guide bubble covers what it explains; two guides at once; guide points at missing buttons

**Status:** STAGING
**Impact:** 7
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N6, N7, N14, N18 (severity HIGH). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

The floating guide still sits on top of the thing it explains: the play editor description and Tags button, Focus step 4 over the Generate and Trim cards, the Text tip ON the Generate highlight button (and it stays after the text is deleted), Annotate card text, Clips body text. Also: the Share dialog shows its guide plus the Finished-tab bubble behind it; an empty second bubble lingers after Finish; a rendered draft still says "Step 2 of 5 Tap Play and watch your athlete"; with a play selected the guide says "tap Mark play for another moment" but the Mark play card is replaced by Portrait/Landscape/Edit play (confirms coach guidance outlives the first play, see T12390); an already generated draft shows "Back to preview" beside "Preview highlight: Finish the steps above to unlock".

Screenshots: rr-05, rr-06, rr-17, rr-18, rr-45, rr-56, rr-95, rr-96, rr-110, rr-113.

## Solution

Dock the bubble in a reserved strip (above the band), never over cards. Exactly one guide at a time, keyed to the real state. Guide copy may only name buttons that are on screen. Do after T12460 (same component) and read the guide-correction epic (T12230-T12300) first so this extends the resolver instead of adding a parallel path.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/FloatingCoach.jsx`
- `src/frontend/src/config/displayNames.js`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/modes/FramingModeView.jsx`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12470:`

## Acceptance Criteria

- [ ] The bubble never overlaps the CTA or control it describes at 1440 and 390 (placement test)
- [ ] At most one guide is visible; none linger after Finish or behind a dialog
- [ ] A rendered draft shows no step-by-step generate guide
- [ ] No guide copy names a button that is not on screen

## Evidence screenshots

Kept in `screens/T12470/` (delete that folder when this task is archived):

- [rr-05-annotate-ready-1440.jpg](screens/T12470/rr-05-annotate-ready-1440.jpg)
- [rr-05-annotate-scrolled-to-cards-1440.jpg](screens/T12470/rr-05-annotate-scrolled-to-cards-1440.jpg)
- [rr-06-annotate-play-editor-1440.jpg](screens/T12470/rr-06-annotate-play-editor-1440.jpg)
- [rr-110-focus-more-options-1440.jpg](screens/T12470/rr-110-focus-more-options-1440.jpg)
- [rr-113-overlay-after-delete-text-region-1440.jpg](screens/T12470/rr-113-overlay-after-delete-text-region-1440.jpg)
- [rr-17-focus-after-second-point-1440.jpg](screens/T12470/rr-17-focus-after-second-point-1440.jpg)
- [rr-18-focus-preview-1440.jpg](screens/T12470/rr-18-focus-preview-1440.jpg)
- [rr-45-overlay-add-text-1440.jpg](screens/T12470/rr-45-overlay-add-text-1440.jpg)
- [rr-56-share-modal-1440.jpg](screens/T12470/rr-56-share-modal-1440.jpg)
- [rr-95-annotate-cards-with-plays-1440.jpg](screens/T12470/rr-95-annotate-cards-with-plays-1440.jpg)
- [rr-96-annotate-cards-enabled-1440.jpg](screens/T12470/rr-96-annotate-cards-enabled-1440.jpg)
