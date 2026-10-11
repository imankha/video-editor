# T12480: Upload progress toast covers the Mark play card; "Local preview ... Preparing" wording

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N4 (severity HIGH). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

On a phone the upload progress toast sits over the first Annotate card (Mark play) for the whole upload. At 1440 it covers the feedback button. The banner "Local preview, not uploaded yet. Preparing" uses internal wording.

Screenshots: rr-64-m390-uploading-2s, rr-03.

## Solution

Put upload progress in the header or above the cards, never over a card. Plain text: "Uploading your game, 15%. Keep this tab open." No em dashes.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/UploadProgressIndicator.jsx`
- `src/frontend/src/components/UploadPreviewNotice.jsx`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12480:`

## Acceptance Criteria

- [ ] During an upload at 390 and 1440 the Mark play card and the feedback button are not covered
- [ ] The banner uses the plain wording above

## Evidence screenshots

Kept in `screens/T12480/` (delete that folder when this task is archived):

- [rr-03-upload-file-chosen-1440.jpg](screens/T12480/rr-03-upload-file-chosen-1440.jpg)
- [rr-64-m390-uploading-2s.jpg](screens/T12480/rr-64-m390-uploading-2s.jpg)
