# T10290: Annotate editor: "Save and Frame", "Details" open on desktop, Save closes edit mode

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17 staging, three asks on the play editor (`AnnotateFullscreenOverlay.jsx`):

1. "When I'm editing or adding a clip, change 'Create an editable clip' to 'Save and Frame'. This
   button should still save, but then take you straight to Framing with this clip loaded. It
   should come after the Save Play button."
2. "Rename 'Add details' to 'Details'. Keep it open by default on desktop and close on mobile."
3. "Clicking save should close down the edit mode."

Current behavior (trace 2026-09-17):
- `CREATE_EDITABLE_CLIP` ("Create an editable clip", cyan) renders FIRST, then `SAVE_PLAY`
  ("Save play", green), identically in all three layouts (`overlay`/`inline` footer `:775-790`,
  `strip` `:1080-1093`, `landscape-inline` `:1203-1216`). Both exist only in CREATE mode; edit
  mode shows a single "Update play". Neither navigates: `handleSave(true)` creates the auto
  project and returns `true`/`false`, the project id arrives later via `setAutoProjectId`
  (`AnnotateContainer.jsx:1350`); only the toast's "Open Framing" action navigates.
- `detailsOpen` is `useState(false)` unconditionally (`:239`); label "Add details" until content
  exists, then "Details (2 tags, note)" (`:571-577`); mobile renders `AddDetailsPopup`
  (`aria-label="Add details"`).
- Save closes the editor in every case EXCEPT create in the `strip` (desktop under-canvas)
  layout, which calls `onResumePlaybackOnly()` and rehydrates the editor onto the new clip in EDIT
  mode (`:504-511`). That is the "does not close" the user hit on desktop.

## Solution

1. **Save and Frame** (create AND edit mode): label `ANNOTATE.SAVE_AND_FRAME` = "Save and Frame"
   (via `MODE_NAMES.FRAMING`: "Save and Frame"). Order in every layout: **Save play** (primary),
   then **Save and Frame**, then Cancel. Handler = the existing save-then-navigate template
   already used by the focus-confirm dialog (`:877-904`): `const saved = await handleSave(true);
   if (!saved) return; onOpenInFocus(projectId)`. Needs the created project id returned from the
   create path (thread it back from `handleFullscreenCreateClip`, which today returns only
   `saveOk`); T10240 needs the same seam, build it once. In edit mode on a play that already has a
   clip, it is just save + navigate.
2. **Details**: label "Details" always (drop the "Add" prefix and the content-count suffix or keep
   the suffix, user's call: default keep count). Default `detailsOpen = !isMobile` (the hook is
   already in scope, `:167`); the `[existingClip]` reset effect must not re-close it on desktop.
   Mobile keeps the popup, closed by default. Update `AddDetailsPopup` heading/aria to "Details".
3. **Save closes**: the strip-layout create branch calls `onResume()` like every other layout
   (drop the `onResumePlaybackOnly` special case and the rehydrate-into-edit behavior). Keep the
   failed-save path open (error state) as today.
4. Copy through `displayNames.js`; tests asserting "Create an editable clip" get updated.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- `src/frontend/src/modes/annotate/components/AddDetailsPopup.jsx`
- `src/frontend/src/containers/AnnotateContainer.jsx:1246-1375,1562-1576`
- `src/frontend/src/modes/annotate/hooks/useClipSelection.js`
- `src/frontend/src/screens/AnnotateScreen.jsx:230-243`
- `src/frontend/src/config/displayNames.js` (ANNOTATE block)

### Related Tasks
- Depends on: T10230 (Framing known-good). Shares the create-then-navigate seam with T10240.
- Reverses part of T9830 (two outcome buttons stay, but order and the second label change) and
  T9860's label; record as a decision in the task log, not drift.

## Acceptance Criteria

- [ ] Every layout shows Save play, then Save and Frame; Save and Frame lands in Framing with the
      just-saved clip loaded (desktop + mobile + landscape)
- [ ] "Details" is open by default at >= md, closed on mobile; label reads "Details"
- [ ] Saving from the desktop strip closes the editor (play stays selected)
- [ ] Unit tests updated; e2e drives Save and Frame from a fresh play
