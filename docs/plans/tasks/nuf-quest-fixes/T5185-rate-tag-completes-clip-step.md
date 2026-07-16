# T5185: "Rate & Tag the Play" Completes on Rated AND Tagged (Not at Save)

**Status:** DONE
**Priority:** P2
**Impact:** 6 | **Complexity:** 2
**Reported:** User direction 2026-07-15 (follow-up to T5150)

## Problem

T5150's `rate_clip` step ("Rate & Tag the Play") fired its `clip_rated` achievement on the
rating gesture alone, and in practice the step read as completing at save. The step names two
actions — rate AND tag — and should be marked complete the moment the clip has both, without
waiting for save.

## Decision (from user)

Complete `rate_clip` once the clip is **rated (>=1 star) AND tagged (>=1 tag)**, reflected in
the quest panel immediately (not at save).

## Implementation

- [ClipDetailsEditor.jsx](../../../src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx):
  `maybeRecordRatedAndTagged(rating, tags)` fires `recordAchievement('clip_rated')` only when
  both are present; called from `handleRatingChange` (with the new rating + current tags) and
  `handleTagToggle` (with the current rating + new tags) — whichever gesture completes the pair
  fires. `recordAchievement` is session-deduped + fire-and-forget, safe from both handlers.
- **Prompt reflection is free:** `questStore.recordAchievement` already calls
  `fetchProgress({ force: true })` on a successful POST, so the panel updates at the gesture.
- [quests.py](../../../src/backend/app/routers/quests.py): trigger unchanged
  (`'clip_rated' in achieved or rc["reels"] >= 1`); comment updated to document the new firing
  semantics. The reel backfill keeps pre-existing users complete.

## Migration

None. The achievement key is unchanged; users who recorded `clip_rated` under the old
rating-only firing keep the step complete (acceptable — they rated), and the reel backfill +
claimed-quest self-heal cover everyone else.

## Tests

`test_rate_clip_step.py` (unchanged, still green): achievement path, reel backfill,
annotate_brilliant independence, claimed-quest self-heal. The rated-AND-tagged gating is
frontend firing logic in `ClipDetailsEditor` (covered by the definitions/unit suites + manual
NUF pass on the consolidated branch).
