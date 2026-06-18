# Perf Batch Coordination — HAR 2026-06-17 (T1536 / T1537 / T3760 / T3770)

**Created:** 2026-06-18
**Purpose:** Orchestration plan for the four performance tasks surfaced by the
2026-06-17 HAR captures. Defines branch layout, conversation grouping, ordering,
and the cross-task communication each conversation must carry. Ready-to-paste
kickoff prompts are at the bottom.

> This is a coordination doc, not a task. The four tasks remain independently
> promotable on the board. AI does NOT change task statuses.

---

## TL;DR

These are **not four independent tasks.** T1536 and T1537 live in the same
subsystem (`quests.py` + the achievement write path) and share the same
end-to-end measurement, so they run **together in one conversation on one
branch**. T3760 (video over-fetch) and T3770 (StrictMode verify) are genuinely
independent and run on a second branch.

| Branch | Conversation | Tasks | Stack |
|---|---|---|---|
| `feature/perf-quests-latency` | **C1** | T1536 **then** T1537 — the [Quests Latency epic](quests-latency/EPIC.md) (sequential, one conversation) | Backend + Frontend |
| `feature/perf-page-load` | **C2** | T3760 (spike → design approval → implement) | Frontend + Backend + CDN Worker |
| `feature/perf-page-load` | **C3** | T3770 (verify-first, likely no-op) | Frontend |

C2 and C3 share `feature/perf-page-load` because their files are disjoint
(T3760 = `FramingScreen` video path + `clips.py` L1625+ + Worker; T3770 =
`App.jsx` / `projectDataStore.js` / `main.jsx`). Run **C3 first** (it's a fast
verification that usually ends as a documented no-op), commit its verdict, then
run C2 on the same branch. If you'd rather not interleave, give T3770 its own
throwaway branch — it's trivial either way.

Two branches total. Three conversations.

---

## Why the grouping is what it is

### T1536 + T1537 → one conversation (C1)

Both modify `src/backend/app/routers/quests.py` and both are part of the *same
latency story*: T1536 makes each quest call cheaper (fewer DB opens), T1537 makes
the gesture fire fewer calls. They **compound**, and the only honest "after"
measurement is taken with both in place. Co-locating them:

- lets one implementor hold the whole quest-latency picture and re-measure once at
  the end (T1537 changes the request mix that T1536 is profiling);
- avoids two separate merge events on `quests.py`. (Function-level overlap is
  actually small — T1536 edits `get_progress`, T1537 edits `record_achievement` —
  but both touch the top-of-file constants region: T1537 adds an
  `ACTION_TO_ACHIEVEMENT` map next to the existing `ACHIEVEMENT_TO_MILESTONE`, and
  T1536 may add an import for a new `user_db` helper. Same conversation removes any
  conflict risk.)

**Order inside C1: T1536 first, then T1537.** T1536 is attribution-first — it
captures the `[PROFILE]` baseline for the quest endpoints before anything is
restructured, is small, and has no design-approval gate. T1537 is the larger
refactor *with* a Stage-2 approval gate; doing it second means it builds on
T1536's tested connection change with the profiling numbers already in hand.

### T3760 → its own conversation (C2)

A spike → decide → implement task that spans React, FastAPI, and possibly the
Cloudflare CDN Worker, and **requires user approval of a decision doc before any
fix is coded**. It needs its own focused context and shares nothing with the
quest work.

### T3770 → its own conversation (C3)

A ~0-LOC verification with a strong prior that it's dev-only React StrictMode
noise. Kept separate so it can't accidentally entangle a no-op verdict with real
code from another task.

---

## Cross-task communication (what each conversation must carry)

### Inside C1: T1536 → T1537 handoff (the one that matters)

After T1536 lands and is committed, carry these facts into the T1537 phase:

1. **Preserve T1536's single-connection change.** T1536 collapses the two
   `user.sqlite` opens in `get_progress` into one (see T1536 task file for the
   `get_completed_and_claimed_quest_ids` helper). When T1537 extracts
   `record_achievement_internal`, do not reintroduce a second DB open anywhere on
   these paths.
2. **Re-baseline after T1537.** T1537 removes the four per-gesture
   `/quests/achievements/*` POSTs, so the request mix changes. Re-capture the
   `[PROFILE]` lines and the per-gesture request count *after* T1537 — that's the
   true combined "after" for both tasks.

### C2 and C3: no inbound dependency

Neither needs anything from C1 or from each other. The only rule: **C2 and C3 stay
out of `quests.py`, `clips.py` `framing_action` (L319), and the four frontend
gesture handlers** — those belong to C1. C2 naturally lives at `clips.py` L1625+
and the `FramingScreen` video path; C3 lives in `App.jsx` / `projectDataStore.js`.

---

## Measurement discipline & merit gate (applies to every change)

> **Every change must prove its merit with a before/after number, or it doesn't
> ship.** Each of these tasks adds risk to a hot path; "it should be faster" is not
> acceptable. Measure the *exact quantity being optimized*, in the *most direct way
> available*, **before** the change and **after** it.

Rules for the whole batch:

