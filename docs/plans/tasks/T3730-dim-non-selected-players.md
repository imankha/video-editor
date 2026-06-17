# T3730: Dim Non-Selected Detected Players

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

On the Overlay step "Pick your player," several detected players show as green frames. Once the
parent picks their athlete, the other detections stay visually equal, so there's no single,
unambiguous cue that "this is the one you chose." Reducing competing visual signal is core to
making the choice obvious (one cue, not many) — the same intent behind hiding confidence % in
T3700 P1.5.

This was specified alongside the T3700 quest split (Q3 `select_players`) but is an app behavior,
not a quest step, so it was deferred.

## Solution

Once a player is selected for a region, dim the non-selected detected players — reuse the
existing "Outside Dim" mechanism so the selected athlete is the single visual focus. The
`overlay_players_assigned` quest trigger already fires when every green-marked region has a
selection (shipped in T3700); this task is purely the visual reinforcement.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` — renders detection boxes; per-box opacity
- `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx` — existing Outside Dim (`dimStrength`, dark-overlay mask)
- `src/frontend/src/containers/OverlayContainer.jsx` — `handlePlayerSelect` / assignment state; `regionDetectionData`
- `src/frontend/src/stores/overlayStore.js` — `dimStrength` and related style state

### Related Tasks
- Parent: T3700 (Framing/Overlay Clarity) — esp. P1.5 (hide confidence %) which complements this
- Pairs with: the T3700 Q3 `select_players` trigger (already shipped)

### Technical Notes
- Reuse Outside Dim rather than inventing a new dim path (single source of truth for dim style).
- Display-only: do not change what detections/keyframes are computed or persisted.

## Implementation

### Steps
1. [ ] Track which detection is the chosen player per region (derive from existing assignment state).
2. [ ] Dim non-selected detection boxes (reuse Outside Dim styling) once a selection exists.
3. [ ] Restore full visibility if the selection is cleared.

## Acceptance Criteria

- [ ] After choosing a player, the non-selected detections are visibly dimmed.
- [ ] The chosen athlete is the single clear visual focus.
- [ ] Dim styling is the existing Outside Dim, not a parallel implementation.
- [ ] No change to persisted overlay data.
