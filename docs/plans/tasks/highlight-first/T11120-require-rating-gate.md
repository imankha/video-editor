# T11120: Unrated Done opens the "Rate this play" modal

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Highlight-First Annotate Flow](EPIC.md)

## Problem

Every new play enters the editor with `rating` NULL (`AnnotateContainer.jsx`
`handleAddClipFromButton` :1502, :1530). Unrated plays are silently excluded from recap and
auto-export (`auto_export.py:241`) and, in the new flow, can never become a highlight.

Owner ruling 2026-09-24 (round 2): don't bog the UI down with the word "required"; the UI just
ACTS required. "If the user clicks done without rating it, pop a modal popup asking user to rate
the play with details for each rating."

## Solution

**A gate, never a write.** Leaving the editor on an unrated play opens a **"Rate this play"
modal** (design: T11100 mockups). It lists 5 Highlight / 4 Good / 3 Interesting / 2 Technical
Lapse / 1 Mental Lapse, each with stars, adjective and a one-line meaning. Approved copy
(2026-09-24): Highlight "Brilliant Play! Everyone should see it." (owner's exact words), Good
"A solid play worth remembering.", Interesting "Worth a second look.", Technical Lapse "A touch
or skill to work on.", Mental Lapse "A decision or focus moment to learn from."; title "Rate
this play". The editor's rating pill (A2) opens the SAME list, so it is one component. **The
modal only appears when the play was not rated during the edit** (owner ruling); a rated play
leaves normally. Picking a row is the rating gesture: it persists the rating
through the normal path, closes the modal and CONTINUES the original exit (Done on a Highlight
pick then shows T11130's popup). The modal never closes on backdrop click; its dismissal returns
to the editor with nothing written. Nothing sets or persists a default rating; no effect watches
the rating (CLAUDE.md gesture-based persistence).

### Exit paths (H5 decides the set; recommended: all)
Through `closeWithCommit` (`AnnotateFullscreenOverlay.jsx:327`): formBody X (:429), actionsFooter
Done (:565), strip Done (:788), landscape X (:850), portrait-strip Done (:949), `keepMarkingCta`
(:621), window Escape (:260-266).

Outside `closeWithCommit` (each needs its own check):
- empty timeline click -> `closeOverlay()` (`AnnotateContainer.jsx:1888-1891`)
- mobile fullscreen exit incl. Escape (`handleToggleFullscreen` :1273-1277, Escape effect
  :2043-2055; the document listener fires before the overlay's window listener)
- selecting another play while editing (`handleSelectRegion` :1904 -> `editClip(otherId)`)
- leaving via mode bar / Home (`AnnotateScreen.jsx:185-211` unmounts the editor)

Always allowed: Delete play (`handleDeletePlayFromEditor` :1825).

### Landmines
- The rating picker stops Escape propagation on the document (`PlayProgressBadges` :206); keep
  Escape ordering right with the modal on top of the mobile fullscreen editor.
- Rating commit is async (region write queue). The continued exit must await region writes
  before any navigation (T11130's Make Highlight Now path).
- Sidebar `ClipDetailsEditor.jsx`: no modal (it only sees plays that already left the editor,
  except legacy unrated rows, H6).
- The UI cannot un-rate and the backend PUT ignores `rating: null` (`clips.py:1504`); keep it so.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- `src/frontend/src/containers/AnnotateContainer.jsx` (path per knowledge doc)
- `src/frontend/src/screens/AnnotateScreen.jsx`
- `src/frontend/src/config/displayNames.js`, `components/shared/clipConstants.js` (meanings)

### Tests to update
`AnnotateFullscreenOverlay.noSaveButton` (Escape/Done), `.keys`, `.portraitStrip`, `.stripLayout`,
`AnnotateContainer.createAtTap`.

### Related Tasks
- Depends on: T11100 (modal design), T11150 (strict order, same files)
- Blocks: T11130

## Acceptance Criteria

- [ ] Red-then-green per gated exit: unrated play opens the modal instead of leaving; rated play leaves normally
- [ ] Picking a rating in the modal saves it and completes the original exit
- [ ] Dismissing the modal writes nothing (network log)
- [ ] Delete play works on an unrated play
- [ ] Live-driven desktop + 393 px portrait + landscape phone
