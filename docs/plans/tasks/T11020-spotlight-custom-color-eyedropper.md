# T11020: Spotlight custom color spectrum + eyedropper

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-22
**Updated:** 2026-09-22

## Problem

The Overlay "Spotlight" settings panel only offers 6 fixed swatches (white, cyan,
yellow, pink, orange, none). A parent wants the spotlight ring/fill to match their
kid's uniform color, which is essentially never one of the 5 presets.

## Solution

Add a full-spectrum custom color control (native `<input type="color">`, matching
the existing pattern in `TextSpecEditor.jsx`) plus an eyedropper ("teardrop") tool
that uses the browser's native `EyeDropper` API to sample a color directly off the
video frame (or anywhere on screen) so the user can match the uniform exactly.
Feature-detected — hidden on browsers without `window.EyeDropper` (Firefox/Safari),
since the spectrum picker alone still satisfies "full color spectrum".

No backend/schema change: `highlight_color` is already stored and rendered as an
opaque hex string server-side (`src/backend/app/routers/export/overlay.py`), and the
gesture-based persistence path (`OverlayScreen.jsx` `wrappedSetHighlightColor` ->
`overlayActions.setHighlightColor`) does no enum validation — confirmed by trace
before implementation.

## Context

### Relevant Files
- `src/frontend/src/components/settings/OverlaySpotlightPanel.jsx` - swatch row, add custom picker + eyedropper button
- `src/frontend/src/constants/highlightColors.js` - add a shared `highlightColorLabel()` helper (fixes the `|| 'White'` fallback for a custom hex, used from 2 call sites)
- `src/frontend/src/modes/OverlayModeView.jsx` - mobile summary line uses the same label fallback, needs the same fix
- `src/frontend/src/config/displayNames.js` - two new EDITOR_PANELS strings (custom color label, eyedropper aria/title copy)
- `src/frontend/src/components/settings/OverlaySpotlightPanel.test.jsx` - add coverage

### Related Tasks
None.

### Technical Notes
- `onHighlightColorChange` is a plain pass-through prop; no new persistence path needed,
  the existing gesture handler already writes any string.
- Rendering (`HighlightOverlay.jsx`) already parses `color` as a generic hex string
  (substring/parseInt), no enum dependency — confirmed no other frontend consumer
  switches on the 5 preset values.
- `window.EyeDropper` is Chromium-only (Sept 2026); feature-detect and hide the button
  otherwise rather than showing a broken control.

## Implementation

### Steps
1. [x] Add `highlightColorLabel()` to `constants/highlightColors.js`
2. [x] Add custom color swatch (native color input, conic-gradient styling) to `OverlaySpotlightPanel.jsx`
3. [x] Add feature-detected eyedropper button to `OverlaySpotlightPanel.jsx`
4. [x] Fix the two `|| 'White'` label fallbacks to use the new helper
5. [x] Add EDITOR_PANELS strings
6. [x] Tests

### Progress Log

**2026-09-22**: Implemented per plan above. Stage 4.5 Reviewer (fresh context) found 2
MAJOR issues, both fixed before commit:
- The native color input's `onChange` fires continuously while dragging inside the
  OS picker dialog (unlike the panel's 5%-step sliders, ~9 discrete values). Fixed by
  debouncing the network write in `OverlayScreen.jsx`'s `wrappedSetHighlightColor`
  (250ms, mirrors the existing `wrappedUpdateTextSpec` pattern) — local Zustand state
  still updates on every event so the live preview stays smooth.
- The eyedropper's bare `catch {}` silently swallowed every failure, not just the
  expected `AbortError` on cancel. Fixed to log non-abort errors via `console.warn`.
Also addressed 2 of the 4 MINOR findings (cheap fixes): added visible focus rings to
both new controls, and the custom swatch now shows the actual picked color instead of
always the rainbow gradient. Left as accepted debt (pre-existing patterns, out of
scope): the "unset defaults to white" fallback has one more sibling in
`useHighlightRegions.js`, and non-hex test/dev-harness fixtures (e.g. `'white'`
lowercase) aren't guarded against reaching the native color input — never hit in
production, where the real default is `'#FFFFFF'`.

## Acceptance Criteria

- [x] User can pick any color via a full-spectrum control, not just the 5 presets
- [x] User can sample a color from the video frame via an eyedropper (where supported)
- [x] Existing preset swatches still work; the readout doesn't misreport a custom color as "White"
- [x] Frontend unit tests pass
