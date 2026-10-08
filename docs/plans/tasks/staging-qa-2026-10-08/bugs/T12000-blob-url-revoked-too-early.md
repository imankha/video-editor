# T12000: Blob URL revoked while a video still reads it

**Status:** WAITING ON USER
**PR:** https://github.com/imankha/video-editor/pull/567 (needs review and merge)
**Impact:** 2
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 1: Bugs](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

Console error ERR_FILE_NOT_FOUND blob: right after the game upload. Most likely source (moderate confidence): extractVideoMetadata cleanup (utils/videoMetadata.js:476-481) revokes the URL and detaches the video without clearing src; a non-faststart MP4 keeps issuing range reads that fail. captureVideoFrame.js:88-98 already does the right teardown (removeAttribute('src'); load() before revoke). Second candidate: AnnotateContainer.jsx:1025 and :1146 revoke the old blob before the new src is committed. Settle it with the failed request's initiator in DevTools Network.

## Solution

Mirror captureVideoFrame's teardown in extractVideoMetadata. If the initiator is AnnotateContainer move those revokes to after the new src is committed.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/utils/videoMetadata.js`
- `src/frontend/src/containers/AnnotateContainer.jsx (if the initiator is there)`

### Related Tasks

- None

### Test first (red before green)

Playwright spec: choose the file in the upload modal, page.on('requestfailed') filtered to blob:, expect zero failures. Fails today.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12000:` and the co-author line

### Progress Log

**2026-10-08 (wave 2026-10-08-a)**: Branch CI green; teardown order unit-proven red->green; reviewer APPROVED; proof HUMAN_VERIFICATION_REQUIRED because the blob ERR_FILE_NOT_FOUND symptom did not reproduce live on base or fix. Needs a staging upload check (wcfc-carlsbad-trimmed.mp4, DevTools open), then review and merge. Evidence: C:/work/landing/evidence/t12000.

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Uploading wcfc-carlsbad-trimmed.mp4 produces no blob: requestfailed and no console error
- [ ] Relevant tests pass and lint is clean
