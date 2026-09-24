# T11120: Require a star rating to leave the play editor

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Highlight-First Annotate Flow](EPIC.md)

## Problem

Every new play enters the editor with `rating` NULL (`AnnotateContainer.jsx` `handleAddClipFromButton`
:1502, :1530). Unrated plays are silently excluded from recap and auto-export
(`auto_export.py:241`), get no adjective in derived names, and in the new flow cannot become a
highlight. The rating has to be a required step, not an optional one.

## Solution

A **gate, never a write.** Leaving the editor on an unrated play is blocked and the rating control
is surfaced (presentation per T11100 section C). Nothing sets or persists a default rating, and no
effect watches the rating (CLAUDE.md gesture-based persistence).

### Exit paths to gate (H5 decides the set; recommended: all)
Through `closeWithCommit` (`AnnotateFullscreenOverlay.jsx:327`): formBody X (:429), actionsFooter
Done (:565), strip Done (:788), landscape X (:850), portrait-strip Done (:949), `keepMarkingCta`
(:621), window Escape (:260-266).

Outside `closeWithCommit` (need their own check):
- empty timeline click -> `closeOverlay()` (`AnnotateContainer.jsx:1888-1891`)
- mobile fullscreen exit incl. Escape (`handleToggleFullscreen` :1273-1277, Escape effect
  :2043-2055; the document listener fires before the overlay's window listener)
- selecting another play while editing (`handleSelectRegion` :1904 -> `editClip(otherId)`)
- leaving via mode bar / Home (`AnnotateScreen.jsx:185-211` unmounts the editor)

Always allowed: Delete play (`handleDeletePlayFromEditor` :1825).

### Landmines
- The rating picker stops Escape propagation on the document (`PlayProgressBadges` :206); keep
  the gate's Escape ordering correct on mobile fullscreen.
- Rating commit is async (region write queue). The gate checks the in-memory rating the user just
  picked, not a server round-trip.
- Sidebar `ClipDetailsEditor.jsx` (SELECTED, non-edit play): no gate recommended (it only ever
  sees plays that already passed the editor, except legacy NULL rows - H6).
- Legacy NULL-rated plays (H6): gated when their editor next opens; no backfill migration.
- The UI cannot un-rate today and the backend PUT ignores `rating: null` (`clips.py:1504`); keep it
  that way.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- `src/frontend/src/containers/AnnotateContainer.jsx` (path per knowledge doc)
- `src/frontend/src/screens/AnnotateScreen.jsx`
- `src/frontend/src/config/displayNames.js` (gate copy)

### Tests to update
`AnnotateFullscreenOverlay.noSaveButton` (Escape/Done), `.keys`, `.portraitStrip`, `.stripLayout`,
`AnnotateContainer.createAtTap`.

### Related Tasks
- Depends on: T11100 (section C pick)
- Blocks: T11130 (same files, strict order)

## Acceptance Criteria

- [ ] Red-then-green per gated exit path: unrated play cannot be left; rated play leaves normally
- [ ] Delete play works on an unrated play
- [ ] No new write path: network log shows no rating PUT unless the user picked a star
- [ ] Live-driven desktop + 393 px portrait + landscape phone
