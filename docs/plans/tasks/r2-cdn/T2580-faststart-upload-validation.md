# T2580: Know which uploads cannot start at once

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-06-02
**Updated:** 2026-11-13

## In plain words

A video whose index sits at the end of the file cannot start playing until all of it has downloaded. The app moves the index to the front while uploading, but it skips some kinds of file without saying so, and the server never checks or records the result. Check each upload when it finishes, record the answer and show the count on the admin upload panel. Repair files on the server only if that count turns out to matter. Worked when the panel shows, for new uploads, how many cannot start at once.

## Implementer details

- The browser already relocates the index: `src/frontend/src/services/uploadManager.js` runs `analyzeMp4Faststart` and uploads reordered slices. `src/frontend/src/utils/mp4Faststart.js` skips relocation for the overflow fallback and for fragmented or index-less files; those land in storage as they were.
- The server never verifies: `src/backend/app/routers/games_upload.py` has no faststart, moov or probe reference, and no `is_faststart` column exists. The index-at-end workarounds are still live in `clips.py` and `games.py` stream handlers.
- Scope: at finalize, one small ranged read of the box headers; log and store the verdict (schema change, so include the Migration agent); show the count in the admin upload panel.
- A server-side repair through the GPU service is a separate task, filed only if the count is not trivial.

## Acceptance Criteria

- [ ] Every newly finalized upload has a stored yes or no for 'index at the front'.
- [ ] The admin upload panel shows how many recent uploads are 'no'.
- [ ] The check adds no noticeable time to finishing an upload (one ranged read, no full download).
