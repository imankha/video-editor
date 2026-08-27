# T7820: Uploading game renders as a real game tile (thumbnail + color-coded progress)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-27
**Updated:** 2026-08-27

## Problem

An in-progress upload renders as a system banner (ActiveUploadCard: filename + bar) above
YOUR GAMES, visually unrelated to the game tiles it will become. The user wants the
upload to read as "a game arriving": a tile with a thumbnail and a progress bar,
color-coded the same as today's bars.

Design approved by the user 2026-08-27 (Option A):
https://claude.ai/code/artifact/415c4ce3-1178-4390-8935-494a61335127

## Solution (approved design)

Render each upload as a real game tile INSIDE the existing "Uploading" rail (not inside a
month group: the game date is unknown until entered, so a grid placement would visibly
jump groups later). Same 16:9 geometry/overlay typography as GameTile (T5681).

- **Thumbnail with zero backend:** the File is already in the browser; capture a frame
  locally at upload start (object URL -> seek ~1s -> canvas -> data URL). Memory-only,
  never persisted, gone on reload (upload state already is).
- **Progress bar = tile bottom edge** (thin, animated), colors matching today exactly:
  - green (`GAME.progressBar`): active upload, with % + ETA where date/clip-count sit
  - **yellow (yellow-600): the RESUME state** (existing PendingUploadCard behavior: a
    server-side multipart session whose page closed mid-upload; bar frozen at
    completed_parts/total_parts, tile click reopens the file picker). NOTE: the browser
    lost the File handle, so NO local frame exists; resume tiles use the branded
    sport-ball fallback (same as posterless games), never a fake thumbnail. After
    re-select, the frame is captured and the tile flips to green uploading.
  - rose/red: failed, converging with the EXISTING T7490 `upload_failed` tile skin
    (Retry/Discard bar), bar frozen at failure point
  - queued: dimmed frame, no bar fill, cancel available
  - processing after 100% transfer: indeterminate shimmer on the same bar
- **Interactions preserved:** X cancel (double-tap confirm), tile click keeps the
  annotate-during-upload jump (T1540).
- The bottom-right global UploadProgressIndicator stack (other screens) is untouched.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/uploadStore.js` - add memory-only `previewFrame` per upload
- `src/frontend/src/services/uploadManager.js` - capture the frame at enqueue
- `src/frontend/src/components/GameTile.jsx` - upload variant (or thin UploadingGameTile
  wrapper feeding the same view); T7490's upload_failed skin already lives here
- `src/frontend/src/components/ProjectManager.jsx` - "Uploading" section renders tiles in
  the games-grid layout instead of ActiveUploadCard / PendingUploadCard rows
  (PendingUploadCard ~1606 = the yellow resume card being replaced; ActiveUploadCard
  ~1703 = the green banner being replaced)
- `src/frontend/src/components/UploadProgressIndicator.jsx` - REFERENCE ONLY, unchanged
- `src/frontend/e2e/T7360-concurrent-uploads.qa.spec.js` - extend assertions to the tile
  shape (fully network-stubbed, can assert thumbnail + bar without a real upload)

### Related Tasks
- Builds on: T7490 (upload_failed tile skin), T7360 (upload queue store), T5681 (tile grid)
- Parked behind T7360 in PLAN.md for the same file-contention reason (both on master now)

### Technical Notes
- Upload states (uploadStore UPLOAD_STATUS): uploading/queued/error(+done); the RESUME
  state is a different source: server-side `pending_uploads` (session_id,
  completed_parts/total_parts, progress_percent) fetched by ProjectsScreen. The tile view
  must accept both shapes; do NOT merge the stores (existing separation stands).
- Frame capture: `URL.createObjectURL(file)` -> offscreen video -> seek ~1s (clamp to
  duration) -> canvas.drawImage -> `toDataURL('image/jpeg', 0.7)` -> revoke URL. Handle
  capture failure silently (fall back to the branded tile) - no loud error for a
  cosmetic frame.
- Rail keeps its "Uploading" header; tiles use the SAME grid geometry map the games grid
  uses (GAMES_TILE_GRID_BY_COLUMNS) so tile sizes match the groups below.
- Gesture persistence rules: the preview frame is runtime-only state; nothing about it is
  ever written to store-on-disk/backend.

## Implementation

### Steps
1. [ ] uploadStore: `previewFrame` field + capture util invoked from uploadManager enqueue
2. [ ] UploadingGameTile (active/queued/resume/failed states, bar colors per design)
3. [ ] ProjectManager: swap ActiveUploadCard + PendingUploadCard rows for the tile grid
4. [ ] Vitest for the capture util (mock video/canvas) + tile state rendering
5. [ ] Extend T7360 e2e to assert tile shape (thumbnail img, bar width, state chips)
6. [ ] Real-browser drive on dev (upload a small file, reload mid-upload for resume state)

## Acceptance Criteria

- [ ] Active upload shows as a 16:9 tile with a real frame from the local file + green
  bottom-edge bar + % where clip count sits
- [ ] Resume (pending session) shows the SAME tile shape, yellow bar frozen at saved
  progress, branded fallback art, click reopens the picker (existing behavior preserved)
- [ ] Failed converges with T7490's tile skin (rose, Retry/Discard), bar frozen red
- [ ] Queued shows dimmed tile, cancellable
- [ ] Global bottom-right upload stack unchanged on other screens
- [ ] T7360 e2e extended and green; no reactive persistence introduced
