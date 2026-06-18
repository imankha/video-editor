# T3750: Redo All E2E Tests

**Status:** TODO (Hold until For Alpha - Polish)
**Impact:** 7
**Complexity:** 4
**Created:** 2026-06-16
**Updated:** 2026-06-17

## Problem

The E2E suite has drifted from the shipped product on several axes and is no longer a reliable
gate. Rather than patch individual specs piecemeal, do one consolidated pass to bring the whole
suite back in line. Known drift to date:

- **Quest flow:** T3700/T3705 restructured onboarding into 3 quests with new step IDs and new
  per-step event triggers (old repeat-everything quest_4 dropped; Vamos fires after quest_3).
  `new-user-flow.spec.js` still drives the OLD flow (old quest_2 framing+overlay bundle, old step
  IDs).
- **Button labels:** terminal buttons were renamed ("Frame Video" -> "Export Highlight",
  "Add Overlay" -> "Add Spotlight"). `new-user-flow.spec.js` and `regression-tests.spec.js`
  (~20 sites) still select the old labels.
- **Auto-advance:** framing export now auto-navigates into Overlay (T3720). Specs that expect the
  user to manually open the draft in Overlay are stale.
- **Collections / My Reels:** the Season Highlights & Collections epic reshaped My Reels (Top Plays,
  smart per-tag collections, ranking game, collection share links). Any specs touching the gallery /
  My Reels need re-checking.

Treat this as "audit and redo the E2E suite," not just the onboarding spec.

## Solution

Sweep the full E2E suite (`src/frontend/e2e/*.spec.js`), reconcile each spec with the shipped
product, and rewrite/remove as needed. The onboarding rewrite below is the largest single piece.

### Onboarding rewrite (new 3-quest flow)
- Q1 Get Started: upload_game, annotate_brilliant, playback_annotations
- Q2 Frame Your Highlight: open_framing, position_crop (`crop_adjusted`), add_slowmo
  (`speed_segment_created`, speed < 1x only), export_framing, wait_for_export
- Q3 Spotlight Your Player: open_overlay (`opened_overlay_editor`), select_players
  (`overlay_players_assigned`), choose_color (`overlay_color_set`), choose_shape
  (`overlay_shape_set`), export_overlay, view_gallery_video — claiming Q3 fires the Vamos modal.

Button-label selectors update across all specs: "Frame Video" -> "Export Highlight",
"Add Overlay" -> "Add Spotlight".

## Context

### Relevant Files (REQUIRED)
- `src/frontend/e2e/*.spec.js` — full suite audit; reconcile every spec with shipped behavior
- `src/frontend/e2e/new-user-flow.spec.js` — full rewrite to the 3-quest flow + new step IDs + labels
- `src/frontend/e2e/regression-tests.spec.js` — update old button-label selectors (~20 sites)
- `src/frontend/src/config/questDefinitions.jsx` — source of truth for new step copy/labels
- `src/backend/app/quest_config.py` — source of truth for new step IDs/order

### Related Tasks
- Parent: T3700 (Framing/Overlay Clarity) — the restructure these tests must follow
- T3720 (Auto-Advance Framing -> Overlay) — shipped; specs must expect auto-navigation
- Season Highlights & Collections epic — reshaped My Reels; gallery specs need re-checking

### Technical Notes
- The new event steps (`crop_adjusted`, `speed_segment_created`, overlay_*) are achievement-driven;
  the E2E must perform the real gesture (drag crop, set a <1x segment, pick color/shape, assign all
  players) to fire them, not just click export.
- `add_slowmo` requires a genuinely slowed segment (split + speed < 1x); a bare split won't complete it.
- `overlay_players_assigned` requires EVERY green-marked region to have a selection.

## Implementation

### Steps
1. [ ] Inventory every spec in `e2e/` and flag which are stale (flow, labels, auto-advance, collections).
2. [ ] Rewrite `new-user-flow.spec.js` to the 3-quest structure with new step IDs and gestures.
3. [ ] Swap button-text selectors to "Export Highlight" / "Add Spotlight" across all specs.
4. [ ] Fix gallery / My Reels specs for the Collections + ranking changes.
5. [ ] Run the full suite against a fresh user; confirm green.

## Acceptance Criteria

- [ ] Full E2E suite runs green against the shipped product.
- [ ] `new-user-flow.spec.js` drives all 3 quests / 14 steps and passes for a fresh user.
- [ ] No stale "Frame Video" / "Add Overlay" selectors remain anywhere in `e2e/`.
- [ ] Achievement-based steps complete via real gestures (not export-only shortcuts).
- [ ] Gallery / My Reels specs reflect the Collections + ranking-game changes.
