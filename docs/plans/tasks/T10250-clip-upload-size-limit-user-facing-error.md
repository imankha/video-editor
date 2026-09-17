# T10250: Clip upload over 500MB fails silently: pre-flight check + user-facing error

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17 staging: "I tried uploading a clip directly and it failed without a dialog."
Console: `Failed to land clip source in R2: ... Error: Clip uploads are limited to 500MB. For
longer footage, use Add Game instead.`

Trace: the backend refuses in `prepare-upload` (`games_upload.py:237-245`,
`MAX_CLIP_UPLOAD_BYTES`, `constants.py:281`) with a good message. The message survives as
`err.message` in `useClipUpload.js:53-57` but is then only `console.error`'d and pushed into
`perFileErrors`; `ProjectManager.runClipUpload` (`:1007-1037`) classifies any result with a
matching filename as RETRYABLE and drops it into the "Upload didn't finish" rail with a Retry
button that can only fail the same way. The hook's `error` state is never destructured
(`ProjectManager.jsx:628`), so it is dead. There is **no pre-flight size check**: the file is fully
hashed locally (`ensureVideoInR2` -> `hashAndAnalyze`) before the server sees `file_size`.

## Solution

1. **Pre-flight, before hashing**: mirror the cap on the client. Do not hand-copy the number:
   expose `max_clip_upload_bytes` (and `max_clip_duration_s`) on an existing config endpoint the
   uploader already fetches (`/api/bootstrap` or `/api/payments/config`-style), or a tiny
   `GET /api/games/upload-limits`. Files over the cap never enter the queue.
2. **Distinct, non-retryable UX**: an over-cap file shows a dialog (not a toast that vanishes)
   with the server's sentence and a single primary action **Add Game instead** that opens the
   game upload flow with the same file; Cancel dismisses. No Retry.
3. **Every non-retryable server refusal** (`refused` class: bad kind/hash/size, and the clip-batch
   `duration_exceeds_cap` / `probe_failed` / `source_missing`) gets a visible message with the
   server text, not the generic rail row. Retry stays only for network/R2 classes.
4. Wire or delete `useClipUpload.error` (a dead state is a lie about coverage).
5. Send the refusal through the upload-failure record (T10270) with `original_filename` and
   `file_size` so support can see it.

## Context

### Relevant Files
- `src/frontend/src/hooks/useClipUpload.js`
- `src/frontend/src/components/ProjectManager.jsx:993-1068,1270-1277,1534-1583`
- `src/frontend/src/services/uploadManager.js:45-63,623-663,701-722`
- `src/backend/app/routers/games_upload.py:189-247`, `src/backend/app/constants.py:281-282`
- `src/frontend/src/config/displayNames.js` (`CLIP_UPLOAD` block) for the copy

### Related Tasks
- Blocks nothing; pairs with T10260 (completion UX) and T10270 (observability)

## Acceptance Criteria

- [ ] Picking a 600MB file shows the limit dialog within a second, no hashing, no network call
- [ ] The dialog offers "Add Game instead" and carries the file across
- [ ] Non-retryable refusals never show a Retry button; the server message is visible verbatim
- [ ] The limit number exists once (backend) and the client reads it, no literal `500`
- [ ] Unit test for the pre-flight path; e2e for the dialog
