# T12520: Every unnamed upload becomes "Game uploaded <date>"; title flips from the file name

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N15 (severity MED). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

Uploads without a name all become "Game uploaded Oct 11". The Annotate title also flips from the file name ("wcfc-carlsbad-trimmed") to that default right after upload, and an account can hold two games with the same name in Games, Continue and the breadcrumbs.

Screenshots: rr-03, rr-04.

## Solution

Default the name to the file name (fall back to the dated title only when none), keep the title stable across the upload, and keep duplicates distinguishable.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/GameDetailsModal.jsx`
- `src/backend/app/routers/games.py`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12520:`

## Acceptance Criteria

- [ ] A game uploaded without a name is titled from its file name and keeps that title
- [ ] Two unnamed uploads are distinguishable
- [ ] Backend and frontend tests written first

## Evidence screenshots

Kept in `screens/T12520/` (delete that folder when this task is archived):

- [rr-03-upload-file-chosen-1440.jpg](screens/T12520/rr-03-upload-file-chosen-1440.jpg)
- [rr-04-annotate-uploading-1440.jpg](screens/T12520/rr-04-annotate-uploading-1440.jpg)
