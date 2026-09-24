# T11150: Play editor hierarchy (time, name + rating, details) and no "clip" wording in Annotate

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Highlight-First Annotate Flow](EPIC.md)

## Problem

Owner ruling 2026-09-24 (round 2): the play editor's visual hierarchy must be
1. **start/end time** (most prominent),
2. **Name** and **Rating**,
3. a **"Details"** disclosure holding **tags and notes**.

And "remove the word Clip entirely, that's no longer a part of the mental model." Today the
editor mixes the trim row, name, a Play category (My Athlete / Team) control, rating badges and a
Details disclosure (T8600/T9830: sport, tags, notes; desktop expands `DetailsFields` in place,
mobile opens `AddDetailsPopup`), and Annotate copy says "clip" in many places.

## Solution

1. Re-order the editor per the T11100 A pick, in all 5 layouts of `AnnotateFullscreenOverlay.jsx`
   (`strip`, `landscape-inline`, `portrait-strip`, `inline`, `overlay`). Trim / time controls
   first; Name + Rating on one tier; Details = tags + notes. Placement of Play category and sport
   per H16.
   The progress badges (named / rated / noted / clip) are removed; the rating control and a gold
   "Highlight made" chip carry the state. Edit-strip tint per H19, star color per H20.
2. Rating control is a normal control with **no "Required" label or to-do styling** (the modal in
   T11120 enforces it). Drop the chess notation (`!!` etc.) from the rated badge and picker
   (`PlayProgressBadges.jsx:233,304`; style-guide pill rule).
3. Remove every user-visible "clip" in Annotate (element ids like `clip-notes` and component
   names are internal and stay). Designer-found strings in this editor: `ANNOTATE.DELETE_CLIP`
   ("Delete clip", shown when the play has a project), the name input's aria-label and
   `RENAME_CLIP` title, the notes placeholder "Add a note about this clip..."
   (`DetailsFields.jsx:75`). Other known strings: `displayNames.js` `ANNOTATE.*` (`CLIP_NAME`,
   `DELETE_CLIP`, `RENAME_CLIP`, `CLIP_CREATED`, `PREPARING_CLIP`, "... is now in Clips" toast in
   `announceReelCreated`), `getRatingCaption` / `getEditRatingCaption` (`clipConstants.js:79-113`),
   `ClipListItem`, `ClipsSidePanel` headings, `ClipDetailsEditor`. Grep the rendered copy, not
   identifiers. The single allowed string is T11130's Highlight Later toast.

Scope beyond Annotate (Framing, Spotlight, Home, Published, share, email) is H17 and lives in
T11280.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`, `DetailsFields.jsx`,
  `AddDetailsPopup.jsx`, `PlayProgressBadges.jsx`
- `src/frontend/src/components/ClipsSidePanel.jsx`, `ClipDetailsEditor.jsx`, `ClipListItem.jsx` (paths per knowledge doc)
- `src/frontend/src/config/displayNames.js`, `components/shared/clipConstants.js`

### Tests
`AnnotateFullscreenOverlay.*` layout tests (`.stripLayout`, `.portraitStrip`, `.keys`),
`DetailsFields` / `AddDetailsPopup` tests, e2e `T9550-editor-stage-strings`,
`manifests/screenManifests.js`, `T9530-library-vocabulary.qa`.

### Related Tasks
- Depends on: T11100 (A pick, H16), T11110 (label + gold)
- Blocks: T11120, T11130 (same files, strict order)

## Acceptance Criteria

- [ ] Red-then-green: each layout renders time controls first, then name + rating, with tags and
      notes only inside Details
- [ ] No "Required" text and no user-visible "clip" in Annotate (grep of rendered strings + live)
- [ ] No persistence change: every field still writes on its own gesture (T10610 autosave model)
- [ ] Live-driven desktop, 393 px portrait, landscape phone
