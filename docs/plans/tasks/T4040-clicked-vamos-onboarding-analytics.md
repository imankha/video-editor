# T4040: Onboarding Completion Analytics ("clicked_vamos") + EXTRA_TRACKED_STEPS Primitive

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-06-26
**Updated:** 2026-06-26

## Problem

When a user finishes the onboarding quest flow, the final completion modal's "Vamos!" dismiss button fires **no analytics**. We can see users reach the last quest step but not whether they actually acknowledge completion and leave the flow primed — a blind spot at the most important funnel exit. There's also no way to surface a non-completion "did they click through?" step in the admin quest funnel without it counting toward quest completion.

## Solution

Two pieces, recovered from an abandoned WIP branch (`feature/T1000-dry-quest-definitions`) that was stashed and never landed. The original patch is preserved at [attachments/T4040-clicked-vamos-onboarding-analytics.patch](attachments/T4040-clicked-vamos-onboarding-analytics.patch) — **it will NOT apply cleanly** (the quest system was reworked in T3700; step IDs renamed, `QuestFunnelChart.jsx` was replaced by a different admin chart). Treat the patch as the reference design, re-implement against current code.

1. **`clicked_vamos` achievement** — wire `recordAchievement('clicked_vamos')` onto the onboarding completion modal's "Vamos!" dismiss button (`QuestPanel.jsx`). Add `clicked_vamos` to `KNOWN_ACHIEVEMENT_KEYS` and the step-check queries (`quests.py`, `quest_config.py`, `admin.py`).
2. **`EXTRA_TRACKED_STEPS` primitive** — a shared config concept for "steps tracked in the admin funnel but NOT counted toward quest completion." Backend exposes them in the funnel data; the admin per-step funnel chart renders them appended after their parent quest (with the color-band boundary math the original `QuestFunnelChart.jsx` had). Re-implement against today's admin analytics chart (`FunnelChart.jsx` or successor).

## Context

### Provenance
- Recovered from `stash@{2}` (WIP on `feature/T1000-dry-quest-definitions`), assessed 2026-06-26. T1000 itself is gone from PLAN.md and the quest system was reworked since (T3700), so this is a fresh re-implementation, not a revival of T1000.
- The other 4 stashes audited at the same time were dropped as already-merged / debug-only / superseded.

### Relevant Files (REQUIRED — verify against current code; patch context is stale)
- `src/frontend/src/components/QuestPanel.jsx` - "Vamos!" completion button -> `recordAchievement('clicked_vamos')`
- `src/backend/app/routers/quests.py` - `KNOWN_ACHIEVEMENT_KEYS` + achievement recording
- `src/backend/app/quest_config.py` - `EXTRA_TRACKED_STEPS` config + step definitions
- `src/backend/app/routers/admin.py` - funnel data: include extra tracked steps (`_check_all_steps` / `_compute_quest_progress`, now batched with `skip_quest_ids`)
- `src/frontend/src/components/admin/FunnelChart.jsx` *(successor to the patch's QuestFunnelChart.jsx)* - render extra steps after parent quest
- `src/frontend/src/config/questDefinitions.jsx` - step id mapping (renamed in T3700: current ids e.g. `view_gallery_video`, not the patch's `wait_for_reel`/`overlay_reel`/`watch_reel`)

### Related Tasks
- Supersedes the abandoned T1000; coordinates with T3700's reworked quest step ids.

### Technical Notes
- Patch won't cherry-pick: step ids renamed (T3700), `QuestFunnelChart.jsx` removed. Use the patch for the *shape* of `EXTRA_TRACKED_STEPS` and the funnel boundary-math, re-apply by hand.
- `EXTRA_TRACKED_STEPS` is the reusable primitive worth keeping even beyond `clicked_vamos` — any future "tracked but non-gating" funnel step uses it.
- Pure analytics/instrumentation; no schema change expected (achievements already persist). Confirm `recordAchievement` is gesture-fired (button click), not reactive.

## Implementation

### Steps
1. [ ] Add `clicked_vamos` to backend known achievement keys + step-check queries
2. [ ] Add `EXTRA_TRACKED_STEPS` config primitive (backend) + include in admin funnel data
3. [ ] Wire `recordAchievement('clicked_vamos')` on the "Vamos!" button (QuestPanel.jsx)
4. [ ] Render extra tracked steps in the current admin funnel chart (after parent quest, boundary-aware)
5. [ ] Tests: achievement recorded on button click; funnel data includes extra step without inflating completion count

## Acceptance Criteria

- [ ] Clicking "Vamos!" on the onboarding completion modal records a `clicked_vamos` achievement
- [ ] Admin quest funnel shows `clicked_vamos` as a tracked step that does NOT count toward quest completion
- [ ] `EXTRA_TRACKED_STEPS` is a reusable config (not a one-off hack for this step)
- [ ] Recording is gesture-fired, not reactive
- [ ] Tests pass
