# T5170: Move "Add the Spotlight" + "Render the Spotlight" into the Overlay Quest

**Status:** TODO
**Priority:** P2
**Impact:** 6 | **Complexity:** 4
**Reported:** NUF feedback 2026-07-15 (Item 3 of 3)

## Problem

The overlay work is split across two quests in a way that feels wrong to the user. Quest 3
"Configure Your Spotlight" ends at `choose_shape`, while the two steps that actually produce
the spotlight — `export_overlay` ("Add the Spotlight") and `wait_for_overlay` ("Render the
Spotlight") — live at the START of Quest 4 "Publish Your Reel"
([quest_config.py:40-63](../../../src/backend/app/quest_config.py#L40-L63)).

Feedback: those two render steps belong in the Overlay quest, so Quest 3 covers configuring
AND rendering the spotlight, and Quest 4 is purely about publishing.

## Decision (from user)

**Move the two steps only. Keep rewards and titles unchanged** (Quest 3 = 25, Quest 4 = 15;
titles as-is). Reward rebalancing / retitling was explicitly declined for now.

## Target Structure

```
quest_3 "Configure Your Spotlight" (reward 25):
  watch_overlay_tutorial, open_overlay, select_players, choose_color, choose_shape,
  export_overlay, wait_for_overlay          <-- moved in (appended after choose_shape)

quest_4 "Publish Your Reel" (reward 15):
  watch_publish_tutorial, move_to_my_reels, view_gallery_video   <-- render steps removed
```

Order within quest_3: append `export_overlay` then `wait_for_overlay` AFTER `choose_shape`
(configure the spotlight, then render it). This preserves the "job starts / job completes"
pairing that mirrors framing's `export_framing`/`wait_for_export`.

## Implementation

1. [quest_config.py](../../../src/backend/app/quest_config.py) — move `export_overlay` and
   `wait_for_overlay` from `quest_4.step_ids` to the end of `quest_3.step_ids`.
2. [data/questDefinitions.js](../../../src/frontend/src/data/questDefinitions.js) — mirror the
   same move (keep identical to backend).
3. Step triggers are UNCHANGED — they are derived from the `export_jobs` overlay aggregate
   in `_check_all_steps` ([quests.py:187-188](../../../src/backend/app/routers/quests.py#L187-L188)),
   which is keyed by step id, not by quest. Moving the ids between quests needs NO trigger edit.
4. Titles/descriptions in [config/questDefinitions.jsx](../../../src/frontend/src/config/questDefinitions.jsx)
   (`STEP_TITLES` / `STEP_DESCRIPTIONS`) are keyed by step id — they move with the steps
   automatically, no text change required. (Optional: sanity-check that the `move_to_my_reels`
   copy still reads well as Quest 4's first content step.)
5. `TUTORIAL_STEP_QUEST` and the `watch_*` steps are unaffected (render steps have no tutorial
   button).

## Migration

**Likely not required — analyze and confirm.** The quest system self-heals:
- Quests are claimed sequentially; by the time a user has done any overlay export they have
  already claimed quest_3. Once a quest's reward is claimed, the progress endpoint renders ALL
  its steps `True` regardless of definition
  ([quests.py:261](../../../src/backend/app/routers/quests.py#L261)). So users past quest_3 keep
  it complete, and quest_4 shrinking is harmless.
- Users still IN quest_3 will now correctly need to render the spotlight before claiming it.

  **One edge to check:** a user who had completed old quest_3's four steps but had NOT yet
  clicked Claim would see quest_3 flip back to incomplete (missing the two render steps) until
  they render. Decide if that small in-flight population warrants an idempotent reconciliation
  (e.g. auto-complete/claim quest_3 for anyone who already satisfied its old step set). Follow
  the [v005_quest_restructure.py](../../../src/backend/app/migrations/user_db/v005_quest_restructure.py)
  precedent if a migration is warranted; otherwise document why self-heal is sufficient.

## Interaction with T5140

Tutorial videos are being reshot in **T5140**. When reshooting, the Overlay tutorial (quest_3)
should now demonstrate configure → **add spotlight → render**, and the Publish tutorial
(quest_4) should start at "Move to My Reels". No code dependency, but note the new step
boundaries in T5140.

## Tests

Backend: extend the quest-structure tests — assert quest_3 now contains `export_overlay` +
`wait_for_overlay` (7 steps) and quest_4 does not (3 steps), triggers still fire from
`export_jobs`, and a previously-claimed quest_3/quest_4 renders correctly (no un-claim, no
double-grant). If a reconciliation migration is added, cover it in
[test_quest_migration.py](../../../src/backend/tests/test_quest_migration.py).

## Classification hint

M/L-tier, backend + frontend (3 definition files in sync). Migration agent: **conditional** —
include only if the in-flight edge above is deemed worth reconciling. Reviewer: Yes.
Coordinate file ownership with **T5150** (both edit `quest_config.py` +
`config/questDefinitions.jsx` + `data/questDefinitions.js`) — sequence, don't parallelize.