1. **Prefer a deterministic counter test over a wall-clock timer.** The thing each
   task optimizes reduces to a *count* — DB opens, HTTP POSTs, requests per resource,
   bytes served. Counts are exact and CI-stable; wall times are noisy (R2 cold
   restore alone swings hundreds of ms). Write the count assertion as a committed
   test; it both proves the win and guards against regression.
2. **Back the count with one real-world timing capture.** A deterministic test
   proves the *mechanism* changed; a single before/after `[PROFILE]` line / HAR /
   Playwright time-to-first-frame proves it actually moved the user-visible number.
   Record both in the task's Progress Log.
3. **Merit gate — revert if it doesn't pay.** If the after-number is within noise of
   the before-number (no measurable improvement), **do not merge that change** —
   the added risk isn't justified. This is explicit for the *conditional* steps
   (T1536 Step 3; T3760 option choice; T3770 is a pure verify whose "no-op" verdict
   IS the merit decision).
4. **Capture before-numbers FIRST, on the unchanged code**, then implement, then
   re-capture with the identical method. Same machine, same flow, warm cache for the
   warm number / explicit cold for the cold number — don't compare a cold before to
   a warm after.

Per-task specifics are in each task's **"Measurement & merit gate"** section.

## Key code-level findings from the 2026-06-18 code read

These were verified against the current tree and are baked into the task files.
Two are *new* (not in the original kickoff prompts) and are easy to get wrong:

### Finding A (T1536) — the exact merge

