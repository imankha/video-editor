# T1537: Consolidate Per-Gesture Achievement POSTs into the Action Endpoints

**Status:** BLOCKED (deferred to the future single-machine / session-affinity epic)
**Impact:** 5
**Complexity:** 3
**Created:** 2026-06-17
**Updated:** 2026-06-18

> 🚧 **BLOCKED 2026-06-18.** Attribution (see Progress Log) showed the achievement POST's
> ~610 ms is **synchronous `record_milestone`** (Postgres + user.sqlite), and the POST is
> already fire-and-forget from the frontend (T1531) so the user feels none of it today.
> Reducing the request count means folding the achievement into the **awaited** `/actions`
> POST, which would drag that synchronous analytics latency onto the edit gesture — a
> regression. The only clean fix is making the milestone emit **fire-and-forget**, which is
> a **persistence-model change**. Per project decision, fire-and-forget / persistence-model
> experiments are deferred until sessions are pinned to a single machine (future epic). So
> T1537 waits for that epic. T1536 (the `user.sqlite` merge) already landed as a standalone
> correctness cleanup. See [T1537-design.md](../T1537-design.md) (deferred) for the worked-out
> approach to revive then.

## Coordination (Quests Latency epic — perf batch HAR 2026-06-17)

Epic task 2 of 2 in the **Quests Latency** epic ([EPIC.md](EPIC.md)). Part of the
wider 4-task perf batch — see
[perf-batch-har-2026-06-17.md](../perf-batch-har-2026-06-17.md) for the cross-branch plan.

- **Branch:** `feature/perf-quests-latency` (shared with T1536).
- **Conversation:** C1 — this is **Phase B**, done **after T1536** in the same
  conversation. Stage-2 (design approval required) before coding.
- **Carry-over from T1536 (Phase A):** preserve T1536's single-`user.sqlite`-open
  change in `get_progress`; do not reintroduce a second DB open when extracting
  `record_achievement_internal`. Re-capture the `[PROFILE]` lines + per-gesture
  request count **after** this task — that's the combined "after" for both.

## Problem

Today a single user gesture in framing/overlay fires **two** POSTs from the frontend — the
edit action *and* a separate gamification write — each with its own CORS preflight. From the
prod HAR (`Downloads/app.reelballers.com.har`, 2026-06-17), a crop adjust produced:

```
POST /api/clips/projects/46/clips/48/actions          (the edit)
POST /api/quests/achievements/crop_adjusted           (the achievement)
+ an OPTIONS preflight for each
```

The frontend already knows the gesture; the backend can derive the achievement from the
action type. Folding the achievement write into the action endpoint removes ~half the
per-gesture requests (and their preflights) for the four most common edit gestures. This is
the "easy cleanup" — the action already carries everything the achievement needs.

## Scope (deterministic action → achievement mapping)

