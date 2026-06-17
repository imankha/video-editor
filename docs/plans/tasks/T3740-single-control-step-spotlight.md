# T3740: Single-Control-at-a-Time Step Spotlight

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

The T3700 quest split decomposed Framing/Overlay into small, single-concept steps (position the
crop, add slow-mo, export; then pick player, color, shape, export). But the editor still presents
every control at once, so a parent on the "add slow-mo" step sees the crop box, the timeline
segment layer, the export button, and style controls simultaneously. Decomposed *instructions*
without decomposed *attention* still overwhelms.

This guided-attention behavior was specified alongside the quest split but is an app behavior,
not a quest step, so it was deferred.

## Solution

Highlight only ONE control at a time for the active quest step, drawing the eye to the single
thing the current step asks for:
- Q2: crop box (position_crop) -> timeline segment layer (add_slowmo) -> Export button (export_framing)
- Q3: detection markers (select_players) -> color control (choose_color) -> shape toggle (choose_shape) -> Export button (export_overlay)

Derive the active step from the quest store (active quest + first incomplete step) and apply a
spotlight/affordance to the matching control. Non-active controls remain usable (non-blocking,
per T3700 P0.3) but visually recede.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/questStore.js` — active quest + per-step completion (drives which control to spotlight)
- `src/frontend/src/components/QuestPanel.jsx` — already knows the active step/hint
- Framing controls: `src/frontend/src/modes/framing/overlays/CropOverlay.jsx`, `src/frontend/src/modes/framing/FramingTimeline.jsx` (segment layer), `src/frontend/src/components/ExportButtonView.jsx`
- Overlay controls: `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx`, overlay color/shape controls in `src/frontend/src/components/ExportButtonView.jsx`

### Related Tasks
- Parent: T3700 (Framing/Overlay Clarity) — esp. P2.9 (hide multi-lane timeline until needed)
- Pairs with: T3710 (preview), T3720 (auto-advance), T3730 (dim non-selected) — the guided-attention layer
- Depends on: the T3700 quest split step IDs (already shipped)

### Technical Notes
- Read-only consumer of quest state; do not write quest state from the editor.
- Keep non-active controls functional — spotlight is a visual emphasis, not a lock (non-blocking rule).
- Map step_id -> control in one place to avoid drift if step IDs change.

## Implementation

### Steps
1. [ ] Add a selector that yields the active step's target control id.
2. [ ] Build a reusable spotlight/affordance wrapper for a control.
3. [ ] Wire Framing controls (crop / segment layer / export) to spotlight by active step.
4. [ ] Wire Overlay controls (detections / color / shape / export) to spotlight by active step.

## Acceptance Criteria

- [ ] On each Framing/Overlay step, exactly one control is visually emphasized, matching the active quest step.
- [ ] Non-active controls remain usable (no hard block).
- [ ] step_id -> control mapping lives in one place.
- [ ] No quest state is written from the editor.
