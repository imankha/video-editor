# T4570: useEditorScreenShell + Shared Keyboard Shortcuts in Overlay

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-07-03
**Source:** Audit item C10 ([audit doc](../audit-2026-07-03-code-quality.md)) · Best after the editor-decoupling epic slims both screens

## Problem

[DRY] `FramingScreen.jsx` (1212 L) and `OverlayScreen.jsx` (1115 L) are copy-paste siblings: identical 20-name `useVideo` destructure (:182-207 vs :184-207), identical `useZoom` (:258-269 vs :240-251) and `useTimelineZoom` destructures, character-identical `handleToggleFullscreen` + Escape-key effect (:851-860 vs :910-919), parallel `handleRetryVideo`.

Divergence-bug-in-waiting: Framing wires keyboard via the shared `useKeyboardShortcuts` (arrows seek `ARROW_SEEK_SECONDS = 4`s on the playhead layer); Overlay re-implements keydown inline (:864-896) where arrows always frame-step and copy/paste/layer handling is missing. **Same keys, different behavior per mode**, two places to fix.

## Solution

1. **`hooks/useEditorScreenShell.js`**: bundles video transport + zoom + timeline-zoom + fullscreen/Escape + retry into one hook returning a stable surface both screens consume. Extract EXACTLY what's identical (the diff-table decides); anything divergent stays in the screens.
2. **Overlay adopts `useKeyboardShortcuts`**: delete the inline keydown. Where behaviors differ (arrow = seek vs frame-step), that's a UX decision — present both + a recommendation (recommend framing's, it's the shared-hook behavior), get the user's pick, apply to both modes via the hook's config.
3. Do NOT attempt a full screen merge (audit rated that high-risk) — the shell hook + shortcuts are the valuable 20%.

## Steps

1. [ ] Diff-table of the identical blocks (the audit lists them; re-verify line ranges — the decoupling epic will have shifted them).
2. [ ] Shell hook + migrate FramingScreen (behavior-identical; E2E green), then OverlayScreen.
3. [ ] Keyboard: UX decision recorded → Overlay onto useKeyboardShortcuts; keymap test asserting both modes handle the same keys the same way (excluding mode-specific actions).
4. [ ] Manual pass: all shortcuts in both modes, fullscreen, retry.

## Acceptance Criteria

- [ ] Both screens consume the shell hook; the identical blocks exist once
- [ ] One keyboard implementation; arrow-key behavior uniform and user-approved
- [ ] Screens each shrink by ~150+ lines with zero behavior change beyond the keyboard decision
