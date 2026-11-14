# T10990: Portrait and landscape switch in one step

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-21
**Updated:** 2026-11-13

## In plain words

In Frame, switching a highlight between portrait and landscape makes three server calls one after another, and the picture changes shape only after the third answers. A parent reported a long lag on production on 2026-09-21; it could not be reproduced because the logs were gone. Have the first call return everything the screen needs and change the shape at once, so the switch is one call. Worked when the switch sends one request and the shape changes immediately; then time it again on staging once the sign-in speed-ups (T16380, T16390) are in. Runs after T11270.

## Implementer details

- `src/frontend/src/screens/FocusScreen.jsx`: the handler awaits `changeAspectRatioAction`, then `refreshProject()`. Inside the action (`src/frontend/src/stores/projectDataStore.js`) the POST is awaited and then `fetchClips(projectId)`. The shape comes from `projectAspectRatio` through `useProject()`, so nothing changes until the third response.
- Have the POST return the updated project and its one clip, or apply the ratio locally and reconcile. With one clip per project the re-fit is a single row.
- If only the first switch of a session is still slow afterwards, the remainder is the server's pending-sync retry (`db_sync.py`, `.sync_pending`) and gets its own task with timings.
- T11270 collapses clip selection in both files; start after it.

## Acceptance Criteria

- [ ] Switching portrait and landscape sends exactly one request.
- [ ] The frame changes shape before that request answers, and reverts with a message if it fails.
- [ ] The crop shown after the switch equals the crop the server stored.
