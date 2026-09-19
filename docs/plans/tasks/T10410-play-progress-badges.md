# T10410: Play progress badges in the Edit play editor

**Status:** WIP
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

The Edit play strip carried a loose green "Clip created" text next to Update play, and
nothing on the surface encouraged the parent to rate the play, name it, or add a note.
The user (2026-09-18) asked for badge iconography that (a) nudges those three, (b) at
5 stars nudges creating a clip, and (c) absorbs the "Clip created" status into the same
system so the text is part of a design rather than a stray label.

## Solution

Decision artifact: https://claude.ai/artifact/Wg6vpgvnbS2JaqFER8kQTE (three placements,
three states each). User rulings 2026-09-18:

- **Option C**: badges live on the header line right after the play name (desktop strip);
  on the formBody layouts (desktop sidebar overlay, mobile sheet) they sit above the footer
  buttons. Landscape-inline (height-starved) gets none.
- **Rated = rating differs from the default 4** (decision 1b). A deliberate 4 reads as
  un-rated; accepted.
- **"Note"**, not "description", everywhere.
- Clip badge is **faded (dormant) below 5 stars**, amber pulsing "Create clip" at 5 stars
  with no clip, spinner while creating, green check "Clip created" once the project exists.
- Every badge is a **pure read** of editor state; nothing new is persisted.
- Clicking an undone badge jumps to the control that completes it (rating/note open the
  Rate and Tag disclosure, name opens the inline rename / focuses the name input).
- Clip nudge click: **edit mode** sends the same partial `{ createProject: true }` update
  the main screen's Frame clip button sends, so the editor stays open and the badge flips
  in place; **create mode** is the explicit save-and-create outcome (`handleSave(true)`).

"Named" needed one backend datum: the raw-clip API always returns a DERIVED `name`
(`queries.derive_clip_name`, not reproducible client-side because of TF-IDF titles and a
different truncation), so `RawClipResponse` gained `has_custom_name` (bool of the stored
name). The region carries it as `hasCustomName`, kept coherent at the one local write site
(`updateClipRegion`: Save sends `''` for derive, non-empty for custom). The one-tap
"Play N" default is stored as a real name, so it is excluded by pattern.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/playProgress.js` - NEW pure derivation (`getPlayProgress`)
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` - NEW badge row
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - wiring, removed "Clip created" span
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` - `hasCustomName` on regions
- `src/frontend/src/config/displayNames.js` - badge copy
- `src/backend/app/routers/clips.py` - `RawClipResponse.has_custom_name`

### Related Tasks
- T10310 moved Create clip / Save and Frame out of the editor (the badge reuses that seam)
- T9330 `focusPending` (create-in-flight) feeds the badge's pending state

### Technical Notes
- No schema change: `has_custom_name` is derived at response time from the stored `name`.
- Edit-mode nudge creates the project from the SAVED fields; unsaved edits stay in the form
  for Update play (same as Frame clip on the main screen).

## Implementation

### Steps
1. [x] Decision artifact with mockups; user picked Option C + rulings
2. [x] Pure derivation + unit tests
3. [x] Badge component + overlay wiring (strip header, formBody footer)
4. [x] Backend `has_custom_name` + region mapping
5. [ ] Tests green, Reviewer, merge

### Progress Log

**2026-09-18**: Built per rulings in container checkout C:\work\tasks\10410.

## Acceptance Criteria

- [ ] Strip header shows four badges after the name; the old "Clip created" text is gone
- [ ] Rated/named/note badges fill green with a check when done; clicking an undone one jumps to its control
- [ ] Clip badge: dormant below 5 stars, amber "Create clip" at 5 stars, pending spinner, green "Clip created"
- [ ] A backend-derived name and a "Play N" default never read as "named"
- [ ] Tests pass
