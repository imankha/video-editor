# T6980: Overlay — double-click/double-tap a text element edits it in place (+ Text tab sync)

**Status:** DONE — deployed 2026-08-16 prod.
**Impact:** 6
**Complexity:** 5
**Created:** 2026-08-13
**Updated:** 2026-08-13

## Problem

User request (staging testing, 2026-08-13): "In Overlay, double clicking (or double
tapping) on a text field should select the Text tab of the settings icon and cause an
accepting cursor in both the clicked text field and the text field for text in the text
setting tab, and accept text in both places."

Today a canvas text element supports click-to-select and drag-to-position (T6720), but
editing the STRING requires finding the element in the Text tab's region tree and typing
into the panel input. Double-click on the canvas does nothing.

## Solution (design-gate before implementing — this touches the most-churned code in the repo)

On double-click/double-tap of a text element on the preview canvas:
1. Select that element (existing click-to-select path, `TextOverlayPreview.jsx` canvas
   click-to-select from T6720).
2. Switch the settings panel to the **Text** tab (`OverlaySettingsTabs`, tab id `text`)
   and expand/scroll the owning region + element in `TextManagementPanel`'s tree, with
   the element's text input focused (caret at end).
3. Enter inline edit mode ON the canvas element: an editable caret in the rendered text
   (likely a positioned `contentEditable` mirror or transparent input overlaying the
   element at its computed spec position/size), live-updating the SAME draft state the
   panel input edits — one source of truth, both views reflect keystrokes.
4. Persistence stays gesture-based and surgical: reuse the panel's existing
   debounced-commit path (`update_text_spec` action) — the inline editor must NOT add a
   second write path; it feeds the same handler the panel input uses. Commit on
   blur/Escape/Enter per the panel's existing semantics.

Constraints / landmines:
- **Double-click vs single-click vs drag** on the same element: T6720's
  `DRAG_THRESHOLD_PX=4` click-vs-drag discrimination and the trailing-click guard —
  double-click detection must not break drag or mobile fullscreen toggle
  (`wrappedMoveTextPosition`, `TextOverlayPreview.jsx:40-94`).
- Double-TAP on touch: implement a ~300ms two-tap detector on the element (no native
  dblclick on touch); must not conflict with pinch/scroll.
- T6880 (playhead-outside-range ghost rendering) intersects: inline edit should only be
  offered when the element is genuinely editable/visible under its rules.
- RichText rendering is a measured/wrapped mirror of the backend renderer — the inline
  editor overlays it; do NOT try to make RichText itself editable.
- While inline editing, keyboard shortcuts of the overlay screen (space=play etc.) must
  be suppressed.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/overlays/TextOverlayPreview.jsx` — click/drag/select
  handling (T6720), where dblclick lands
- `src/frontend/src/modes/OverlayModeView.jsx` — settings tab state, canvas host
- `src/frontend/src/components/overlay/OverlaySettingsTabs.jsx` — programmatic tab switch
- `src/frontend/src/components/overlay/TextManagementPanel.jsx` — region tree
  expand/scroll/focus; the text input whose state the inline editor must share
- `src/frontend/src/modes/overlay/hooks/useTextOverlays.js` — `updateElementSpec`
- Knowledge: `.claude/knowledge/export-pipeline.md` §Overlay text

### Classification guidance
M/L-tier, Frontend-only, ~4-5 files. Architect design gate recommended (inline-editor
mechanism + focus model have real tradeoffs); real-browser e2e REQUIRED (pointer +
focus behavior; jsdom is false confidence per T5380 memory).

## Acceptance Criteria
- [ ] Double-click (desktop) and double-tap (touch) on a canvas text element: Text tab
      active, region expanded, both inputs show caret, typing in EITHER updates both
      live and persists via the single existing write path
- [ ] Single-click select and drag-to-position behave exactly as before (T6720 tests green)
- [ ] Screen shortcuts suppressed while editing; blur/Escape ends inline edit cleanly
- [ ] Real-browser e2e covering the full gesture; relevant unit tests green
