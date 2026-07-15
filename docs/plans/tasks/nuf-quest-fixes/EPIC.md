# Epic: NUF Quest Flow Fixes

Three reported new-user-flow (NUF) quest issues from a single feedback email (2026-07-15). Grouped
because they all edit the same quest system, and two of them touch the same files.

## Background — the quest system (shared context)

- **Structure SSOT:** `src/backend/app/quest_config.py` (`QUEST_DEFINITIONS` — ids, `step_ids`,
  rewards). Mirrored in `src/frontend/src/data/questDefinitions.js` (structure) and titles/rich
  descriptions in `src/frontend/src/config/questDefinitions.jsx`. **All three must stay in sync.**
- **Step triggers:** each step completes via a hard trigger in `quests.py` `_check_all_steps` — a
  derived DB condition or a recorded achievement (T3700 design; no optional/skippable steps).
- **Self-heal:** the progress endpoint renders ALL steps `True` for any quest whose reward is
  already claimed (`quests.py:261`). This is why most of these fixes need **no migration**.
- **Persistence is gesture-based:** achievements fire from gesture handlers, never reactive
  effects (project-wide rule).

## The three fixes

1. **[T5150](T5150-split-annotate-step-star-wrap.md) — Split the annotate step + fix star wrap.**
   Quest 1's last step wraps the 5 rating stars (reads as 1+4) and bundles trim+rate+tag+toggles+
   save into one step. Fix the wrap (`whitespace-nowrap`) and split into a new measurable
   `rate_clip` step (achievement `clip_rated`, self-heal backfill) + the existing `annotate_brilliant`
   (retitled "Save Your Reel"). No migration.
2. **[T5160](T5160-framing-wait-copy-on-task.md) — Keep first-run users on-task during the export
   wait.** Quest 2's `wait_for_export` copy tells the user to "frame another reel" — wrong for a
   first-run user with one clip. Global copy reword anchoring to this reel + the next step. Pure
   frontend string.
3. **[T5170](T5170-move-render-steps-to-overlay-quest.md) — Move Add/Render Spotlight into the
   overlay quest.** `export_overlay` + `wait_for_overlay` move from quest_4 (Publish) to the end of
   quest_3 (Configure Your Spotlight). Rewards/titles unchanged. Triggers/titles are keyed by step
   id → move automatically. Migration likely unnecessary (self-heal); one in-flight edge flagged.

## Sequencing & shared-file notes

- **T5150 and T5170 both edit `quest_config.py` + both frontend definition mirrors** → sequence
  them (or rebase); never run the two in parallel containers. **T5160 is an isolated copy edit**
  (safe anytime).
- Recommended order: **T5160** (trivial) → **T5150** → **T5170** (T5150 and T5170 ideally by one
  owner back-to-back since they share files).
- **Migrations:** none expected (T5150 backfill self-heals; T5170 sequential-claim + render-all-true
  self-heals). T5170 documents the single in-flight edge to analyze before deciding.
- **Ties to [T5140](../T5140-reshoot-tutorial-videos.md)** (tutorial reshoot, Polish): T5170 changes
  the overlay/publish step boundaries, so the reshoot must film the final structure — already
  cross-referenced from T5140.

## Completion criteria

- [ ] Quest 1 rating stars never wrap; annotate step split into `rate_clip` + `annotate_brilliant`
      (both measurable), pre-existing users unaffected.
- [ ] Quest 2 export-wait copy keeps first-run users on-task (no "frame another reel").
- [ ] `export_overlay` + `wait_for_overlay` live in quest_3; quest_4 is publish-only; no un-claim /
      double-grant for existing users.
- [ ] All three definition sources (quest_config.py + 2 frontend mirrors) in sync; tests updated;
      no migration needed (or the one T5170 edge reconciled).
