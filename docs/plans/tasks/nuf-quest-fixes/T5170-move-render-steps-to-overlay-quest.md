# T5170 — Move the spotlight-render steps into the overlay quest

Status: STAGING (implemented on `feature/T5150-nuf-quest-fixes`, commit 3 of 3)

## What changed

`export_overlay` and `wait_for_overlay` moved from `quest_4` (Publish Your Reel)
to the **end** of `quest_3` (Configure Your Spotlight), appended after
`choose_shape`. Rewards and titles are unchanged (quest_3 = 25, quest_4 = 15).

Rationale: the user adds AND renders the spotlight in one sitting, so the render
steps belong with configuring the spotlight, not with publishing. Publish
(quest_4) is now purely tutorial -> move-to-my-reels -> watch.

SSOT sources kept in sync (all three):
- `src/backend/app/quest_config.py` — `QUEST_DEFINITIONS` (structure SSOT)
- `src/frontend/src/data/questDefinitions.js` — structure mirror
- `src/frontend/src/config/questDefinitions.jsx` — titles/descriptions are keyed
  by step id, so they move automatically; **no copy change** was needed.

Triggers are UNCHANGED: `_check_all_steps` derives `export_overlay` /
`wait_for_overlay` from the `export_jobs` overlay aggregate, keyed by **step id**
(not by quest), so the triggers keep firing after the move.

## Migration-edge analysis (ANALYZE + DECIDE) — DECISION: self-heal, NO migration

No quest id or reward changes; `completed_quests` keys on `quest_id`. Populations:

1. **Fresh users** — get the new structure from `/api/quests/definitions`. No issue.
2. **Users who claimed old quest_3 (5-step Configure)** — the progress endpoint's
   self-heal (`quests.py`: any quest in the user-scoped completed set renders ALL
   of its *current* `step_ids` True) renders the new 7-step quest_3 fully complete.
   No un-claim, no re-derive. Covered by `test_claimed_quest_3_renders_all_seven_steps`.
3. **Users who claimed old quest_4 (5-step Publish)** — removing steps can only make
   a quest *more* complete; self-heal renders the new 3-step quest_4 True. No
   double-grant (idempotent via the completed set + the UNIQUE credit index).
   Covered by `test_claimed_quest_4_renders_all_three_steps` and
   `test_claim_already_claimed_quest_3_no_double_grant`.
4. **In-flight sliver** — a user who finished old quest_3's 5 steps but had NOT
   clicked Claim AND had NOT yet rendered the overlay would see quest_3 flip from
   "complete, claim available" to incomplete until they render. This is:
   - **not a data loss** — they never claimed, so no credits are lost; the 25-credit
     reward is still available and pays out once they render;
   - **correct new behavior** — the new quest_3 genuinely includes rendering, and the
     next action the flow guides them to (old quest_4's "Add the Spotlight") completes
     both new steps in seconds;
   - **a tiny population** — someone who configured the spotlight, saw the prominent
     pulsing Claim button, and walked away *without* claiming AND *without* rendering.

Direction check: moving steps OUT of quest_4 can only make it more complete (never
un-completes). Moving steps INTO quest_3 is the only un-completion vector, and only
for the unclaimed-not-rendered sliver above.

### Why no migration (contrast with v005/v006)

`v005_quest_restructure` / `v006_split_overlay_quest` marked a **new** quest complete
for users who did an **old bundled** flow — that pattern is needed when a quest is
SPLIT or CREATED and the derived steps cannot reconstruct completion. Here **no quest
is created or removed**; only steps move between two existing quests. A reconciliation
migration would either be a no-op (claimed users are already self-healed) or would
have to fabricate quest_3 completion for users who genuinely have not rendered —
masking real state, which the project's "Correct Data, Not Workarounds" rule forbids.

**Default per the kickoff was self-heal + no migration; the tests above surfaced no
gap, so no migration was added.** `test_quest_migration.py`'s existing v005/v006
coverage is unaffected (those key on `completed_quests`, not on step order).

## Tests

`src/backend/tests/test_overlay_quest_move.py` (7 tests, all green):
structure of quest_3 (7 steps, render steps last) and quest_4 (3 steps, no render
steps), no duplicate render steps across quests, triggers still fire from
`export_jobs`, and the three self-heal / no-double-grant migration-edge cases.

Frontend: `src/frontend/src/config/questDefinitions.test.jsx` guards the data-mirror
structure for quest_3/quest_4 and that the moved steps still resolve titles/descriptions.
