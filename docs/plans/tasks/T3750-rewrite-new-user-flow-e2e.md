# T3750: Rewrite new-user-flow E2E for the 4-Quest Structure

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

The T3700 quest split restructured onboarding into 3 quests with new step IDs and new per-step
event triggers (the old repeat-everything quest_4 was dropped; the Vamos completion modal now
fires after quest_3). `e2e/new-user-flow.spec.js` still drives the OLD flow: it walks the old quest_2
"Export Highlights" (framing+overlay bundled), asserts on old step IDs, and selects the renamed
terminal buttons by their old labels ("Frame Video", "Add Overlay"). It is now stale on two
axes — button labels AND quest flow — so it no longer validates onboarding.

`e2e/regression-tests.spec.js` also references the old button labels in many places.

## Solution

Rewrite the onboarding E2E to the new 3-quest flow:
- Q1 Get Started: upload_game, annotate_brilliant, playback_annotations
- Q2 Frame Your Highlight: open_framing, position_crop (`crop_adjusted`), add_slowmo
  (`speed_segment_created`, speed < 1x only), export_framing, wait_for_export
- Q3 Spotlight Your Player: open_overlay (`opened_overlay_editor`), select_players
  (`overlay_players_assigned`), choose_color (`overlay_color_set`), choose_shape
  (`overlay_shape_set`), export_overlay, view_gallery_video — claiming Q3 fires the Vamos modal.

Button-label selectors update: "Frame Video" -> "Export Highlight", "Add Overlay" -> "Add Spotlight".

## Context

### Relevant Files (REQUIRED)
- `src/frontend/e2e/new-user-flow.spec.js` — full rewrite to the 3-quest flow + new step IDs + new labels
- `src/frontend/e2e/regression-tests.spec.js` — update `button:has-text("Frame Video")` /
  `button:has-text("Add Overlay")` selectors (~20 sites) to the new labels
- `src/frontend/src/config/questDefinitions.jsx` — source of truth for new step copy/labels
- `src/backend/app/quest_config.py` — source of truth for new step IDs/order

### Related Tasks
- Parent: T3700 (Framing/Overlay Clarity) — the restructure these tests must follow
- **Coordinate: T3660 (Quest 4 Rework / Season Highlights)** — also edits the new-user-flow quest-4
  segment. Whichever lands second rebases onto the other. See T3700's Tutorial & Onboarding Impact.

### Technical Notes
- The new event steps (`crop_adjusted`, `speed_segment_created`, overlay_*) are achievement-driven;
  the E2E must perform the real gesture (drag crop, set a <1x segment, pick color/shape, assign all
  players) to fire them, not just click export.
- `add_slowmo` requires a genuinely slowed segment (split + speed < 1x); a bare split won't complete it.
- `overlay_players_assigned` requires EVERY green-marked region to have a selection.

## Implementation

### Steps
1. [ ] Map the new step IDs and `waitForQuestStep` calls to the 3-quest structure.
2. [ ] Drive the new gestures so each achievement-based step fires.
3. [ ] Swap button-text selectors to "Export Highlight" / "Add Spotlight" in both specs.
4. [ ] Run against a fresh user; confirm all 14 steps complete and the final "Vamos!" modal fires on quest_3.

## Acceptance Criteria

- [ ] `new-user-flow.spec.js` drives all 3 quests / 14 steps and passes for a fresh user.
- [ ] No stale "Frame Video" / "Add Overlay" selectors remain in either spec.
- [ ] Achievement-based steps complete via real gestures (not export-only shortcuts).
- [ ] Coordinated with T3660 to avoid double-editing the onboarding segment.
