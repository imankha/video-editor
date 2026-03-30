# T775: navigationStore Does Not Control Screen Routing

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-03-29
**Updated:** 2026-03-29

## Problem

`navigationStore.js` (`useNavigationStore`) has a `navigate()` function and tracks `mode`, `previousMode`, and `history`, but **none of this actually controls which screen renders**. Screen rendering is controlled entirely by `editorMode` in `editorStore` (set via `setEditorMode`), and App.jsx conditionally renders screens based on `editorMode`.

This was discovered during T770 — calling `navigate('project-manager')` had no visible effect because it only updated the navigationStore, not editorMode.

### Evidence
- `App.jsx` renders screens via `editorMode === EDITOR_MODES.FRAMING`, `.OVERLAY`, etc.
- `handleModeChange` in App.jsx calls `setEditorMode()`, not `navigate()`
- `OverlayScreen` imports `navigate` from navigationStore but its `handleBackToProjects` (which uses it) is dead code (lint warning: unused)
- The navigationStore `mode` is never read by App.jsx for routing decisions

## Solution

Either:
1. **Remove navigationStore entirely** — if editorStore is the source of truth, delete the duplicate
2. **Consolidate** — merge navigationStore's history/back features into editorStore if they're wanted
3. **Wire it up** — make App.jsx use navigationStore instead of editorStore for routing (larger refactor)

Option 1 is simplest and eliminates confusion.

## Acceptance Criteria

- [ ] Single source of truth for which screen is displayed
- [ ] No dead `navigate()` calls that appear functional but do nothing
- [ ] Back navigation still works if needed
