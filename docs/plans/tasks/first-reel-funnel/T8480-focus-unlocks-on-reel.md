# T8480: Focus unlocks the moment a reel exists (bug)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

Walkthrough 2026-09-02: after saving a clip with the reel switch ON and seeing the
"Reel created!" toast, the Focus and Overlay tabs stayed DISABLED. The only explanation
anywhere is a native title attribute, "Select a reel first" (ModeSwitcher.jsx ~line
104-114), which is hover-only and therefore invisible to every touch user. The persona
had to wander to Home and find the continue card to unlock Focus.

User decision 2026-09-03: this is a bug. If a reel has been created, Focus should be
enabled and working. Add a toast: "Reel started, click Focus to complete".

## Solution

- When a reel is created from Annotate (save-with-reel-on, or the details-panel gesture),
  select that reel in editor state as part of the same gesture handler, so the Focus tab
  enables immediately.
- Replace the post-save toast copy with the user's wording: "Reel started, click Focus
  to complete". Make the toast tappable (navigates to Focus for that reel).
- Keep Overlay's gating as is (it genuinely needs a focused export first), but give the
  disabled state a visible, touch-reachable explanation instead of a title attribute
  (small caption or tooltip-on-tap consistent with the ui style guide).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ModeSwitcher.jsx` - disabled logic + title-only hint (~line 104-114)
- `src/frontend/src/containers/AnnotateContainer.jsx` - save handler + toast (~line 924)
- `src/frontend/src/stores/editorStore.js` - selected reel/project state
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` - details-panel reel gesture

### Related Tasks
- T8470 owns the status strings and drawer visibility; this task owns tab enablement + toast
- Gesture-persistence rule: selecting the reel in the store as part of the save gesture is
  memory-only state, no new backend write

### Technical Notes
Root-cause the current gate first: the tab likely keys on a "selected project" that only
gets set by navigation surfaces. Selecting at creation must not fight the pendingGameId /
navigation breadcrumb flow. If the mechanism is unclear after one read, escalate to the
expert agent per the model policy.

## Implementation

### Steps
1. [ ] Trace what ModeSwitcher's disabled state reads and why creation does not set it
2. [ ] Set selected reel in the creation gesture; enable Focus immediately
3. [ ] Toast: "Reel started, click Focus to complete" (tappable -> Focus)
4. [ ] Touch-visible disabled-state explanation for Overlay
5. [ ] Unit test on the store transition + e2e: save with reel on -> Focus tab enabled -> tap toast lands in Focus

## Acceptance Criteria

- [ ] Immediately after reel creation, Focus is enabled with the new reel active
- [ ] Toast reads exactly "Reel started, click Focus to complete" and navigates on tap
- [ ] No load-bearing explanation exists only in a title attribute
- [ ] Verified at 390x844
