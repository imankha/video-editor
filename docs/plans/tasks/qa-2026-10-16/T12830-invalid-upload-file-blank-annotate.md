# T12830: A non-video file in Upload game opens a blank screen with no way out

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Tier:** M (frontend, ~2 files, 30-50 LOC + test)
**Created:** 2026-10-16
**Milestone:** Next build (external QA 2026-10-16). Present on prod, so it does not block the deploy.

## Problem

External QA B02 ([report](../../ux/2026-10-16-external-qa/QA-REPORT.md), screenshots
`screenshots/B02_upload_1440x900_nonvideo.png`, `B02_upload_1440x900_tiny-mp4-blank.png`). Picking a
text file, or a `.mp4` with non-video bytes, in Upload game navigates to `/annotate` and shows only the
purple background: no header, no error, no button. Only browser Back recovers. A parent with a wrong
or corrupt file is stranded.

## Mechanism (verified in code)

- The picker (`GameFootagePicker.jsx:192`) only sets `accept`; no content check.
- `ProjectManager.handleCreateGame` (`:1302`) -> `ProjectsScreen.handleAnnotateWithFile`
  (`ProjectsScreen.jsx:338-341`) navigates to Annotate before anything probes the file.
- `AnnotateScreen.jsx:596-608` sets `isLoadingRef.current = true` and calls `handleGameVideoSelect`
  un-awaited with no `.catch`.
- `AnnotateContainer.jsx:877` `await extractVideoMetadata(file)` rejects (`utils/videoMetadata.js:467+`);
  `:997-999` logs and rethrows into an unhandled rejection.
- `annotateVideoUrl` stays null, so `AnnotateScreen.jsx:719-721` returns `null`, and the redirect back
  (`~:711-715`) is blocked because `isLoadingRef` is never reset.

Same code at `deploy/frontend/2026-10-05` (`AnnotateContainer.jsx:866/880`, `AnnotateScreen.jsx:572/686`).

## Solution

1. Probe before navigating: in `handleCreateGame` (or the picker) run `extractVideoMetadata` on each
   file; on failure keep the dialog open with an inline error ("This file isn't a video we can open.
   Use an MP4, MOV or WebM.").
2. In the Annotate mount effect, catch a failed `handleGameVideoSelect`, reset `isLoadingRef`, show a
   toast and return to Games, so a file that slips past step 1 never strands the parent. Stop the
   silent rethrow at `AnnotateContainer.jsx:997`.

## Acceptance Criteria

- [ ] Red-first test: a file whose metadata probe rejects keeps the Upload dialog open with a readable error and never switches to Annotate (fails on master)
- [ ] Test: a probe failure inside Annotate lands the user on Games with a toast, not a blank screen
- [ ] Live: `tiny.txt` and the fake `tiny.mp4` from the QA folder both show the error; a real MP4 still uploads
