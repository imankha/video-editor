# T8590: Desktop "Edit Play" opens the Add Play form (missing existingClip) - duplicate clip on Save

**Status:** STAGING
**Impact:** 7
**Complexity:** 2
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

On desktop non-fullscreen, clicking the "Edit Play" CTA (or the transport-bar edit button) with a clip selected opens the sidebar inline form in CREATE mode instead of EDIT mode. The user sees "Add Play" with fresh 12s default bounds instead of their clip's data, and pressing Save creates a DUPLICATE clip instead of updating the selected one.

Found by the ux-designer review of the T8600 proposal (2026-09-03), then verified in code:

- "Edit Play" -> `handleAddClipFromButton` (`AnnotateContainer.jsx:838`) -> `editClip` -> `EDITING` state -> `isOverlayOpen` true (`useClipSelection.js:79`) -> `showAddClipForm` (`AnnotateScreen.jsx:676`).
- `ClipsSidePanel.jsx:343-359` renders `AnnotateFullscreenOverlay` with **no `existingClip` prop**. Compare the fullscreen render at `AnnotateModeView.jsx:604-621`, which passes it. With `existingClip` null the overlay's `isEditMode` is false: create heading, default bounds, `onCreateClip` on save.
- Pre-T8130 this path was effectively unreachable in non-fullscreen (the transport Add button hides when a clip is SELECTED); T8130's always-visible CTA made it a primary path.
- Metric contamination: the T8140 `add_clip_opened_no_save` beacon arms on `!isEditMode`, so every confused close of one of these mislabeled edit-opens is counted as CREATE abandonment. Fix this before trusting the beacon (T8600 depends on that data).
- The T8130 e2e guard only asserts the CTA label/title, not what opens after the click (`clip-selection-state-machine.spec.js:246-253`) - that is why CI never caught it.

## Solution

Pass the selected region as `existingClip` to the `AnnotateFullscreenOverlay` render in `ClipsSidePanel.jsx` (the selected region is already available in that component tree for `ClipDetailsEditor`). Reproduce live first (drive-app-as-user), then add the missing regression coverage: a test that clicks Edit Play on desktop non-fullscreen and asserts the form opens in edit mode with the clip's values, and that Save updates rather than creates.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` - the broken render (line ~344), fix here
- `src/frontend/src/screens/AnnotateScreen.jsx` - `showAddClipForm` wiring (line ~676); source of the selected region prop if not already passed down
- `src/frontend/src/modes/annotate/hooks/useClipSelection.js` - EDITING/isOverlayOpen semantics (read-only reference)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - `existingClip` -> isEditMode behavior (read-only reference)
- `e2e/clip-selection-state-machine.spec.js` - extend the T8130 guard to assert what opens, not just the CTA label

### Related Tasks
- Blocks: T8600 (the inline play editor redesign builds on this surface AND on the beacon this bug contaminates)
- Introduced around: T8130 (Annotate primary CTA)
- Beacon context: T8140 (`add_clip_opened_no_save`)

### Technical Notes
- UX review: [../ux/UX-inline-play-editor-2026-09-03.md](../ux/UX-inline-play-editor-2026-09-03.md)
- Tier: M (behavior-adjacent bug on a primary CTA path; one-line-ish fix but needs live reproduction + regression tests). Reviewer: yes. No schema change.

## Implementation

### Steps
1. [ ] Reproduce live on desktop viewport (dev-login, select a clip, click Edit Play, observe create-mode form)
2. [ ] Fix: pass `existingClip` (selected region) through to the ClipsSidePanel overlay render
3. [ ] Unit test: ClipsSidePanel renders overlay in edit mode when the selection state is EDITING
4. [ ] E2E: extend clip-selection-state-machine.spec.js - Edit Play opens edit-mode form, Save updates (no duplicate row)
5. [ ] Verify the abandonment beacon does NOT fire for edit-opens after the fix

## Acceptance Criteria

- [ ] Desktop non-fullscreen Edit Play opens the form pre-filled with the selected clip (heading "Edit Play", clip's bounds/rating/tags/name)
- [ ] Save updates the existing clip; clip count unchanged
- [ ] `add_clip_opened_no_save` no longer arms on edit-opens from this path
- [ ] Regression test covers the click-through, not just the CTA label
