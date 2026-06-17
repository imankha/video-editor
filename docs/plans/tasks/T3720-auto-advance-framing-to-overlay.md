# T3720: Auto-Advance Framing -> Overlay

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

The T3700 quest split made "Spotlight Your Player" (overlay) its own quest (Q3), whose first
step `open_overlay` completes on the `opened_overlay_editor` achievement. Today the user has to
find their way into the overlay editor themselves after the framing export finishes. For a
non-technical parent this is a dead end between two quests — the spotlight quest can't begin if
they never discover how to open overlay.

The Q3 hint copy already promises this ("We open this for you right after your highlight
finishes exporting"), so the behavior must exist to match the copy.

## Solution

When a framing export completes for the active reel during onboarding, automatically advance the
user into Overlay mode (or present a single, prominent "Spotlight your player ->" CTA that
deep-links there). Entering overlay fires the existing `opened_overlay_editor` achievement
(already wired in `App.jsx`), starting Q3 naturally.

Open questions for Architecture:
- Hard auto-advance vs. prominent CTA. Prefer CTA for users past onboarding; auto-advance (or a
  very prominent prompt) while Q2 is the active quest.
- Only trigger for the reel the user just framed, and only once.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/QuestPanel.jsx` — already listens to export websocket `complete` events
- `src/frontend/src/services/ExportWebSocketManager.js` — export completion signal
- `src/frontend/src/containers/OverlayContainer.jsx` — `handleProceedToOverlay` (existing framing->overlay transition)
- `src/frontend/src/stores/editorStore.js` — `setEditorMode('overlay')`
- `src/frontend/src/App.jsx` — `opened_overlay_editor` achievement effect (already wired in T3700)

### Related Tasks
- Parent: T3700 (Framing/Overlay Clarity)
- Depends on / pairs with: the T3700 quest split (Q3 `open_overlay` step) — already shipped
- Related: T3540 (Framing in-progress visual ambiguity)

### Technical Notes
- Must respect the gesture/persistence rules — this is navigation only, no DB write-back.
- Guard against firing for non-onboarding users or repeatedly for the same export.

## Implementation

### Steps
1. [ ] On framing-export `complete` for the active reel, route the user toward Overlay (auto or prominent CTA).
2. [ ] Ensure entering Overlay fires `opened_overlay_editor` (verify existing effect).
3. [ ] Gate to once-per-export / onboarding-appropriate.

## Acceptance Criteria

- [ ] After a framing export completes, the user is taken to (or one click from) Overlay.
- [ ] Q3 step `open_overlay` completes without the user hunting for the overlay editor.
- [ ] No reactive DB write-back; navigation only.
- [ ] Does not loop or re-trigger for the same export.
