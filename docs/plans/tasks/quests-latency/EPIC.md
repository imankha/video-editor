# EPIC: Quests Latency

**Created:** 2026-06-18
**Status:** TODO
**Branch:** `feature/perf-quests-latency` (one branch for the whole epic)
**Tasks:** T1536 → T1537 (in order)

## Why this is an epic

The 2026-06-17 prod HAR (`Downloads/app.reelballers.com.har`) showed the quest
endpoints are the slowest non-video API calls in the framing/overlay loop and fire on
nearly every gesture (`GET /quests/progress` up to 699 ms, `POST
/quests/achievements/{key}` up to 636 ms — ~100% server `wait`). Two changes attack
this from different angles in the **same subsystem** (`quests.py` + the achievement
write path), so they ship together on one branch, in one conversation, with one
combined before/after measurement:

- **[T1536](T1536-quests-progress-endpoint-latency.md)** — make each quest call
  *cheaper* (collapse redundant `user.sqlite` opens; conditionally skip
  `profile.sqlite`).
- **[T1537](T1537-consolidate-achievement-posts.md)** — make each gesture fire *fewer*
  quest calls (derive the achievement server-side from the action; drop the separate
  per-gesture `/achievements` POST).

They **compound** (fewer calls × cheaper calls), and the only honest "after" number is
measured with both in place — hence one epic rather than two independent tasks.

This epic is the quests half of the wider perf batch; the video/page-load half (T3760,
T3770) is independent and ships on a separate branch. See the cross-branch plan in
[perf-batch-har-2026-06-17.md](../perf-batch-har-2026-06-17.md).

## Sequencing (strict)

1. **T1536 first (Phase A).** Attribution-first: capture the `[PROFILE]` baseline, land
   the `user.sqlite` merge, commit. No design-approval gate. Report the numbers before
   Phase B.
2. **T1537 second (Phase B).** Stage-2 — requires design approval before coding. Builds
   on T1536's tested connection change with profiling numbers in hand.

## Shared design decisions (reference these; don't duplicate in task files)

- **No persistence-model change.** Both tasks are gesture-driven; the fire-and-forget
  model (T1531) stays. T1537's server-derived achievement write still traces to the edit
  gesture (it rides the action POST), satisfying the "every write traces to a gesture"
  rule. See [[feedback_no_fallbacks_correct_data]].
- **The ~200 ms R2/session floor is out of scope** ([[project_t1590_not_worth_risk]]).
  Only the ~400–500 ms above baseline is targeted.
- **Leverage existing systems** ([[feedback_leverage_existing_systems]]): T1537 reuses
  the achievement helper + `ACHIEVEMENT_TO_MILESTONE` map rather than building a parallel
  path.

## Key code-level findings (verified 2026-06-18)

These are load-bearing and easy to get wrong. Full detail in the task files and in the
[coordination doc](../perf-batch-har-2026-06-17.md#key-code-level-findings-from-the-2026-06-18-code-read):

- **Finding A (T1536):** add `get_completed_and_claimed_quest_ids(user_id)` to
  `user_db.py` — one connection, two SELECTs (`completed_quests` +
  `credit_transactions`), replacing the two separate `user.sqlite` opens in
  `get_progress`.
- **Finding B (T1537) ⚠️:** `questStore.recordAchievement` also triggers
  `fetchProgress({force:true})` on success — that's what visibly ticks the quest step
  off. Deleting the four gesture calls without a replacement leaves the panel
  un-refreshed. T1537 must add a dedup-gated `refreshProgressForGesture(key)` helper
  (no POST, one refresh per key per session).
- **Finding C (T1537):** `record_achievement_internal(conn, key)` reuses the open
  `profile.sqlite` connection in **both** `framing_action` and `overlay_action` — no
  extra DB open in either mode.

## Measurement & merit gate (whole epic)

Every change proves its merit with a before/after number, captured the most direct way —
a deterministic counter test first, backed by one real-world timing capture. See each
task's "Measurement & merit gate" section and the batch-wide policy in the
[coordination doc](../perf-batch-har-2026-06-17.md#measurement-discipline--merit-gate).

- **T1536:** `user.sqlite` opens per `/progress`: **2 → 1** (deterministic connection-count
  test), confirmed by `[PROFILE]` lines. Step 3 (skip `profile.sqlite`) ships **only** if
  profiling proves it moves the number.
- **T1537:** POSTs per gesture **2 → 1** (frontend mock) + **0 extra DB opens** (backend
  spy), confirmed by a HAR/Playwright request count.

## Completion criteria

- [ ] T1536 + T1537 both implemented on `feature/perf-quests-latency`.
- [ ] Deterministic merit tests committed for each (connection count; request count).
- [ ] Combined before/after captured **once with both changes in place** and recorded.
- [ ] No persistence-model change; quest panel still refreshes after gestures.
- [ ] Backend + frontend tests pass.

> AI does NOT change task statuses — the user promotes T1536/T1537 on the board.