`get_progress` ([quests.py:220](../../../src/backend/app/routers/quests.py#L220),
[L235](../../../src/backend/app/routers/quests.py#L235)) opens `user.sqlite`
twice: `get_completed_quest_ids(user_id)`
([user_db.py:630](../../../src/backend/app/services/user_db.py#L630), reads
`completed_quests`) and `_get_claimed_quest_ids(user_id)`
([quests.py:167](../../../src/backend/app/routers/quests.py#L167), reads
`credit_transactions WHERE source='quest_reward'`). Both go through
`get_user_db_connection`. **Fix:** add one helper in `user_db.py` (e.g.
`get_completed_and_claimed_quest_ids(user_id) -> tuple[set, set]`) that opens the
connection once and runs both `SELECT`s, and call it from `get_progress`. Delete
or thin `_get_claimed_quest_ids` accordingly.

### Finding B (T1537) — removing the frontend POST also removes a UI refresh ⚠️

`questStore.recordAchievement`
([questStore.js:130-154](../../../src/frontend/src/stores/questStore.js#L130))
does **two** things, session-dedup-gated by `_recordedAchievements`:
1. `POST /api/quests/achievements/{key}` (keepalive), and
2. **on success, `get().fetchProgress({ force: true })`** — which is what makes the
   quest panel visibly check the step off after the gesture.

If T1537 simply deletes the four `recordAchievement` calls, the achievement still
gets written (server-derived), **but the quest panel will not refresh until the
next natural progress fetch** — the step appears stuck until reload. T1537 must
add a small dedup-gated `questStore` helper (no POST, just one
`fetchProgress({ force: true })` per gesture-key per session) and call it from the
four handlers in place of `recordAchievement`. Preserve the existing
`_recordedAchievements` session-dedup so it only refreshes once per key.

### Finding C (T1537) — connection reuse confirmed for *both* handlers

The `achievements` table lives in `profile.sqlite`. `record_achievement` opens it
via `get_db_connection()`
([quests.py:337](../../../src/backend/app/routers/quests.py#L337)). Both action
handlers already hold an open `profile.sqlite` connection from the same
`get_db_connection()`:
- `framing_action` ([clips.py:346](../../../src/backend/app/routers/clips.py#L346))
- `overlay_action` ([overlay.py:285](../../../src/backend/app/routers/export/overlay.py#L285))

So `record_achievement_internal(conn, key)` reuses the handler's connection with no
extra open in **both** framing and overlay — write it before each handler's
existing `conn.commit()` (clips.py L523 `_save_clip_framing_data`; overlay.py L530).

---

## Ready-to-paste kickoff prompts

### Conversation 1 — `feature/perf-quests-latency` (T1536 → T1537)

```
We are running a 4-task perf batch across 2 branches / 3 conversations
(see docs/plans/tasks/perf-batch-har-2026-06-17.md). THIS conversation owns the
quests subsystem and does TWO tasks SEQUENTIALLY on ONE branch:
T1536 first, then T1537.

Branch: feature/perf-quests-latency  (create it before the first change)

Read first: CLAUDE.md (root), src/backend/CLAUDE.md, and the coordination doc
docs/plans/tasks/perf-batch-har-2026-06-17.md (Findings A/B/C + the "Measurement
discipline & merit gate" section are load-bearing).

MEASUREMENT RULE for every change: capture the before-number FIRST on master (write
the deterministic counter test asserting the OLD count, watch it pass), then implement,
then flip the assertion. Back it with one real-world capture. If the after-number is
within noise of the before, drop that change — it doesn't earn its risk.

=== PHASE A: T1536 ===
Read docs/plans/tasks/quests-latency/T1536-quests-progress-endpoint-latency.md and implement it.
Produce the Classification block first. Per its "Measurement & merit gate": write the
connection-count test asserting user.sqlite opens == 2 on master first, then land the
merge (Finding A: add get_completed_and_claimed_quest_ids to user_db.py, call it once
from get_progress) and flip to == 1. Capture BEFORE/AFTER [PROFILE] lines. Step 3
(profile.sqlite skip) ships ONLY if profiling proves it moves the number. Run backend
tests, commit. Report the count + profiling numbers back to me before Phase B.

=== PHASE B: T1537 (after T1536 is committed) ===
Read docs/plans/tasks/quests-latency/T1537-consolidate-achievement-posts.md and implement it.
T1537 is Stage-2: present your design and WAIT for my approval before coding.
CARRY-OVER FROM PHASE A:
  - Preserve T1536's single-connection change; do not reintroduce a second DB open.
  - Per Finding B: deleting the 4 frontend recordAchievement calls also removes the
    fetchProgress({force:true}) refresh — you MUST add a dedup-gated progress-refresh
    helper (no POST) and call it from the 4 handlers, or the quest panel won't update.
  - Per Finding C: record_achievement_internal(conn, key) reuses the open profile.sqlite
    conn in BOTH framing_action (clips.py L346) and overlay_action (overlay.py L285).
  - Re-capture the [PROFILE] lines + per-gesture request count AFTER this change —
    that's the combined "after" for both tasks.
Per its "Measurement & merit gate": write the frontend request-count test (assert 2
POSTs per gesture on master, flip to 1 after) and the backend connection-reuse test as
the merit proof; confirm with a HAR/Playwright before/after count.

Do NOT change task statuses in PLAN.md — I promote tasks myself. This conversation
owns all of quests.py and framing_action (clips.py L319); the other conversations
are told to stay out.
```

### Conversation 2 — `feature/perf-page-load` (T3760)

```
4-task perf batch, 2 branches / 3 conversations
(see docs/plans/tasks/perf-batch-har-2026-06-17.md). THIS conversation owns ONLY
T3760 (framing clip cold-load over-fetch). It is a spike → decide → implement task:
the decision doc requires my approval BEFORE you code the fix.

Branch: feature/perf-page-load  (shared with the T3770 verify; your files are disjoint)

Read first: CLAUDE.md (root), src/backend/CLAUDE.md (performance-optimization skill),
and docs/plans/tasks/T3760-framing-clip-cold-load-overfetch.md. Use the har-analysis
skill on the HARs — do NOT ingest raw HARs into context.

You edit clips.py at get_clip_playback_url (L1625) + stream_working_clip_bounded
(L1666), FramingScreen.jsx getClipVideoConfig (L385), games.py, possibly the
Cloudflare CDN Worker (T2560). DO NOT touch quests.py or framing_action (clips.py
L319) or the gesture handlers — another conversation owns those. You need no
information from the other conversations.

Per its "Measurement & merit gate": the decision doc must carry measured numbers —
bytes over-fetched per range (cold AND seek) and time-to-first-frame before/after — and
recommend the lowest-complexity option that hits TTFF < 1.5s. The implemented fix needs a
deterministic bounded-Content-Length test (deep open-ended range returns clip-window
bytes, not N-to-EOF) covering both a cold-load and a seek-style offset. Don't ship
anything whose after-capture doesn't beat the before on both cold load and seek.

Produce the Classification block first (flag the CDN Worker as out-of-FastAPI/React
scope). Present measured before-numbers + a recommendation, then WAIT for my
"approved" before implementing. Do NOT change task statuses.
```

### Conversation 3 — `feature/perf-page-load` (T3770)

```
4-task perf batch, 2 branches / 3 conversations
(see docs/plans/tasks/perf-batch-har-2026-06-17.md). THIS conversation owns ONLY
T3770 (StrictMode duplicate page-load fetch verification). Strong prior: dev-only
React StrictMode noise. VERIFY against a PRODUCTION build before changing any code;
the expected outcome is a documented no-op verdict.

Branch: feature/perf-page-load  (run this BEFORE C2/T3760 if sharing the branch, so
the quick verdict commits first; your files are disjoint from T3760 either way)

Read first: CLAUDE.md (root) and docs/plans/tasks/T3770-strictmode-duplicate-pageload-fetches.md.
If (and only if) duplicates survive a prod build, the dedup guards live in
App.jsx / projectDataStore.js / main.jsx (reuse the T2500 in-flight-promise pattern).
DO NOT touch quests.py, clips.py, or FramingScreen's getClipVideoConfig.

Per its "Measurement & merit gate": count requests per resource with Playwright on the
PROD build vs dev, record both in the Progress Log. A clean prod build = a no-op verdict
(zero merit for a guard, so don't add one). Only measured persistence of duplicates in a
prod build justifies a dedup guard + a one-request-per-resource test.

Produce the Classification block first. Record the verdict in the task file's
Progress Log. Do NOT change task statuses — I promote them.
```
