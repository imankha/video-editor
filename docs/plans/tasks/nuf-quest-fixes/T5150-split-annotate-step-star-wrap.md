# T5150: Split the Annotate Step + Fix Star-Rating Wrap (Quest 1)

**Status:** TODO
**Priority:** P2
**Impact:** 7 | **Complexity:** 5
**Reported:** NUF feedback 2026-07-15 (Item 1 of 3)

## Problem

Quest 1 "Get Started" ends with a single step `annotate_brilliant` ("Rate 5 Stars &
Save"). Two issues reported:

1. **Star wrap.** The description renders five inline `<FilledStar/>` that wrap across a
   line break in the narrow quest panel, so "★★★★★" reads as one star then four stars.
   ([questDefinitions.jsx:170](../../../src/frontend/src/config/questDefinitions.jsx#L170))
2. **Too much in one step.** `annotate_brilliant` bundles trim + rate + tag + note +
   confirm My Athlete/Create Reel toggles + Save into one task. The user wants it split
   further so the flow is legible and per-step drop-off is measurable.

## Decision (from user)

**Real split into measurable steps** (not a visual-only reformat). Break the one step into
two, each with its own hard completion trigger, consistent with the T3700 design (every
step completes via a derived DB condition or a recorded achievement).

## Target Design

Split `annotate_brilliant` into an ordered pair. Keep the existing `annotate_brilliant`
step id for the SAVE step (its trigger is unchanged), and insert a NEW `rate_clip` step
before it.

New Quest 1 `step_ids`:
```
watch_annotate_tutorial, upload_game, add_clip, rate_clip, annotate_brilliant, playback_annotations
```

| Step id | Title | Description (outcome-framed, T3700 rules) | Trigger |
|---------|-------|-------------------------------------------|---------|
| `rate_clip` (NEW) | "Rate & Tag the Play" | Trim to isolate the action, then rate it ★★★★★ (stars in a **non-wrapping** span) and tag it — a note helps too. | NEW achievement `clip_rated`, self-healing backfill (see below) |
| `annotate_brilliant` (retitled) | "Save Your Reel" | Make sure **My Athlete** and **Create Reel** are on, then **Save**. We'll build a reel you can edit and share. | `rc["reels"] >= 1` (UNCHANGED) |

## Implementation

### Backend

1. [quest_config.py](../../../src/backend/app/quest_config.py) — insert `rate_clip` into
   `quest_1.step_ids` between `add_clip` and `annotate_brilliant`. Reward for quest_1
   stays 15 (per-step, not per-count).
2. [quests.py](../../../src/backend/app/routers/quests.py):
   - Add `"clip_rated"` to `_STEP_ACHIEVEMENT_KEYS` (~line 83). It rides the existing
     batched `IN` query — no new DB query.
   - In `_check_all_steps`, add under Quest 1:
     ```python
     # rate_clip: completed when the user sets a star rating (achievement). Backfilled
     # by "a reel exists" so it auto-completes for anyone who already saved a reel
     # (you cannot save a reel without having rated). Mirrors the add_clip backfill.
     steps["rate_clip"] = 'clip_rated' in achieved or rc["reels"] >= 1
     ```
   - Leave `steps["annotate_brilliant"] = rc["reels"] >= 1` unchanged.

### Frontend

3. [data/questDefinitions.js](../../../src/frontend/src/data/questDefinitions.js) — mirror the
   `step_ids` change (this file is the store's local copy; keep it identical to the backend).
4. [config/questDefinitions.jsx](../../../src/frontend/src/config/questDefinitions.jsx):
   - Add `rate_clip` to `STEP_TITLES` ("Rate & Tag the Play") and `annotate_brilliant`
     retitled to "Save Your Reel".
   - Split `STEP_DESCRIPTIONS`. Move the trim/rate/tag/note copy to `rate_clip`; leave the
     toggle-confirm + Save copy on `annotate_brilliant`.
   - **Star-wrap fix:** wrap the five `<FilledStar/>` in a `whitespace-nowrap` span so the
     rating never breaks across lines. This is the fix for issue #1 and applies to whichever
     step keeps the stars (`rate_clip`).
5. Fire the new achievement on the **rating gesture** (not on save): in
   [ClipDetailsEditor.jsx:114](../../../src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx#L114)
   `handleRatingChange`, call `useQuestStore.getState().recordAchievement('clip_rated')`
   alongside `onUpdate({ rating })`. `recordAchievement` is fire-and-forget + session-deduped,
   so firing on every star click is safe.

## Migration

**Not required.** The `rate_clip` trigger self-heals via the `rc["reels"] >= 1` backfill
(same pattern that backfilled `add_clip`), and the progress endpoint already renders ALL
steps `True` for any quest whose reward is already claimed
([quests.py:261](../../../src/backend/app/routers/quests.py#L261)). So:
- A user who already saved a reel: `rate_clip` shows complete immediately.
- A user who already claimed quest_1: unaffected (all steps render complete).

No `completed_quests` rows change. Do NOT write a migration unless a test surfaces a gap.

## Tests

- Backend: extend [test_tutorial_quest_steps.py](../../../src/backend/tests/test_tutorial_quest_steps.py)
  / [test_quest_migration.py](../../../src/backend/tests/test_quest_migration.py) — assert
  quest_1 now has 6 steps, `rate_clip` completes on `clip_rated` achievement AND backfills
  when a reel exists, and a pre-existing claimed quest_1 still renders fully complete.
- Frontend: assert the star run is non-wrapping (single line container) and the two new
  step ids resolve titles/descriptions.

## Classification hint

L-tier (structural, backend + frontend, 3 definition files kept in sync). Architect gate
optional — the design here is concrete. Migration agent: **No** (see above). Reviewer: Yes.
Coordinate file ownership with **T5170** (both edit `quest_config.py` +
`config/questDefinitions.jsx` + `data/questDefinitions.js`) — do not run the two in parallel
containers; sequence them or rebase.
