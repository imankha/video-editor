# T4100: Upload Pipeline Polish (deferred from bug 26p)

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-06-28
**Updated:** 2026-06-28

## Problem

While investigating **bug 26p** ("added a game but it never showed up" — the Add Game
upload failed silently), a full pipeline audit surfaced several minor robustness/UX gaps.
The high-severity ones (silent failure feedback, hash/part timeouts, orphaned `pending`
game cleanup, and the `activate()` storage-ref consistency gap) are being handled in the
bug-26p broad robustness pass (branch `feature/bug26p-upload-failure-robustness`). This
task collects the **leftover lower-severity items** that were intentionally left out of
that fix so they don't get lost.

## Solution

Three small, independent improvements in the upload pipeline:

1. **Resume-state save is silently swallowed.** `saveCompletedParts()` in
   `uploadManager.js` (~lines 181-191) uses `.catch(() => {})`, so if the backend can't
   persist multipart progress, resume silently won't work while the upload appears fine.
   At minimum surface it (telemetry/console with a clear marker) and decide whether resume
   should be advertised at all if the save failed.

2. **Finalize error messages are vague.** `finalize-upload` error handling
   (`uploadManager.js` ~507-509) collapses R2 multipart-completion failures into a generic
   `Finalize failed: {status}` when `.detail` is absent. Give the user a clearer,
   actionable message (and log enough to diagnose).

3. **Dedup "simulated progress" is misleading.** When a video already exists in R2 (dedup
   path, `uploadManager.js` ~440-448), progress is faked with hardcoded sleeps (30/70/100%
   with 400ms waits). For an instant dedup this reads as a confusing "upload." Replace with
   honest messaging (e.g. "Already uploaded — finishing up").

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/services/uploadManager.js` — saveCompletedParts (~181-191),
  finalize error handling (~507-509), dedup simulated progress (~440-448)
- `src/frontend/src/components/UploadProgressIndicator.jsx` — progress/error display

### Related Tasks
- Follows: bug 26p (broad robustness pass — silent-failure toast, timeouts, pending
  cleanup, activate() storage-ref consistency). Do NOT re-touch those; this is the remainder.
- Related: T1540 (gesture persistence during upload), T2700 (export retry UX deception).

### Technical Notes
All three are frontend-only, no schema/backend changes expected. None is data-loss-critical,
hence low priority. Keep changes surgical; reuse the existing `toast`/progress machinery.

## Implementation

### Steps
1. [ ] Surface `saveCompletedParts` failures instead of swallowing them
2. [ ] Improve finalize-upload error messaging + diagnostics
3. [ ] Replace dedup simulated-progress with honest "already uploaded" messaging

## Acceptance Criteria

- [ ] A failed resume-state save is visible (not swallowed)
- [ ] Finalize failures show an actionable message
- [ ] Dedup path no longer fakes a multi-second "upload"
- [ ] Frontend tests pass
