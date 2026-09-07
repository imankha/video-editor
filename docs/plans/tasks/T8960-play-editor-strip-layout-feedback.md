# T8960: Play editor strip: loop in create mode, name-first header, "Clip" toggle, layer on top line, no details scroll

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-07
**Updated:** 2026-09-07

## Problem

Live-testing feedback (2026-09-07) on the desktop under-canvas Add/Edit Play editor strip
(`AnnotateFullscreenOverlay layout="strip"`, T8600, refined by T8760/T8730/T8490). Nine
items, verbatim from the user:

1. "When in edit mode, the playhead should always be in the green area (selected); if it's
   playing when it gets to the end time it should start back at the start. Currently it
   plays through."
2. "The name should be the first control. It should have a default name with an edit pen
   icon next to it so the user knows they can rename."
3. "The title '+ Adding new play' should be centralized on the control since it's a title."
4. "The Reel button needs to take more space. Don't call it 'Reel' though, call it 'Clip'.
   Say 'Clip Play to focus on your player' or 'Don't Clip Play' on the toggle."
5. "My Athlete vs Team control should be on top line with play name."
6. "More details should not require a scroll."
7. "In edit mode, instead of calling it 'Clip Out Play' just call the button 'Clip Play'."
8. "If I click on the timeline inside of the selected area during edit/add play mode, the
   playhead should jump there."
9. "Just remove the back and forward buttons when in add/edit play mode." (Superseded the
   first wording, "the restart button restarts on the start_time" - the user chose removal
   over retargeting.)

Root cause of item 1 (already located, not a guess): T8760's clip-scoped loop in
`ClipScrubRegion.jsx` (~L316) is gated on `isEditingRef = clipEditorActive && !!existingClip`,
and the seed-to-start effect (~L339) on `existingClip` too. Both were DELIBERATELY excluded
from create mode ("Add Play keeps unconstrained playback + the wide +/-30s window", see
annotate.md T8760 entry). The user is in the create-mode editor ("Adding new play" is the
create-mode header) and wants the same loop + in-region playhead there. This is a product
reversal of that T8760 decision for the primary editor, not a regression.

## Solution

Rework the strip layout to a two-row header + one controls row, and extend the loop/seed
gate to the whole primary editor (create AND edit), leaving the sidebar
`ClipDetailsEditor` instance (`clipEditorActive` false) untouched.

Target layout (desktop strip):

```
+------------------------------------------------------------------+
| [pencil] Play name (default, editable inline)   [My Athlete|Team]  X |   <- header row 1
|                    + Adding new play  (centered title)               |   <- header row 2 (create) / hidden or "Editing" (edit)
| [========= scrub region, green selected span, looping =========]     |
| [stars]  [ Clip Play to focus on your player  (o) ]  ... [Add details] [Save] [Cancel] |
| Tags ... Notes ...   (expands in place, NO inner scroll)             |
+------------------------------------------------------------------+
```

- **Loop + in-region playhead in BOTH modes (item 1):** gate the RAF loop and the
  seed-to-start on `clipEditorActive` alone (drop the `existingClip` half for the loop;
  in create mode seed to the current `startTime` handle once on open). Also clamp: if the
  playhead is outside `[startTime, endTime]` when a scrub handle moves (e.g. user drags
  start past the playhead), seek to `startTime` - the playhead is never outside the green
  span while the editor is open. Keep the `clipEditorActive` leak guard exactly as T8760
  built it (the sidebar instance must keep its own T8780 Preview-play behaviour).
- **Click inside the span seeks (item 8):** a pointerdown+up (no drag) on the scrub
  region's track BETWEEN the two handles seeks the playhead to that time (`onSeek`) and
  moves neither handle. Note the main `AnnotateTimeline` is HIDDEN while the strip editor
  is open (`underCanvasEditor`, T8600), so `ClipScrubRegion` is the only timeline the user
  can click here - this lives in its pointer handler, next to the existing handle-drag
  code (the RegionLayer Pointer-Events + `setPointerCapture` pattern). A click OUTSIDE the
  span keeps today's behaviour (whatever it does now - verify and pin it in a test, since
  the loop/clamp from item 1 must not fight a deliberate outside-click). Distinguish click
  from drag with the same small movement threshold the handle drag already uses.
- **No back/forward buttons in the editor (item 9):** the transport bar's skip-back
  (restart) and skip-forward controls in `AnnotateControls.jsx` are NOT rendered while the
  editor is open. Gate on `clipEditBounds` (`{start,end}`, T8760, already passed from
  `AnnotateModeView`, `null` outside the editor) - no new prop, no new state. Play/pause +
  spacebar stay (T8760 single-play-control invariant); the clip-relative time readout stays.
  Their keyboard shortcuts, if any, are disabled under the same gate so the playhead can't
  leave the span via a key the button no longer offers. Do not remove them from the
  non-editing transport bar.
- **Name first, default + pencil (item 2):** reuse the edit-mode header pattern (pencil +
  inline input on click, `isEditingName`) for create mode too. Show `defaultClipName` as
  the rendered text until the user renames; the standalone `<input>` in the controls row
  (create-mode only, ~L809) is deleted. One name affordance per mode, same component.
