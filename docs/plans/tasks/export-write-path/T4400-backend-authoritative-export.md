# T4400: Old tab cannot overwrite newer edits

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

Frame is the step where the parent crops around their athlete and pays to sharpen the result. Pressing the button that starts the render first sends the whole editing state the browser tab holds, and the server stores it without checking that it is current. A tab left open from yesterday therefore replaces edits made since in another tab or on a phone. Every edit is already saved at the moment it is made, so we will stop sending that copy and render from what the server has. Worked when a test with a stale second tab renders the newer edits. Runs after the multi-clip removal (T11250, T11260, T11270).

## Implementer details

- The render itself is already server-side: `POST /api/export/render` takes ids and options and reads `crop_data` and `segments_data` from the database (`src/backend/app/routers/export/framing.py`).
- The clobber: `src/frontend/src/containers/ExportButtonContainer.jsx` awaits `saveCurrentClipState()`, which sends full hook state (built in `src/frontend/src/containers/FocusContainer.jsx`) to `PUT /projects/{id}/clips/{clip_id}` (`src/backend/app/routers/clips.py`). That handler has no version check.
- First inventory any hook state that no gesture persists; that is the only thing the save-before-render call could still be carrying. Give each such field a gesture write, then drop the call and remove the framing fields from the full-state PUT.
- The multi-clip half of the old scope disappears with T11250. T11270 renames the selected-clip plumbing in the same two containers, so start after both.
- Knowledge docs: `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/persistence-sync.md`.

## Acceptance Criteria

- [ ] A test with two tabs: tab A is loaded, tab B changes the crop, tab A starts the render; the rendered job uses tab B's crop and the stored clip still holds it.
- [ ] No request sent when the render button is pressed carries crop or segment data.
- [ ] Every Frame edit a parent can make is still saved when it is made (one test per gesture that was found unsaved).
