# T8860: Shrink upload integration + fallback

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

A confirmed `shrinkPlan` must actually run at upload time: each segment shrinks in the
worker, the shrunk file uploads through the normal path, processing overlaps uploading
(segment 2 encodes while segment 1 uploads), progress reads honestly, and ANY failure
falls back to uploading originals - never a dead end, never a double credit charge.

## Solution

Extend the upload queue so a game entry with a `shrinkPlan` runs a per-segment
shrink -> upload pipeline using T8840's `shrinkClient`. See [EPIC.md](EPIC.md) decision 6.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/uploadStore.js` - queue entry carries `shrinkPlan`; new
  per-entry phase state (`shrinking` | `uploading`)
- `src/frontend/src/services/uploadManager.js` - `uploadMultiVideoGame` (~L996) gains the
  shrink stage per file; single-file path too (the plan applies regardless of count)
- `src/frontend/src/services/shrink/shrinkClient.js` - consumed, not modified
- `src/frontend/src/components/UploadProgress` surface (whatever component renders the
  existing per-file progress - locate via the "Video {i} of {n}" label from T8810)

### Related Tasks
- Depends on: T8840 (worker + client), T8850 (`shrinkPlan` in the payload), T8810
  (uniform N-file upload path)
- Blocks: nothing (shrink feature complete after this)

### Technical Notes
- Pipeline shape: for segments in sequence order, run shrink(segment i) and
  upload(shrunk i-1) CONCURRENTLY; never more than one shrink and one upload in flight
  (memory + bandwidth bounded). Plain async loop with two awaited slots - do not build a
  generic scheduler.
- CREDITS are charged from ACTUAL uploaded bytes, exactly as today - the existing flow
  computes cost from the file it uploads, so passing the shrunk File through the normal
  `prepare-upload`/`finalize-upload` path (games_upload.py) needs NO backend change.
  Verify this claim while implementing; if any code path pre-charged from the ORIGINAL
  size, fix it to charge from the file actually sent.
- The game's `video_filename`/metadata must reflect the shrunk file (hash, size, probed
  dimensions all come from the uploaded file via the existing probe - no special casing).
- Progress: phase label "Shrinking video {i} of {n}..." with the worker's progress, then
  the normal upload progress. Overall entry progress = 50/50 split between phases per
  segment (simple, honest enough).
- FALLBACK (binding): if shrink of ANY segment errors -> toast "Shrinking didn't work on
  this computer. Uploading your original videos instead." -> cancel remaining shrinks,
  upload ALL segments as originals (including re-uploading nothing already uploaded twice:
  segments already uploaded SHRUNK stay shrunk; only unprocessed ones go original). Log
  the error with stage detail (console + existing frontend logging path) - loudly, per
  the no-silent-fallback rule this IS the external-dependency case where a fallback is
  allowed, but it must warn.
- Page close during shrink: the browser will prompt via the existing beforeunload guard
  if one exists for uploads; if none exists, add nothing new (out of scope), but verify
  a reload leaves no corrupt game (the pending-game + activate flow already covers
  partial uploads).
- Blob lifecycle: revoke object URLs and let shrunk Files be GC'd after upload -
  a 4-segment game must not hold 4 shrunk files in memory at once (release after each
  finalize).

## Implementation

### Steps
1. [ ] Thread `shrinkPlan` from the modal payload into the `uploadStore` entry and down
   to `uploadManager`.
2. [ ] Implement the two-slot pipeline loop in `uploadMultiVideoGame` (and the
   single-file path) with the phase state.
3. [ ] Progress UI: phase-aware labels + combined percent.
4. [ ] Implement the fallback path + toast + loud logging; unit-test its branching with
   a mocked shrinkClient (fail on segment 2 of 4 -> segments 1 stays shrunk, 2-4 go
   original, one toast, order preserved).
5. [ ] Memory: release each shrunk File after its finalize; verify heap in a manual
   4-segment run does not stack files.
6. [ ] Manual end-to-end on the REAL DJI folder (dev backend, real R2): confirm the
   resulting game plays in Annotate, boundaries land right, credits charged match the
   shrunk bytes. Record numbers in the Progress Log.

### Progress Log

**2026-09-05**: Filed.

## Acceptance Criteria

- [ ] 4-segment shrink-upload completes with overlapped phases (observe: segment 2
      shrinking while 1 uploads)
- [ ] Mocked-failure test proves the exact fallback branching above
- [ ] Credits = f(actual uploaded bytes); no path charges original size
- [ ] Game created from shrunk files is indistinguishable to Annotate/backend from a
      normal upload
- [ ] Curated test set green + manual e2e recorded
