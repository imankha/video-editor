# T4440: Delete unused editor code

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

About 1,500 lines in the Frame and Spotlight editors are never run: an old Spotlight timeline, hooks nothing imports, stored values nothing writes, and a second calculation of which video Spotlight should play that disagrees with the real one. They still absorb fixes and mislead the agents. Delete them with proof of no caller for each. Nothing a parent sees changes. Runs after T11260 and T11270, which edit the same files.

## Implementer details

- Paths under `src/frontend/src/`. Old timeline stack: `modes/overlay/OverlayTimeline.jsx` (161), `modes/overlay/layers/HighlightLayer.jsx` (314), `components/Timeline.jsx` (244); referenced only by each other and the barrel `modes/overlay/index.js`. Trim the two tests that name them (`config/spotlightVocabulary.test.jsx`, `utils/timeFormat.characterization.test.js`).
- Container wrappers only re-exported from `containers/index.js`: `FocusTimeline` in `FocusContainer.jsx`, `OverlayVideoOverlays` and `OverlayTimeline` in `OverlayContainer.jsx`.
- `stores/focusStore.js`: `clipStates`, `setClipState`, `getClipState` (no writers; `utils/editorContext.js` reads null), `videoFile`, `setVideoFile`, and `markExported` (never called, so `hasChangedSinceExport` is constant false and its selector in `OverlayScreen.jsx` is unused).
- `editorStore.annotateHasSelectedClip` has no reader; delete it and its reactive writer in `AnnotateContainer.jsx`.
- `hooks/useCurrentVideoState.js` (118), `hooks/useTimeline.js` (106), the dead half of `modes/overlay/hooks/useOverlayState.js` (about 100 lines used only by its own test), `initializeFromClipMetadata` in `useHighlightRegions.js`.
- Unconsumed `FocusContainer` returns: `getFilteredKeyframesForExport` (a 36-line twin of the one in `FocusScreen.jsx`), `hasFramingEdits`, `currentCropState`, `syncSegmentsToStore` (keep this one if T4470 has not landed and plans to use it).
- `OverlayContainer`'s Frame-era half: `OverlayScreen.jsx` calls it with dummies (`keyframes: []`, `segments: null`, `segmentSpeeds: {}`, `trimRange: null`, `setEditorMode: () => {}`); the container then computes a constant-false `hasFramingEdits` and a second `effectiveOverlayVideoUrl` and `effectiveOverlayMetadata` that fall back to the source clip, the pairing the screen's `deriveOverlayVideoSource` deliberately refuses. Delete the container's copies and the ten props; the screen's values are the only ones.
- Grep `src/`, `e2e/` and `scripts/` for each symbol; barrel files hide importers from a plain grep, so check the barrels too. The `*diag` harness pages mount real components with hand-built props and must still build.
- Knowledge doc: `.claude/knowledge/keyframes-framing.md`; update it in the same PR.

## Acceptance Criteria

- [ ] Each listed file, export and store field is gone, with an empty caller search in the PR.
- [ ] `OverlayContainer` takes no Frame parameters and computes no video source of its own.
- [ ] The app builds, every `*diag` page builds, and the Frame and Spotlight screen tests pass unchanged apart from deleted cases.
