# T16480: Failed load never replaces saved spotlights

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

Spotlight is the step that draws the following circle on a highlight. When its saved data fails to load, for example on a network blip, the editor quietly shows one fresh default circle and lets the parent edit as if nothing had been saved. The parent sees their work gone and may edit on top of it. Show an error with a Retry button instead, and keep editing off until the saved data is in. Worked when a blocked load shows Retry and the saved circles return after pressing it.

## Implementer details

- Both loaders in `src/frontend/src/screens/OverlayScreen.jsx` end in a `catch` that calls `addHighlightRegion(0)`, sets the loaded project id and sets the sync state to `ready` (the fresh-export loader and the plain-open loader; search for `Failed to load overlay data`).
- In that branch the action client's version was never seeded, so check what the first edit after a failed load sends and whether the server accepts it.
- Write the failing test first: mount the screen with the overlay-data request failing and assert no default region and no enabled editing.
- T4480 merges the two loaders afterwards; fix both copies here.
- Knowledge doc: `.claude/knowledge/keyframes-framing.md`.

## Acceptance Criteria

- [ ] With the Spotlight data request failing, the editor shows an error with a Retry button and no default circle.
- [ ] After Retry succeeds, the saved circles appear and editing works.
- [ ] No edit can be sent to the server while the load has failed.
