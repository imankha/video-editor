# T6840: Publish Your Reel quest: add a "Watch Preview" step before "Move to My Reels"

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

Quest 4 ("Publish Your Reel") jumps straight from the render-wait step to "Move to My Reels".
Previewing the finished draft is currently only a sentence folded into the move step's
description ("Press play on the Reel Draft to preview... Happy with it? Click Move to My
Reels"), not a tracked step of its own. New users can publish without ever watching what they
made, and the quest checklist doesn't reflect the real intended flow
(preview -> then publish).

## Solution

Add a `preview_draft` step to quest_4, ordered between `wait_for_overlay`'s completion and
`move_to_my_reels`:

- **Step definition (both sides, kept in sync):**
  - `src/frontend/src/data/questDefinitions.js` — insert `'preview_draft'` into quest_4
    `step_ids` before `'move_to_my_reels'`
  - `src/backend/app/quest_config.py` — same insertion (comments in both files already flag
    the sync requirement)
- **Copy:** in `src/frontend/src/config/questDefinitions.jsx`, add STEP_TITLES entry
  (e.g. "Watch Your Preview") and move the "Press play on the DoneBadge Reel Draft to
  preview..." sentence OUT of `move_to_my_reels`'s description into the new step's
  description; `move_to_my_reels` copy shrinks to the publish gesture + the
  redo-framing/overlay caveat.
- **Completion signal:** record a new achievement (e.g. `previewed_draft_reel_1s`) from the
  DraftTile preview player, mirroring the existing `watched_gallery_video_1s` pattern
  (`DownloadsPanel.jsx:473` records after ~1s of playback). The gesture site is DraftTile's
  preview (`setIsPreviewing(true)` -> `MediaPlayer`, `DraftTile.jsx:581,763`). Achievement
  recording goes through the existing `useQuestStore.recordAchievement` path — same as
  `moved_to_my_reels` (`DraftTile.jsx:161`).
- **Backend step check:** `src/backend/app/routers/quests.py` `_check_all_steps` — add
  `steps["preview_draft"] = 'previewed_draft_reel_1s' in achieved OR
  'moved_to_my_reels' in achieved`. The OR is the migration story: users who already
  published (or already finished quest_4) must not see their completed quest reopen with a
  new unchecked step. No DB migration needed — steps are computed from the achieved set at
  read time.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/data/questDefinitions.js` — quest_4 step_ids
- `src/frontend/src/config/questDefinitions.jsx` — STEP_TITLES + STEP_DESCRIPTIONS (split the
  existing move_to_my_reels copy)
- `src/frontend/src/components/DraftTile.jsx` — preview gesture; record the new achievement
  from the preview MediaPlayer (~1s playback), pattern at `DownloadsPanel.jsx:473`
- `src/backend/app/quest_config.py` — quest_4 step list (sync with frontend)
- `src/backend/app/routers/quests.py` — `_check_all_steps` mapping (~line 230)
- Tests referencing quest_4's step list, update alongside:
  `src/backend/tests/test_overlay_quest_move.py` (asserts the exact quest_4 step list),
  `src/backend/tests/test_performance.py` (asserts quest_4 steps), frontend
  `questDefinitions.test.jsx`

### Related Tasks
- T5170 — moved render steps into quest_3; precedent for reshaping quest step lists in sync
  across quest_config.py and questDefinitions.js
- T5140 (tutorial reshoot) — quest_4's tutorial narrates this flow; if the reshoot happens
  after this lands, the publish tutorial should mention the preview step (drift note for the
  T5140 talk track)

### Technical Notes
- Achievement grain: fire once after ~1 second of preview playback (not on open), matching
  `watched_gallery_video_1s` semantics, so scrubbing past instantly doesn't count.
- The backward-compat OR (`moved_to_my_reels` implies preview) means the step can never
  block a user who already published — quest reward totals for already-completed users are
  unaffected.
- Frontend/backend quest lists MUST stay identical — there is an existing backend test
  asserting quest_4's exact step list; update it deliberately, not mechanically.

## Implementation

### Steps
1. [ ] Insert `preview_draft` in both step lists (js + py)
2. [ ] Titles/descriptions: new step copy, trim move_to_my_reels copy
3. [ ] Record `previewed_draft_reel_1s` from DraftTile preview playback (~1s)
4. [ ] Backend `_check_all_steps` mapping with `moved_to_my_reels` backward-compat OR
5. [ ] Update quest_4 step-list tests (backend x2, frontend) + add coverage for the new
       achievement mapping
6. [ ] Lint + relevant test set green

### Progress Log

**2026-08-11**: Task filed under Deploy Candidate milestone.

## Acceptance Criteria

- [ ] Quest 4 shows "Watch Your Preview" between the render-wait step and Move to My Reels
- [ ] Playing a finished draft's preview for ~1s completes the step
- [ ] Publishing without previewing still completes the step (compat OR) — the quest can
      never deadlock a user who already moved the reel
- [ ] Existing users with quest_4 already complete stay complete
- [ ] Frontend and backend step lists identical; tests pass
