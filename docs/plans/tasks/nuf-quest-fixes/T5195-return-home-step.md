# T5195: Add "Return Home" as Quest 2's First Step (Before the Framing Tutorial)

**Status:** DONE
**Priority:** P2
**Impact:** 6 | **Complexity:** 3
**Reported:** User direction 2026-07-15

## Problem

After saving their first reel at the end of quest_1 (Annotate), a first-run user must return to
the home (games) screen to pick that reel and start framing — but quest_2 ("Frame Your
Highlight") jumped straight to `watch_framing_tutorial` with no step guiding them home.

## Decision (from user)

Insert a new `return_home` step **before** `watch_framing_tutorial` in quest_2.

## Implementation

New quest_2 `step_ids`:
`return_home, watch_framing_tutorial, open_framing, position_crop, add_slowmo, export_framing, wait_for_export`
(reward unchanged at 25 — rewards are per-quest).

- [quest_config.py](../../../src/backend/app/quest_config.py) + [data/questDefinitions.js](../../../src/frontend/src/data/questDefinitions.js):
  `return_home` inserted first (both mirrors in sync).
- [config/questDefinitions.jsx](../../../src/frontend/src/config/questDefinitions.jsx):
  `STEP_TITLES.return_home` = "Head Back Home"; description reuses the `<OpenReelLink />` pill.
- [quests.py](../../../src/backend/app/routers/quests.py): `returned_home` added to BOTH
  `KNOWN_ACHIEVEMENT_KEYS` and `_STEP_ACHIEVEMENT_KEYS` (T5150 lesson — POST validates against
  KNOWN). Trigger: `steps["return_home"] = 'returned_home' in achieved or framing_total >= 1`
  (backfill: a user who has begun framing was necessarily home first — add_clip's pattern).
- [App.jsx](../../../src/frontend/src/App.jsx): fires `recordAchievement('returned_home')` on
  entering `EDITOR_MODES.PROJECT_MANAGER` (the home screen), **gated on quest_1's
  `annotate_brilliant` being complete** — home is also the app's default landing screen, so an
  ungated fire would pre-complete the step on a brand-new user's very first load, before quest 1
  even starts. Same mode-entry pattern as T540 (`opened_framing_editor`) / T3700.

## Migration

None. Claimed quest_2 renders all steps True (self-heal); active framers backfill via
`framing_total >= 1`; only a never-framed mid-quest_2 user sees the new (correct) step.

## Tests

[test_return_home_step.py](../../../src/backend/tests/test_return_home_step.py): quest_2
structure (7 steps, return_home first), key registration, achievement trigger, framing
backfill, claimed-quest self-heal. [test_tutorial_quest_steps.py](../../../src/backend/tests/test_tutorial_quest_steps.py)
updated: the "tutorial is first" invariant became "tutorial at expected index" (index 1 for
quest_2, index 0 elsewhere).

## Interaction with T5140

The framing tutorial (quest_2) is no longer the quest's first step; the T5140 reshoot should
assume the user arrives at it FROM the home screen with their reel already saved.
