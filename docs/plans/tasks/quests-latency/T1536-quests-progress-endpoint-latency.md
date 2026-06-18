# T1536: Quests /progress + /achievements Endpoint Latency

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-06-17
**Updated:** 2026-06-18

## Coordination (Quests Latency epic — perf batch HAR 2026-06-17)

Epic task 1 of 2 in the **Quests Latency** epic ([EPIC.md](EPIC.md)). Part of the
wider 4-task perf batch — see
[perf-batch-har-2026-06-17.md](../perf-batch-har-2026-06-17.md) for the cross-branch plan.

- **Branch:** `feature/perf-quests-latency` (shared with T1537).
- **Conversation:** C1 — this is **Phase A**, done **before T1537** in the same
  conversation. Land + commit this first, then proceed to T1537.
- **Why paired with T1537:** same subsystem (`quests.py`) and same end-to-end
  measurement. T1536 makes each quest call cheaper; T1537 makes the gesture fire
  fewer of them. Re-measure once, with both in place.
- **Handoff to T1537:** preserve this task's single-connection change when T1537
  extracts `record_achievement_internal` (do not reintroduce a second DB open).

## Problem

> ⚠️ **CORRECTED 2026-06-18 (HAR re-attribution during implementation).** The original
> framing below over-attributed the cost to `/progress` and to this task's merge. The
> real numbers (see Progress Log "HAR re-attribution") are:
>
> | `GET /progress` (HAR) | total | `blocked` (client queue) | `wait` (server) |
> |---|---|---|---|
> | call A | 229 | 26 | **202** |
> | call B | 308 | 25 | **282** |
> | call C (the "699 ms") | **699** | **312** | **386** |
> | call D | 397 | 29 | **368** |
>
> - The headline **699 ms is NOT all server time** — it is **312 ms browser `blocked`
>   (HTTP/2 connection queueing, because two `/progress` fired back-to-back) + 386 ms
>   server `wait`**. The original "≈100% wait" read the `total` column, not `wait`.
> - `/progress` **server** time is ~200–386 ms — i.e. ≈ the accepted ~200 ms R2/session
>   baseline plus noise. The handler body is 4–6 ms warm. **There is no ~400–500 ms of
>   above-baseline server cost in `/progress` to recover, and the redundant `user.sqlite`
>   open was never it** (`ensure_user_database` caches per process → the 2nd open is ~2 ms,
>   not a 2nd R2 restore).
> - The genuine server hotspot is the **achievement POST** (`wait` ≈ 608–612 ms, ~400 ms
>   above baseline) — that is **T1537's** target, not this task's.
>
> **This task is therefore a correctness / DRY cleanup (one fewer DB open, de-duplicated
> double-open in `quests.py` + `bootstrap.py`), NOT a measured latency win.** It is safe
> to land on those grounds. The latency lever for the quests loop is T1537 (fewer calls →
> less client `blocked` queueing + fewer ~610 ms achievement writes).

_Original framing (kept for history):_

In a prod HAR (`Downloads/app.reelballers.com.har`, 2026-06-17) the quest endpoints are
the slowest non-video API calls in the framing/overlay loop — and they fire on nearly
every gesture:

| Endpoint | Wall time (HAR) | Baseline warm API call |
|---|---|---|
| `GET /api/quests/progress` | up to **699 ms** | ~200 ms (`/api/health`, `/api/credits`) |
| `POST /api/quests/achievements/{key}` | up to **636 ms** | ~200 ms |

The timing breakdown is ~100% `wait` (server time), near-zero `receive` — so this is
server-side work, not network. The ~200 ms floor is the known baseline R2/session cost
(see [[project_t1590_not_worth_risk]]); the **~400–500 ms above baseline** is what this
task targets.

`/progress` is also re-fetched repeatedly after each achievement write (4× in the HAR
window), so its cost is paid often.

