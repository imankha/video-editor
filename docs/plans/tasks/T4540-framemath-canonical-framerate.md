# T4540: Crop timing right at any frame rate

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

The crop path a parent sets in Frame is stored by frame number. When a clip's frame rate is missing from its record, the editor assumes 30 frames a second while the final render reads the real rate from the file. On a 60 frames a second clip the crop motion then runs at double speed and finishes halfway through, and stepping frame by frame skips every other frame. Use the clip's real rate everywhere and stop with a clear error when it is missing. Worked when a 60 frames a second test clip renders with the crop where the editor showed it; count first how many production clips lack a rate.

## Implementer details

- Editor side: fps comes from the clip row with a silent fallback to 30 in `src/frontend/src/hooks/useProjectLoader.js`; `src/frontend/src/utils/videoMetadata.js` hard-codes `framerate: 30`; `getFramerate()` in `src/frontend/src/utils/videoUtils.js` always returns 30 and drives frame stepping in `src/frontend/src/hooks/useVideo.js`. About 14 fallbacks to 30 remain in non-test code (FocusContainer, FocusScreen, projectDataStore, useClipManager, videoStore, `useSegments` `useState(30)`).
- Render side: `src/backend/app/routers/export/framing.py` uses ffprobe's real fps and computes `kf['frame'] / framerate`; when its probe fails it falls back to 30 with only a warning.
- Not a bug, leave alone: Spotlight's fixed 30 grid (`useHighlightRegions.js`) matches the server's fixed 30 in `routers/export/overlay.py`, and `UI_STEP_FPS = 30` in `utils/timeFormat.js` is a deliberate UI grid.
- Scope: one clip-fps accessor that returns null and fails loudly when fps is missing; editor and server agree on `working_clips.fps`; delete `getFramerate`; step by the clip's fps. No shared frame-math module.
- Before coding, count production clip rows with no fps (read-only) and record it in the PR; if rows lack it, a migration fills it from the file.
- After T11250 (deletes the multi-clip twin of the server fps code) and T11270 (renames the clip accessor).
- Knowledge doc: `.claude/knowledge/keyframes-framing.md`.

## Acceptance Criteria

- [ ] A 60 fps clip with a moving crop renders with the crop at the same positions and times the editor preview showed.
- [ ] A clip with no stored frame rate shows a clear error in Frame and cannot be rendered with a guessed rate.
- [ ] Frame stepping on a 60 fps clip moves one frame per press.
