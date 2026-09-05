# T8810: Universal dropzone replaces Per Game / Per Half

**Status:** WIP
**Impact:** 8
**Complexity:** 5
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

`GameDetailsModal.jsx` hard-codes a "Per Game" / "Per Half" toggle with exactly-two
dropzones for halves. Users with camera folders (4+ segments) or single files both need
ONE intake: drop anything, we figure it out. The backend and transport already handle N
videos per game (T8700 / `game_videos.sequence`); only this modal is stuck at 2.

## Solution

Replace the modal's video-pick block with a new `GameFootagePicker` component driven by
T8800's `useFootageIntake`. Delete the `VideoMode` toggle machinery. Submit payload becomes
a uniform ordered list. Mockup + approved microcopy: artifact section 03 screens A/B/C0
(link in [EPIC.md](EPIC.md)).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameFootagePicker.jsx` - NEW: dropzone + checking + selected states
- `src/frontend/src/components/GameDetailsModal.jsx` - swap in picker; delete halves machinery
  (state `halfFiles`, `videoMode` ~L34-35, the mode selector ~L555, per-half dropzones ~L355,
  submit gate ~L175, cost calc ~L183, payload ~L216-220)
- `src/frontend/src/constants/gameConstants.js` - `VideoMode` removal or deprecation note
- `src/frontend/src/containers/AnnotateContainer.jsx` - `handleGameVideoSelect` (~L450-560):
  `isMultiVideo` becomes `files.length > 1`, metadata comes from the picker's probe results
- `src/frontend/src/stores/uploadStore.js` - entry routing (~L185-198) keys on file count
- `src/frontend/src/services/uploadManager.js` - `uploadMultiVideoGame` (~L996): progress
  label per file becomes "Video {i} of {n}" instead of 'First Half'/'Second Half' (~L1020)

### Related Tasks
- Depends on: T8800 (`useFootageIntake` - this task renders its `empty`/`checking` states
  and the single-file `ready` state; the multi-file strip is T8820)
- Blocks: T8820, T8910
- T8700 built `POST /api/games/{id}/videos` and `AttachVideoModal`; leave both alone.

### Technical Notes
- Folder support = a second hidden `<input type="file" webkitdirectory>` behind the
  "or add a whole folder" link, shown desktop-only (reuse the existing `fine-pointer:`
  Tailwind variant). The main hidden input gets `multiple`.
- Folder DRAG-drop: in the drop handler, when `DataTransferItem.webkitGetAsEntry()` returns
  a directory entry, walk it (directory reader, recursive, collect File objects) before
  passing to `addFiles`. Files from this path often have empty MIME - T8800's extension
  fallback covers it, but do not re-filter by MIME here (that is the existing bug in the
  current `getVideoFile` ~L115, which this task deletes along with the halves flow).
- The T7890 `recordFileSelected` beacon must still fire ONCE on the first accepted
  selection, from every path (click, multi, folder pick, folder drag). Preserve the
  session-dedupe behavior exactly.
- Approved copy (artifact screen A): heading "Drop your whole game here", sub "One video
  or all of them - we'll put them in order", mobile sub "Tap to choose videos - pick as
  many as you want", drag-over "Drop everything here", link "or add a whole folder",
  formats line unchanged. Checking state: "Checking your videos..." with pulsing skeleton
  chips (one per accepted file).
- Keep the dropzone's existing color grammar: gray rest / blue drag-over / green selected.

## Implementation

### Steps
1. [ ] Build `GameFootagePicker` with three states wired to `useFootageIntake.status`:
   `empty` (dropzone, both hidden inputs, folder link), `checking` (skeleton chips),
   `ready` with `items.length === 1` (today's green filename+size chip, byte-for-byte the
   current look). For `ready` with 2+ items render a plain placeholder list this task
   (T8820 replaces it with the confirm strip). Emit
   `onFootageChange({ files: [{file, sequence}], totalBytes, proxies })` upward -
   sequence = 1-based index into `order`.
2. [ ] Error state: selection that yields zero accepted videos shows
   "We didn't find any game videos in there. Look for MP4 or MOV files from your camera."
   (red text under the dropzone, brief red border flash, state stays `empty`).
3. [ ] In `GameDetailsModal`, mount the picker in place of the whole current video block;
   delete the halves machinery and the "Video Format" block in More options; submit gate
   becomes `files.length >= 1`; cost = `calculateUploadCost(totalBytes)`.
4. [ ] Normalize the submit payload: ALWAYS `files: [{file, sequence}]` (a single file is
   a 1-element list). Update `handleCreateGame` -> `AnnotateContainer.handleGameVideoSelect`
   -> `uploadStore` -> `uploadManager` so single- and multi-file games flow through the
   SAME path with `sequence` from the list (the `videoMode` branch goes away everywhere;
   grep for `PER_HALF`/`PER_GAME`/`videoMode` and remove every use).
5. [ ] Duplicate add (same `dedupeKey`) -> existing toast system: "Already added: {name}".
6. [ ] Tests: component tests for the three states + zero-accepted error + payload shape
   (single and 4-file); an e2e spec updating the existing upload flow spec to the new
   single dropzone (happy path: pick 1 file, Add Game enabled, payload sequence=1).
   Update any e2e selectors that referenced the halves toggle.

### Progress Log

**2026-09-05**: Filed.

## Acceptance Criteria

- [ ] Per Game / Per Half toggle is gone; `VideoMode` has no remaining imports
- [ ] Single small file: two gestures (pick, Add Game), UI identical to before
- [ ] Selecting the DJI folder via the folder link yields 4 accepted videos, 4 skipped
      proxies, in T8800 order (manual check against the real folder)
- [ ] Drag-dropping a FOLDER onto the dropzone works in Chrome (directory entry walk)
- [ ] `recordFileSelected` fires once per session on first accepted file, every path
- [ ] Upload progress reads "Video 1 of 4" style labels
- [ ] Curated test set green + updated e2e spec green