## Root cause (from code read, [quests.py](../../../../src/backend/app/routers/quests.py))

`GET /quests/progress` ([quests.py:191](../../../../src/backend/app/routers/quests.py#L191)) opens
**three** DB connections per request, each of which can pay a cold R2 sync on first access:

1. `get_completed_quest_ids(user_id)` → opens **user.sqlite** ([line 220](../../../../src/backend/app/routers/quests.py#L220))
2. `_check_all_steps(...)` → opens **profile.sqlite** ([line 225](../../../../src/backend/app/routers/quests.py#L225)) and runs 3 batched aggregates
3. `_get_claimed_quest_ids(user_id)` → opens **user.sqlite AGAIN** as a separate connection ([line 235](../../../../src/backend/app/routers/quests.py#L235))

Steps 1 and 3 both read user.sqlite but use two independent `get_user_db_connection()`
calls — a redundant connection/init round-trip.

### Is `_check_all_steps` doing dead work? (answer: essentially no)

Checked against the recent quest refactor (T3700, 3-quest structure). `_check_all_steps`
([quests.py:89](../../../../src/backend/app/routers/quests.py#L89)) computes all steps from
**four cheap, batched queries** (achievements `IN (...)`, `export_jobs` GROUP BY,
`raw_clips` aggregate, `games LIMIT 1`). All 11 keys in `_STEP_ACHIEVEMENT_KEYS`
([line 68](../../../../src/backend/app/routers/quests.py#L68)) map to live steps in the
current 4 quests — **no dead quests/steps are being computed**. It does recompute steps
for *already-completed* quests (then overwrites them with `True` at
[line 245](../../../../src/backend/app/routers/quests.py#L245)), but that's 4 queries total,
not per-quest, so the waste is negligible. **The cost is the DB-open/R2-sync overhead,
not the step computation.** Do not micro-optimize the queries; fix the connection count.

`POST /achievements/{key}` ([quests.py:324](../../../../src/backend/app/routers/quests.py#L324))
opens profile.sqlite once for an `INSERT OR IGNORE` + read-back. Note T1531 already added
`SKIP_SYNC_PATHS` so achievement writes skip the R2 *push*; the remaining cost is the
profile.sqlite open/restore on the *read* side.

## Solution

**Profile first, then fix** (per the [performance-optimization skill](../../../../src/backend/.claude/skills/performance-optimization/SKILL.md)
— attribute before optimizing). The endpoints already self-profile:
- `GET /progress` logs a `[PROFILE] GET /quests/progress: Nms (completed_ids: …, check_steps: …, claimed_rewards: …)` breakdown when `PROFILING_ENABLED=true` ([quests.py:266](../../../../src/backend/app/routers/quests.py#L266)).
- `POST /achievements` logs `[SLOW ACHIEVEMENT] … conn_ms=… write_ms=… read_ms=…` for anything >500 ms ([quests.py:357](../../../../src/backend/app/routers/quests.py#L357)).

### Step 1 — Get the real attribution (REQUIRED before any fix)

Pull the prod `[PROFILE]`/`[SLOW ACHIEVEMENT]` lines to confirm the split is connection/
restore vs query. Access is via the debug log endpoint, but note:

> **Log-access gotcha (found 2026-06-17):** `GET /api/_debug/logs` sits behind the global
> auth middleware. In **production**, `X-User-ID` header auth is disabled
> ([db_sync.py:463-473](../../../../src/backend/app/middleware/db_sync.py#L463)) — only the
> HttpOnly `rb_session` cookie authenticates, which isn't readable from a script or page
> JS, and 401s come back without CORS headers (so a browser fetch reports an opaque CORS
> error). Practical options: (a) reproduce locally / on staging with `PROFILING_ENABLED=true`
> and `X-User-ID` (header auth is allowed off-prod), or (b) run the curl from inside the
> Fly machine via `fly ssh console` where the middleware can be reached server-side, or
> (c) temporarily enable a profiling capture and read it back through an authenticated admin
> session. Pick whichever is cheapest; the structural fix below is valid regardless.

### Step 2 — Collapse the two user.sqlite opens into one (cheapest, highest-confidence win)

`get_completed_quest_ids` and `_get_claimed_quest_ids` both read user.sqlite. Read both in
a **single** `get_user_db_connection()` block (two `SELECT`s on one connection) instead of
two separate opens. Removes one connection/init round-trip from every `/progress` call.

**Verified shape (code read 2026-06-18):**
- `get_completed_quest_ids(user_id)` ([user_db.py:630](../../../../src/backend/app/services/user_db.py#L630))
  opens `user.sqlite` via `get_user_db_connection` and runs `SELECT quest_id FROM completed_quests`.
- `_get_claimed_quest_ids(user_id)` ([quests.py:167](../../../../src/backend/app/routers/quests.py#L167))
  opens `user.sqlite` via `get_user_db_connection` and runs
  `SELECT reference_id FROM credit_transactions WHERE source = 'quest_reward'`.

**Fix:** add one helper in `user_db.py` —
`get_completed_and_claimed_quest_ids(user_id) -> tuple[set[str], set[str]]` — that opens the
connection **once** and runs both `SELECT`s, then call it from `get_progress`
([quests.py:220](../../../../src/backend/app/routers/quests.py#L220) / [L235](../../../../src/backend/app/routers/quests.py#L235)).
Delete (or thin to a wrapper) `_get_claimed_quest_ids`. Keep the `[PROFILE]` block's
`completed_ids` / `claimed_rewards` sub-timings meaningful — log the merged read as a single
span (the two separate timings collapse into one).

### Step 3 — Only if profiling shows restore dominates

If the `[PROFILE]` split shows the cost is the cold R2 restore (not queries), evaluate the
same lever that fixed `/me` (T1530-era): is the profile.sqlite open even needed on this
path, or can the completed/claimed read alone answer most calls? Consider whether `/progress`
needs to recompute steps for **already-completed** quests at all (they're overwritten to
`True` anyway) — skipping `_check_all_steps` when all quests are already completed avoids the
profile.sqlite open entirely for fully-onboarded users.

> **Note:** This task does NOT change the persistence model. The fire-and-forget frontend
> behavior (T1531) stays as-is. This is purely server-side connection/attribution work.
> The separate request-count reduction is tracked in **T1537** (consolidate achievement POSTs).

## Measurement & merit gate

**Quantity optimized:** number of DB opens (each a potential R2 restore) per
`GET /quests/progress` call. Before: **2 × user.sqlite + 1 × profile.sqlite**.
After: **1 × user.sqlite + 1 × profile.sqlite** (Step 2), or **1 × user.sqlite +
0 × profile.sqlite** for fully-completed users (Step 3, conditional).

**Most-direct measurement (deterministic test — the merit proof):**
Add a backend test that spies on the connection factories and asserts the open
counts. This is exact and CI-stable (no wall-clock flake):

```python
# tests/test_quests_progress_connections.py (sketch)
def test_progress_opens_user_db_once(monkeypatch, ...):
    calls = {"user": 0, "profile": 0}
    real_user = user_db.get_user_db_connection
    real_profile = quests.get_db_connection
    monkeypatch.setattr(user_db, "get_user_db_connection",
                        lambda *a, **k: (calls.__setitem__("user", calls["user"]+1), real_user(*a, **k))[1])
    monkeypatch.setattr(quests, "get_db_connection",
                        lambda *a, **k: (calls.__setitem__("profile", calls["profile"]+1), real_profile(*a, **k))[1])
    client.get("/api/quests/progress")
    assert calls["user"] == 1          # was 2 before this task
    assert calls["profile"] == 1        # 0 if Step 3 lands and all quests completed
```
Write the **before** version first (assert `== 2`) to lock in the baseline, watch it
pass on `master`, then implement and flip the assertion to `== 1`.

**Real-world timing capture (confirmation):** capture the `[PROFILE] GET /quests/progress`
line (`PROFILING_ENABLED=true`) before and after — the `completed_ids` + `claimed_rewards`
spans collapse into one. Record both numbers in the Progress Log.

**Merit gate:** Step 2 (2→1 user.sqlite open) is the high-confidence win — ship it.
**Step 3 is conditional on proof:** only land the profile.sqlite skip if the `[PROFILE]`
split shows the cold restore (not the queries) dominates AND the after-number measurably
drops. If it's within noise, drop Step 3 — the branch adds risk for no gain
([[project_t1590_not_worth_risk]]).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/quests.py` — `get_progress` (L191), `_check_all_steps` (L89), `_get_claimed_quest_ids` (L167), `record_achievement` (L324)
- `src/backend/app/services/user_db.py` — `get_user_db_connection`, `get_completed_quest_ids` (L630), `ensure_user_database` (L124)
- `src/backend/app/database.py` — `get_db_connection` / `ensure_database` (profile.sqlite restore)
- `src/backend/app/middleware/db_sync.py` — auth/session init context (L444-493); explains the log-access gotcha
- Evidence: `Downloads/app.reelballers.com.har` (2026-06-17)

### Related Tasks
- Pairs with: **T1537** (consolidate per-gesture achievement POSTs — reduces how often `/achievements` + `/progress` fire)
- Background: **T1531** (achievement R2-sync skip), **T1530** (profiling strategy), **T3700** (3-quest refactor)

### Technical Notes
- Per [[feedback_no_fallbacks_correct_data]] / [[feedback_user_lookup_postgres]]: don't add read-time guards; fix the connection path.
- Baseline ~200 ms floor is accepted R2 cost ([[project_t1590_not_worth_risk]]) — out of scope.

## Implementation

### Steps
1. [ ] Capture prod (or staging) `[PROFILE]`/`[SLOW ACHIEVEMENT]` lines; record the conn-vs-query split as the before-number.
2. [ ] Merge the two user.sqlite reads in `/progress` into one connection.
3. [ ] (Conditional) Skip `_check_all_steps`/profile.sqlite open when all quests already completed.
4. [ ] Re-capture profiling; confirm the above-baseline delta shrinks.

### Progress Log

**2026-06-18 (HAR re-attribution — latency claim retracted)**: Parsed the prod HAR per
endpoint (`GET /quests/progress` ×4, `POST /achievements` ×2). Findings:

- `GET /progress` totals 229 / 308 / **699** / 397 ms decompose to `blocked` (client
  HTTP/2 queueing) 26 / 25 / **312** / 29 ms and server `wait` 202 / 282 / **386** / 368 ms.
  The "699 ms" is **312 ms client blocked + 386 ms server wait**, not 699 ms of server work.
- `/progress` server `wait` (~200–386 ms) ≈ the accepted ~200 ms baseline + noise; handler
  body is 4–6 ms warm. **No above-baseline server cost to recover here.**
- `POST /achievements` server `wait` = **608 / 612 ms** (~400 ms above baseline) — the real
  quests-loop hotspot, and T1537's target.
- The 312 ms `blocked` spike came from two `/progress` firing back-to-back → connection
  queueing; reducing request count (T1537) attacks it directly.

**Conclusion:** T1536's `user.sqlite` merge is a correctness/DRY cleanup (one fewer open,
de-duplicated in `quests.py` + `bootstrap.py`), **not a measured latency win**. The
acceptance criterion "above-baseline server time measurably reduced" is **not met and is
retracted** — there was no ~400–500 ms to recover on `/progress`. Keeping the change on
correctness grounds; latency work moves to T1537 (achievement POST + request count).

**2026-06-18 (implementation — Step 2 landed)**: Implemented the `user.sqlite`
merge on branch `feature/perf-quests-latency`.

- **Merit proof (deterministic connection-count test):** `tests/test_quests_progress_connections.py`
  spies on `user_db.get_user_db_connection` and `quests.get_db_connection`. Confirmed
  **2 user.sqlite opens on baseline** (test failed with `got 2` on unmodified code), then
  **1 after** the merge. profile.sqlite stays at 1. Test passes.
- **Step 2:** added `get_completed_and_claimed_quest_ids(user_id) -> (set, set)` in
  `user_db.py` (one connection, two SELECTs: `completed_quests` + `quest_reward`
  `credit_transactions`). Rewired `get_progress` (quests.py) and also the identical
  double-open in `bootstrap.py` (same root cause, hot initial-load endpoint) to the
  helper. Deleted `_get_claimed_quest_ids` (now unused). `[PROFILE]` block collapsed the
  two user spans into one `user_read` span.
- **Attribution / `[PROFILE]` capture (local, R2_ENABLED=true):**
  - *Before (baseline):* `GET /quests/progress: 1301ms (completed_ids: 986ms, check_steps: 2ms, claimed_rewards: 2ms)` cold; `6ms (completed_ids: 1ms, check_steps: 0ms, claimed_rewards: 2ms)` warm.
  - *After:* `GET /quests/progress: 1677ms (user_read: 785ms [completed+claimed, 1 open], check_steps: 12ms)` cold; `4ms (user_read: 2ms [completed+claimed, 1 open], check_steps: 0ms)` warm.
  - The cold first call is dominated by the one-time R2 download (cached in
    `_initialized_user_dbs` per process), so the redundant second open was paying
    connection-setup overhead, not a second full restore, within a request. The
    structural win (one fewer open = strictly less work, and one fewer *potential* cold
    restore) is proven exactly by the connection-count test; wall-clock here is
    R2-network-noisy and warm-tiny, which is why the deterministic counter is the merit
    proof.
- **Step 3 (conditional skip of profile.sqlite): DROPPED.** The `[PROFILE]` split does
  not show the cold restore dominating *per request* (it's a one-time per-process cost);
  skipping `_check_all_steps` for fully-completed users adds a branch for no measurable
  warm-path gain. Per [[project_t1590_not_worth_risk]], not forced.

**2026-06-18**: Code re-verified for the perf-batch coordination. Confirmed the exact two user.sqlite reads (`completed_quests` + `credit_transactions`) and that both use `get_user_db_connection`; specified the `get_completed_and_claimed_quest_ids` merge helper (Step 2 / Finding A). Assigned to branch `feature/perf-quests-latency`, Phase A before T1537.

**2026-06-17**: Created from prod HAR analysis. Confirmed via code read that `_check_all_steps` computes no dead quests (all 11 achievement keys map to live steps post-T3700); the latency is DB-open/R2-restore overhead, dominated by `/progress` opening user.sqlite twice + profile.sqlite once. Documented the prod log-access gotcha (X-User-ID disabled in prod; rb_session cookie only).

## Acceptance Criteria

- [ ] **Deterministic connection-count test committed** (asserts user.sqlite opened exactly once; was 2). This is the merit proof.
- [ ] Before/after `[PROFILE]` lines captured for `GET /quests/progress` (attribution-first) and recorded in the Progress Log.
- [ ] `/progress` opens user.sqlite at most once per request.
- [x] ~~Above-baseline server time for `/progress` measurably reduced~~ **RETRACTED after HAR re-attribution (2026-06-18):** there was no ~400–500 ms above-baseline server cost on `/progress` to recover (the 699 ms was 312 ms client `blocked` + 386 ms server `wait` ≈ baseline). Step 3 dropped. Change retained as a correctness/DRY cleanup, not a latency fix.
- [ ] No change to persistence model or fire-and-forget behavior.
- [ ] Backend tests pass.
