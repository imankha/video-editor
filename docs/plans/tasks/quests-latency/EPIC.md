# EPIC: Quests Latency

**Created:** 2026-06-18
**Status:** PARTIAL — T1536 landed (correctness cleanup); T1537 BLOCKED/deferred.
**Branch:** `feature/perf-quests-latency` (one branch for the whole epic)
**Tasks:** T1536 (done) → T1537 (deferred to the single-machine / session-affinity epic)

> 🚧 **Epic outcome 2026-06-18.** Attribution corrected the premise: `/progress` had no
> recoverable above-baseline server cost (T1536 is a correctness/DRY cleanup, not a latency
> win), and the real hotspot — the achievement POST's synchronous `record_milestone` — can
> only be fixed by making analytics **fire-and-forget**, a persistence-model change the
> project is deferring until sessions are pinned to a single machine. So **T1537 is parked**
> for that future epic and the combined before/after measurement won't happen here. T1536
> stands alone.

## Why this is an epic

> ⚠️ **HAR re-attribution 2026-06-18 (during T1536 implementation).** A per-endpoint read
> of the HAR corrected the framing below:
> - `GET /quests/progress` **server `wait`** is ~200–386 ms (≈ baseline + noise). The
>   "699 ms" was **312 ms client `blocked` (HTTP/2 queueing) + 386 ms server `wait`**, not
>   699 ms of server work. T1536's `user.sqlite` merge is a **correctness/DRY cleanup, not
>   a latency win** — there was no above-baseline server cost on `/progress` to recover.
> - `POST /quests/achievements/{key}` **server `wait` ≈ 608–612 ms** (~400 ms above
>   baseline) — this is the **real** quests-loop hotspot and **T1537's** measured target.
> - The client `blocked` queueing came from firing several quest calls back-to-back →
>   reducing request count (T1537) attacks it directly.
>
> Net: the epic's latency value lives in **T1537** (cheaper + fewer achievement writes);
> T1536 stays as a low-risk structural cleanup that de-duplicates the double-open and
> gives T1537 a clean single-connection base.

The 2026-06-17 prod HAR (`Downloads/app.reelballers.com.har`) showed the quest
endpoints are the slowest non-video API calls in the framing/overlay loop and fire on
nearly every gesture (`GET /quests/progress` up to 699 ms total, `POST
/quests/achievements/{key}` ~636 ms total). Two changes attack
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
  test). **Merit = correctness, not latency** (HAR re-attribution showed no above-baseline
  server cost on `/progress`). Step 3 (skip `profile.sqlite`) **dropped** — profiling did
  not show it moving the number.
- **T1537:** POSTs per gesture **2 → 1** (frontend mock) + **0 extra DB opens** (backend
  spy), confirmed by a HAR/Playwright request count.

## Completion criteria

- [ ] T1536 + T1537 both implemented on `feature/perf-quests-latency`.
- [ ] Deterministic merit tests committed for each (connection count; request count).
- [ ] Combined before/after captured **once with both changes in place** and recorded.
- [ ] No persistence-model change; quest panel still refreshes after gestures.
- [ ] Backend + frontend tests pass.

> AI does NOT change task statuses — the user promotes T1536/T1537 on the board.
