# T12570: Re-run polish bundle: residual B2/B3/B8, locked gauges, Games alignment, tap targets, small items

**Status:** TODO
**Impact:** 3
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) B2, B3a, B3b, B8, N23, N24, N26, N27, N29, N30, N32, N34 (severity LOW). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

Small items the re-run left or found: B2/B3a/B3b only partly fixed (see RESULTS.md 2.1); B8 is now an aborted blob: preview request (ERR_ABORTED); locked Finished gauges still share the page with one highlight and use a glyph that looks like a missing character; Games card alignment under a centered header; touch targets under 44 px (Edit game, More actions, coach close X, Annotate clip-count chip, speed 1x, upload modal X, Report a problem link); the upload modal X has no accessible name and Escape does not close it; "Drop any game video here." on a phone; blank Finished carousel thumbnails for the newest highlights (recheck on a clean session); hover label "click to highlight" cut off; empty circle icons on Share and Cancel in the share modal; Share plays enabled with zero plays while Review plays is locked; unverified: whether the sport chosen in the upload modal carries over (the play editor still asked for a sport).

Screenshots: RESULTS.md 2.1, rr-117-m390-finished-tab, rr-55, rr-56, rr-42, rr-44, rr-07.

## Solution

Verify N34 and N27 first (one minute each); fix the rest as one reviewable bundle, or split by area if it passes about 200 lines of diff.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/GameDetailsModal.jsx`
- `src/frontend/src/components/GameTile.jsx`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12570:`

## Acceptance Criteria

- [ ] Each item is fixed, or recorded here as not reproducible with a screenshot
- [ ] Touch targets are at least 44 px at 320-768

## Evidence screenshots

Kept in `screens/T12570/` (delete that folder when this task is archived):

- [rr-07-play-editor-tags-notes-1440.jpg](screens/T12570/rr-07-play-editor-tags-notes-1440.jpg)
- [rr-117-m390-finished-tab.jpg](screens/T12570/rr-117-m390-finished-tab.jpg)
- [rr-42-overlay-moment3-1440.jpg](screens/T12570/rr-42-overlay-moment3-1440.jpg)
- [rr-44-overlay-moment4-1440.jpg](screens/T12570/rr-44-overlay-moment4-1440.jpg)
- [rr-55-finished-tab-1440.jpg](screens/T12570/rr-55-finished-tab-1440.jpg)
- [rr-56-share-modal-1440.jpg](screens/T12570/rr-56-share-modal-1440.jpg)

## Progress (2026-10-13)

Done in this commit: N24 upload modal X named "Close" + Escape closes it; N23 for Edit game, More actions, and the modal X (44 px).
N34 checked in code: `GameDetailsModal.submitGame` saves the picked sport via `updateProfile` on the Upload gesture (covered by `GameDetailsModal.sportPicker.test.jsx`); not reproduced live.
Still open (outside the two owned files, needs live reproduction): B2/B3/B8 residuals, N23 remainder (coach X, clip-count chip, speed 1x, Report link), N26, N27, N29, N30, N32, Games alignment, phone dropzone copy.
