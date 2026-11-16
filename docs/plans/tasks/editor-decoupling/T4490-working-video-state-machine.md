# T4490: One owner for the Spotlight video

**Status:** WIP
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

Whether the video Spotlight plays is loading, ready or failed is tracked in four places and stitched together by a 100 line block with recovery branches; the stuck loading screens of the past came from here. Keep one status in one place with one load action, and delete the rest. Worked when Spotlight opens correctly from Frame, from Home and after a failed load, each in a test. Runs after T4480.

## Implementer details

- Truth today: `projectDataStore.workingVideo`; `overlayStore.isLoadingWorkingVideo`, which `FocusScreen.jsx` sets before navigating; `project.working_video_url`; three refs and two `useState` in `OverlayScreen.jsx`. The reconcile effect in `OverlayScreen.jsx` includes a 'set externally by FocusScreen but no URL' recovery branch.
- Target: one `{status, video, error}` slice and a `loadWorkingVideo(projectId)` action (dedup, bounded retry) in `projectDataStore`. Delete the refs, the effect and the overlayStore flag; keep `deriveOverlayVideoSource` as the selector. Frame stops writing Spotlight's store.
- Readers to move: `App.jsx`, `ModeSwitcher.jsx`, `UnifiedHeader.jsx`, `utils/editorContext.js`.
- Design gate: this is a state-shape change across two screens; get the design approved before implementation.
- Knowledge doc: `.claude/knowledge/keyframes-framing.md`.

## Ruling

Design in `docs/plans/tasks/T4490-design.md` approved (owner, 2026-11-15):
1. **Yes.** One working-video status slice plus one load action, as designed.
2. **Yes.** Delete the dead `renderedVideoBlob` branch in `FocusScreen`.
3. **Keep `useProjectLoader`'s early working-video load** (owner, 2026-11-15: do nothing that makes Spotlight slower). The owner only needs it to work on localhost, so the proxy-URL concern (fails off-localhost per T5642) is not this task's problem; the single load action may be called from the early load as well as from `OverlayScreen`, deduped so it fetches once. Opening Spotlight must not get slower than today.

## Acceptance Criteria

- [ ] The loading state of the Spotlight video is stored in exactly one place.
- [ ] Opening Spotlight from Frame after a render, from Home on an existing draft, and after a failed video load each reach the right screen in a test.
- [ ] `FocusScreen` writes nothing to the Spotlight store.