- **Centered title (item 3):** "+ Adding new play" becomes its own centered row under the
  name/layer row (`text-center`), not the left slot of a `justify-between` header.
  Edit mode: no second row (the name already says what you're editing).
- **"Clip" toggle with stateful copy (item 4):** replace the tiny `Reel` label + `Toggle`
  (create mode, ~L795) with a wider toggle-button whose label reads
  `Clip Play to focus on your player` when on and `Don't Clip Play` when off. Same state
  (`createProject` / `createProjectManuallySet`, T5725 auto-flip on rating x layer
  unchanged). The `Reel created` chip stays. Do NOT touch the T8490 rating captions or
  `SECTION_NAMES` - this is the toggle's copy only.
- **Edit-mode button "Clip Play" (item 7):** the edit-mode `Clip Out Play` button (T8760's
  rename) becomes `Clip Play`. It renders at TWO sites in `AnnotateFullscreenOverlay.jsx`
  (formBody ~L639 and strip ~L791) - rename both so desktop and mobile edit mode agree.
  `ClipDetailsEditor`'s sidebar reel button and the multi-clip assembly / overlay-export
  "Create Reel" strings of OTHER features are unchanged (same scoping T8760 used).
- **Layer control on the top line (item 5):** move `LayerSegmentedControl` from the
  below-card button row (~L909) into header row 1, right-aligned next to the X. The
  below-card row then holds only the edit-mode `Focus` button (still right-anchored);
  render nothing there in create mode.
- **No details scroll (item 6):** drop `max-h-64 overflow-y-auto` on the in-place details
  panel (~L876); it grows to fit Tags + Notes. Verify the strip + canvas still fit a
  1280x720 desktop viewport with details open without the PAGE scrolling either; if the
  tag grid is the space hog, reduce `TagSelector size` in this one render site rather
  than reintroducing the inner scroll.

Mobile (`formBody` / `AddDetailsPopup`) is out of scope - the feedback is about the desktop
strip. Do not change the fullscreen or landscape-inline layouts.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - `layout === 'strip'`
  branch (~L681-940): header, controls row, details panel, below-card button row
- `src/frontend/src/modes/annotate/components/ClipScrubRegion.jsx` - loop gate (~L316) and
  seed-to-start (~L339); the `isEditing` derivation (~L90); track pointer handler (item 8)
- `src/frontend/src/modes/annotate/components/AnnotateControls.jsx` - skip-back/forward
  buttons (+ their shortcuts) gated off on `clipEditBounds` (item 9); `AnnotateModeView.jsx`
  already passes it (T8760)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.details.test.jsx`,
  `AnnotateFullscreenOverlay.layer.test.jsx`, `AnnotateFullscreenOverlay.keys.test.jsx`,
  `AnnotateModeView.strip.test.jsx` - existing strip tests to update (copy + structure)
- `src/frontend/src/modes/annotate/components/ClipScrubRegion.test.jsx` (or the T8760 loop
  test, whichever pins the create-mode exclusion) - flip the create-mode expectation

### Related Tasks
- Follows: T8600 (strip), T8760 (loop + header name), T8730 (below-card row), T8490 (captions)
- Reverses one T8760 decision (create-mode unconstrained playback) for the PRIMARY editor
- Multi-video caveat inherited from T8760 (raw `seek(startTime)` vs virtual time for
  sequence >= 2 clips) is NOT fixed here; note it if the live drive hits it

### Technical Notes
- Persistence untouched: name edits stay local until Save/Update; the toggle writes nothing
  until Save. No new state, no store changes.
- `clipEditorActive` remains the structural leak guard (annotate.md T8760 invariant) - the
  loop must still be impossible in normal game playback and in the sidebar editor.
- Two-layer Esc semantics (T8600) unchanged: the inline name input's own Esc handler
  already `stopPropagation`s; keep that when reusing it for create mode.
- Responsive: run `responsiveSweep` at 375px + desktop even though mobile layout is out of
  scope - the strip renders on narrow desktop windows too, and the wider toggle + header
  row must wrap, not overflow.

## Implementation

### Steps
1. [ ] `ClipScrubRegion`: loop + seed gate on `clipEditorActive` only; clamp playhead into
   `[start, end]` on handle drag; update the T8760 test that pinned create-mode exclusion.
2. [ ] Strip header: row 1 = pencil-name (both modes, default shown in create) + layer
   control + X; row 2 = centered "+ Adding new play" (create only). Delete the controls-row
   name input.
3. [ ] "Clip" toggle-button with the two copy states; wider; same state wiring.
4. [ ] Below-card row: Focus only (edit mode); nothing in create mode.
5. [ ] Details panel: remove inner scroll; verify 1280x720 fit with details open.
6. [ ] Tests: loop fires in create mode (RAF + seek called at end), playhead clamped on
   handle drag, name renders default + pencil in create mode, toggle copy per state, layer
   control present in header, details panel has no `overflow-y-auto`; e2e via dev-verify:
   open Add Play, press play, observe loop back to start; rename via pencil; toggle copy.

### Progress Log

**2026-09-07**: Filed from live-testing feedback on the strip editor. Root cause of item 1
located in `ClipScrubRegion.jsx` (loop gated on `existingClip`).

## Acceptance Criteria

- [ ] In BOTH Add Play and Edit Play, playback loops back to the clip start at the end time,
      and the playhead is never outside the green span while the editor is open
- [ ] Name is the first control, shows a default name with a pencil, renames inline
- [ ] "+ Adding new play" is centered on its own row (create mode)
- [ ] Toggle reads "Clip Play to focus on your player" / "Don't Clip Play", visibly wider
- [ ] My Athlete | Team sits on the top line with the name
- [ ] Edit-mode button reads "Clip Play" (both render sites); no "Clip Out Play" left in the overlay
- [ ] Clicking the scrub track inside the green span jumps the playhead there without moving a handle (real-browser check, not jsdom only - pointer interaction, T5380 precedent)
- [ ] Skip-back and skip-forward buttons (and their shortcuts) are absent while the editor is open; present and unchanged otherwise
- [ ] Details expand in place with no inner scroll; no page scroll at 1280x720
- [ ] Sidebar `ClipDetailsEditor` and mobile layouts unchanged (existing tests green)
- [ ] Curated test set + e2e green
