# T11870: One upload progress number and one sentence

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M (frontend only, ~5 files + tests, ~120 LOC)
**Created:** 2026-10-04
**Decision gate:** none (recommendation only); "Saved" -> "Uploaded" follows S5. **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 1 of 3 in [Epic E](EPIC.md). Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [desktop/03](../../../ux/2026-10-04-parent-usability-audit/desktop/03-upload-processing-conflicting-status.png)
(the progress panel was captured mid-upload per the desktop report). The panel showed "Computing
hash... 20%" next to "3%", plus "Local preview - not saved online yet" and "Connecting to server".
A parent cannot tell how far along the 165 MB upload is, or whether it is safe to leave.

## Solution

One bar, one overall percent (the existing 15/83/2 weighting), one sentence with no percent in it.

| Phase (`UPLOAD_PHASE`) | Sentence | Sub-line (`text-xs text-gray-400`) |
|---|---|---|
| HASHING / PREPARING | Getting your game ready to upload | Keep this tab open until it finishes. |
| UPLOADING | Uploading your game | Keep this tab open until it finishes. You can start marking plays. |
| FINALIZING | Finishing up | Keep this tab open until it finishes. |
| COMPLETE | Your game is uploaded. | (none; bar removed after 3s) |
| ERROR | Upload stopped. + **Retry upload** button | the server's reason, if any |

- Layout: a bar row `h-1.5 bg-gray-700` with a `bg-green-500` fill; sentence left, `20%` right-aligned
  in the label. Full width at 390; the sub-line wraps.
- Fold the local-preview notice into the sub-line during upload instead of a separate chip.
- While the player is showing the local blob preview, do not show the "Connecting to server..."
  buffer overlay: it describes a remote stream that is not playing. **Verify the mechanism first**
  (what triggers the overlay on a blob URL) and include a red test for it.
- `UPLOAD_STATE.SAVED = 'Saved'` -> **Uploaded**.

## Relevant Files (under `src/frontend/src/`)

- `services/uploadManager.js:638, 672-684, 753, 876-893, 921, 965, 1259` (phase messages; the multi-video
  path prefixes `${label}: `)
- `stores/uploadStore.js:51-56` (`progressToPercent`)
- `components/UploadProgressIndicator.jsx:69-70`, `components/UploadingGameTile.jsx:207-209`
- `utils/uploadPresentation.js:25-52` (phase -> presentation map from T9430)
- `components/UploadPreviewNotice.jsx:66-83`, `components/shared/VideoLoadingOverlay.jsx:43`
- `config/displayNames.js:373-385` (`UPLOAD_STATE`)

## Implementation Steps

1. In `uploadPresentation.js`, map each phase to the sentence and sub-line above (add the strings to
   `displayNames.js`).
2. Make `UploadProgressIndicator` and `UploadingGameTile` render `presentation.sentence` plus the
   single `progress%`. Stop rendering `upload.message` to users; keep `uploadManager` messages for
   logs, resume text and error details only.
3. Merge `UploadPreviewNotice` into the sub-line during upload.
4. Suppress `VideoLoadingOverlay` while the source is the local blob (after reproducing it).
5. Rename SAVED to Uploaded.

## Acceptance Criteria

1. At any moment of an upload exactly one percentage is visible on the screen.
2. Each phase shows its sentence; the sub-line says to keep the tab open until complete.
3. "Connecting to server..." does not show over a playing local preview.
4. Error state shows "Upload stopped." and a working Retry.

## Tests (red first)

- `uploadStore.test.js` (weights unchanged), `UploadProgressIndicator.test.jsx` (only one `%` in the
  rendered text), `UploadPreviewNotice.test.jsx`, `uploadPresentation.test.js`.
- New test for the overlay suppression on a blob source.

## Landmines

- T7280: `AnnotateScreen` must not subscribe to progress ticks; only leaf components do.
- T7480: progress counts completed parts only (honest progress). Do not change the math.
- The message string is also used for resume text (`uploadManager.js:876-880`) and failed rows
  (`entry.message`); keep those paths working.