| Frontend gesture | Action POST (kept) | Achievement POST (fold in) |
|---|---|---|
| Adjust crop | `add_crop_keyframe` → [clips.py framing_action](../../../../src/backend/app/routers/clips.py#L318) | `crop_adjusted` |
| Add slow-mo | `set_segment_speed` (speed < 1) → same | `speed_segment_created` |
| Pick highlight color | overlay `set_highlight_color` → overlay actions endpoint | `overlay_color_set` |
| Pick highlight shape | overlay `set_highlight_shape` → same | `overlay_shape_set` |

**Out of scope — these are NOT action-driven, keep their own POST:**
`opened_framing_editor`, `opened_overlay_editor`, `overlay_players_assigned` (derived from
"all detections assigned" state, not a single gesture), and the gallery/annotation view
events. Only the four gesture-bound achievements above consolidate.

## Solution

1. **Backend — extract a reusable helper.** Pull the achievement body out of
   `record_achievement` ([quests.py:324](../../../../src/backend/app/routers/quests.py#L324))
   into `record_achievement_internal(conn, key)` that does the `INSERT OR IGNORE` + the
   `ACHIEVEMENT_TO_MILESTONE` analytics emit ([quests.py:49-65](../../../../src/backend/app/routers/quests.py#L49)).
   The existing HTTP route becomes a thin wrapper around it (keeps backward compatibility for
   the lifecycle achievements still posted directly).

2. **Backend — derive + record inside the action handlers.** Add an `ACTION_TO_ACHIEVEMENT`
   map and call `record_achievement_internal` from:
   - `framing_action` ([clips.py:318](../../../../src/backend/app/routers/clips.py#L318)) for
     `add_crop_keyframe` → `crop_adjusted`, and `set_segment_speed` → `speed_segment_created`
     **only when speed < 1** (matches the current frontend condition at
     [FramingContainer.jsx:1023-1035](../../../../src/frontend/src/containers/FramingContainer.jsx#L1023)).
   - the overlay actions handler `overlay_action` (`POST /api/export/projects/{pid}/overlay/actions`,
     [overlay.py:258](../../../../src/backend/app/routers/export/overlay.py#L258)) for
     `set_highlight_color` ([L485](../../../../src/backend/app/routers/export/overlay.py#L485)) /
     `set_highlight_shape` ([L519](../../../../src/backend/app/routers/export/overlay.py#L519)).
   - **Connection reuse confirmed for BOTH handlers (code read 2026-06-18).** The
     `achievements` table is in `profile.sqlite`, opened via `get_db_connection()`. Both action
     handlers already hold that same open connection —
     `framing_action` ([clips.py:346](../../../../src/backend/app/routers/clips.py#L346)) and
     `overlay_action` ([overlay.py:285](../../../../src/backend/app/routers/export/overlay.py#L285)) —
     so `record_achievement_internal(conn, key)` reuses it with no extra DB open in either
     mode. Write the achievement **before** each handler's existing commit
     (framing: `_save_clip_framing_data` at [clips.py:523](../../../../src/backend/app/routers/clips.py#L523);
     overlay: `conn.commit()` at [overlay.py:530](../../../../src/backend/app/routers/export/overlay.py#L530)).
   - **Non-blocking:** wrap the achievement write so an error is logged but the action still
     returns success.

3. **Frontend — replace the four redundant `recordAchievement` calls.** Removing them is NOT
   enough — see the ⚠️ below. The four call sites:
   - [FramingContainer.jsx:320](../../../../src/frontend/src/containers/FramingContainer.jsx#L320) (crop)
   - [FramingContainer.jsx:1034-1036](../../../../src/frontend/src/containers/FramingContainer.jsx#L1034) (speed, inside the `if (speed < 1)` guard)
   - [OverlayScreen.jsx:671](../../../../src/frontend/src/screens/OverlayScreen.jsx#L671) (color)
   - [OverlayScreen.jsx:722](../../../../src/frontend/src/screens/OverlayScreen.jsx#L722) (shape)

   Leave `questStore.recordAchievement` in place for the lifecycle/non-action achievements
   (`opened_*`, `overlay_players_assigned`, gallery/annotation views).

   > **⚠️ Finding B — removing the POST also removes a UI refresh.**
   > `questStore.recordAchievement`
   > ([questStore.js:130-154](../../../../src/frontend/src/stores/questStore.js#L130)) does TWO
   > things, session-dedup-gated by `_recordedAchievements`: (1) the achievement POST, and
   > (2) **on success, `get().fetchProgress({ force: true })`** — which is what visibly checks
   > the quest step off in the panel. If you just delete the four calls, the achievement still
   > gets written server-side, **but the quest panel won't refresh until the next natural
   > progress fetch** (step looks stuck until reload). So add a small dedup-gated `questStore`
   > helper — e.g. `refreshProgressForGesture(key)` — that does NOT POST, just calls
   > `fetchProgress({ force: true })` **once per gesture-key per session** (reuse the
   > `_recordedAchievements` set), and call it from the four handlers in place of
   > `recordAchievement`. This keeps the "step ticks once when first achieved" behavior with
   > zero extra `/achievements` POSTs.

## Measurement & merit gate

**Quantity optimized:** HTTP requests per gesture. Before: **2 POSTs + 2 CORS
preflights** (`/actions` + `/quests/achievements/*`). After: **1 POST + 1 preflight**
(`/actions` only). Secondary: **0 extra DB opens** — the achievement reuses the
handler's already-open `profile.sqlite` connection.

**Most-direct measurement (deterministic tests — the merit proof):**

1. **Frontend, per gesture (the headline win):** mock the network layer, fire each of
   the four handlers, and assert the request set. Capture the **before** count first
   (2 POSTs) on `master`, then flip after the change:
   ```js
   // before this task: expect ['POST /actions', 'POST /quests/achievements/crop_adjusted']
   // after:            expect ['POST /actions']  AND fetchProgress called exactly once
   ```
   Assert exactly one POST to `/actions`, **zero** to `/quests/achievements/*`, and that
   `fetchProgress({force:true})` still fired once (guards Finding B — the panel refresh).

2. **Backend, connection reuse (no hidden cost):** spy on `get_db_connection` inside
   `framing_action` / `overlay_action` and assert the achievement write does **not** add
   an open — count stays the same as before the change (1, not 2). Also assert: the
   `achievements` row + milestone are written; `set_segment_speed` with `speed >= 1`
   writes **no** `speed_segment_created`; an injected achievement-write failure still
   returns the action's success.

**Real-world capture (confirmation):** re-run the framing/overlay gesture flow and
confirm in a HAR / Playwright `browser_network_requests` count that each gesture now
shows one POST + one preflight, not two. Record before/after counts in the Progress Log.

**Merit gate:** the request-count halving is deterministic and guaranteed by the tests
above — if the frontend test can't show 2→1, the change didn't land. The risk this trades
against is the Finding B refresh regression and the non-blocking-write contract; both are
covered by explicit assertions, so the merit is the proven request reduction with those
guards green.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/quests.py` — extract `record_achievement_internal` from `record_achievement` (L325); add `ACTION_TO_ACHIEVEMENT` near `ACHIEVEMENT_TO_MILESTONE` (L49); `KNOWN_ACHIEVEMENT_KEYS` (L29)
- `src/backend/app/routers/clips.py` — `framing_action` (L319); derive achievement on the existing profile connection (L346) before `_save_clip_framing_data` (L523)
- `src/backend/app/routers/export/overlay.py` — `overlay_action` (L258); derive color/shape achievement on the existing connection (L285) before `conn.commit()` (L530)
- `src/frontend/src/containers/FramingContainer.jsx` — replace crop (L320) + speed (L1034-1036) `recordAchievement` calls with the refresh helper
- `src/frontend/src/screens/OverlayScreen.jsx` — replace color (L671) + shape (L722) `recordAchievement` calls with the refresh helper
- `src/frontend/src/stores/questStore.js` — `recordAchievement` (L130, stays for lifecycle events); add `refreshProgressForGesture(key)` (Finding B)
- Evidence: `Downloads/app.reelballers.com.har` (2026-06-17)

### Related Tasks
- Pairs with: **T1536** (quests endpoint latency — fewer `/achievements` calls means its cost is paid less often)
- Background: **T1531** (achievement R2-sync skip + fire-and-forget frontend), **T3700** (the achievements these track)

### Technical Notes
- Per [[feedback_leverage_existing_systems]]: reuse the existing achievement helper + milestone map; don't build a parallel path.
- Quest *progress* still updates the same way — `_check_all_steps` reads the `achievements`
  table regardless of which endpoint wrote the row. No quest-logic change, only the write entry point.
- Idempotency preserved: `INSERT OR IGNORE` means re-recording is safe if a gesture repeats.

## Implementation

### Steps
1. [ ] Extract `record_achievement_internal(conn, key)` in quests.py; rewire the HTTP route to it.
2. [ ] Add `ACTION_TO_ACHIEVEMENT` derivation in `framing_action` (crop + speed<1), on the existing connection, non-blocking, before its commit.
3. [ ] Add color/shape derivation in `overlay_action`, on its existing connection, before its commit.
4. [ ] Add the dedup-gated `refreshProgressForGesture(key)` helper to questStore (Finding B); replace the four frontend `recordAchievement` calls with it; keep lifecycle `recordAchievement` calls.
5. [ ] Tests: backend asserts each action endpoint writes the achievement row + emits the milestone (and `set_segment_speed` with speed ≥ 1 does NOT), and that an achievement-write failure does not fail the action; frontend asserts each gesture fires exactly ONE POST (the action) and still refreshes quest progress.

### Progress Log

**2026-06-18 (BLOCKED — deferred to single-machine epic)**: Took the attribution below to
Stage-2 design ([T1537-design.md](../T1537-design.md)). The viable design requires making the
`record_milestone` emit **fire-and-forget** (otherwise folding it into the awaited `/actions`
POST regresses the edit gesture by ~300–600 ms). Per project decision, fire-and-forget /
persistence-model changes are deferred until sessions are tied to a single machine (future
epic) — so this task is parked there. Net effect of the Quests Latency epic for now: **T1536
only** (correctness/DRY cleanup; no measured latency win). Phase B does not ship in this
conversation.

**2026-06-18 (achievement-POST attribution — Phase B start)**: Attributed the ~610 ms
server `wait` on `POST /quests/achievements/{key}` (HAR: 608 / 612 ms).

- **The cost is synchronous analytics, not DB opens.** `record_achievement`
  ([quests.py:362](../../../../src/backend/app/routers/quests.py#L362)) calls
  `record_milestone(...)` **outside** its timed block.
  `record_milestone` ([analytics.py:225](../../../../src/backend/app/analytics.py#L225))
  runs on the request thread and does: `get_pg()` + **3–4 Fly Postgres round-trips**
  (INSERT `user_actions`, UPDATE `user_segments`, SELECT `origin`) **plus a second DB open**
  `get_user_db_connection` → user.sqlite INSERT `user_action_log` + commit
  ([analytics.py:273-281](../../../../src/backend/app/analytics.py#L273)).
- `/progress` is ~280 ms warm (same session) precisely because it does **not** call
  `record_milestone`. The achievement POST's profile.sqlite INSERT (the only part
  `[SLOW ACHIEVEMENT]` times) is trivial — **the milestone write is untimed, so the existing
  instrumentation misses the real cost** (per the performance-optimization skill: fix
  attribution first).
- The achievement POST is in `SKIP_SYNC_PATHS`
  ([db_sync.py:286](../../../../src/backend/app/middleware/db_sync.py#L286)), so it does **not**
  pay an R2 push — ruling that out. `ensure_database` only restores from R2 on first access
  ([database.py:498-506](../../../../src/backend/app/database.py#L498)), so warm opens are cheap —
  ruling cold restore out too.

**⚠️ Design implication for this task (load-bearing):** folding
`record_achievement_internal` into the action POST is the *request-count* win — but if the
helper keeps the **synchronous** `record_milestone` emit, we transfer ~300–600 ms of Postgres
+ user.sqlite latency onto the `/actions` POST, **the request the user waits on for the edit
to apply**. That would be a latency *regression* on the hot path. So the design must take the
milestone analytics emit **off the request path** (background task / `asyncio.to_thread` /
fire-and-forget) — or fold only the cheap `INSERT OR IGNORE` achievement row and queue the
milestone async. The "0 extra DB opens" claim holds only for the achievement INSERT, not for
`record_milestone`'s own `get_pg()` + user.sqlite open. **This needs to be resolved in the
Stage-2 design before coding.**

**2026-06-18**: Code re-verified for the perf-batch coordination. Confirmed connection reuse for BOTH handlers (`framing_action` clips.py L346, `overlay_action` overlay.py L285 — same `get_db_connection()` profile.sqlite). **Found the load-bearing gotcha (Finding B):** `questStore.recordAchievement` also triggers `fetchProgress({force:true})` on success, so deleting the four calls without a replacement leaves the quest panel un-refreshed — added the `refreshProgressForGesture` requirement. Assigned to branch `feature/perf-quests-latency`, Phase B after T1536.

**2026-06-17**: Created from prod HAR + code investigation. Mapping confirmed deterministic; action endpoints already carry the needed data. Identified that `framing_action` can write the achievement on its existing profile.sqlite connection (no extra DB open). Lifecycle achievements (`opened_*`, `overlay_players_assigned`, gallery/annotation views) explicitly excluded.

## Acceptance Criteria

- [ ] **Deterministic before/after request-count test committed** (frontend: 2 POSTs → 1 per gesture; backend: connection count unchanged). This is the merit proof.
- [ ] Crop / speed / color / shape gestures each fire exactly ONE POST (no separate `/quests/achievements/*`).
- [ ] The corresponding achievement row + analytics milestone are still recorded (now server-derived).
- [ ] The quest panel still visibly checks the step off after the gesture (refresh preserved — Finding B).
- [ ] Lifecycle achievements still post directly and are unaffected.
- [ ] An achievement write failure does not fail the underlying edit action.
- [ ] Frontend + backend tests pass.
