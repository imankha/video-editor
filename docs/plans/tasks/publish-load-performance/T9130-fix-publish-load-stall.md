# T9130: Offload the blocking call(s) found by T9120

**Status:** TODO — unblocked, T9120 complete
**Impact:** 8
**Complexity:** 5 (M — 9 handler flips + 1 amplifier fix, all the same mechanical pattern, no new abstraction)
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Epic Context

Epic 2/3 of [Publish Load Performance](EPIC.md). This task implements whatever T9120's
root-cause investigation names — do not start it until T9120's write-up exists.

## Problem

See [T9120](T9120-root-cause-publish-load-stall.md) and the [EPIC](EPIC.md) for full evidence.
Summary: the Publish page's initial API burst (7 endpoints) resolves in a synchronized ~3.6s
stall, then a second 4-endpoint burst repeats the pattern for ~0.9s — matching the documented
T6200 blocking-event-loop signature in `app/utils/offload.py`.

## Solution

T9120 found **9 independent handlers each blocking the event loop on their own**, not one shared
cause (proven: loop-block-probe durations differ per handler, and burst wall time == the SUM of
serial times, not one shared duration). Each needs its own offload — same fix class as T6240's
`user_session_init` offload and T8020's `admin_dashboard` flip, not new architecture, just applied
9 more times plus one amplifier fix.

### Handlers to fix, ordered by measured loop-hold (T9120's live staging probe)

For each: use `run_in_context` (`app/utils/offload.py`) if the body reads request context via
`get_current_user_id()`/`get_current_profile_id()`/`get_db_connection()`, OR flip `async def` to
plain `def` if the WHOLE body is synchronous with no `await` (FastAPI runs plain-`def` handlers in
anyio's threadpool automatically, contextvars included — this is the T8020 precedent's approach,
cheaper than threading `run_in_context` through when nothing needs to stay `async`). Check each
body for an actual `await` before choosing — don't flip one that has one.

1. **`app/routers/admin.py:189` `admin_me`** — flip to plain `def` (two blocking psycopg2 calls via
   `is_admin()`, `app/services/auth_db.py:236-244`, no `await` in the body). Measured -337ms.
2. **`app/routers/projects.py:640` list_projects's fire-and-forget poster warm** — the biggest
   latent amplifier (scales linearly with project count, ~88ms/project measured). Wrap the
   `file_exists_in_r2` existence sweep in ONE `run_in_context` call rather than per-project; also
   fix the duplicate blocking HEAD dedup-checks at `app/services/poster_warmer.py:110` and `:176`.
3. **`app/routers/bootstrap.py:212`** — route `_read_profile_misc()` through `run_in_context`,
   same as its sibling groups. Fold it into the existing `asyncio.gather` in `bootstrap()` so it
   overlaps the other groups instead of trailing them.
4. **`app/routers/storage.py:202` `get_warmup_urls`** — flip to plain `def` (DB read + the
   sequential presign loop, no `await`). Measured -157ms, scales with download-library size.
5. **`app/routers/collections.py:393` `collections_summary`** (serves both the bare call and
   `?sport=soccer` in Stall B) — flip to plain `def`. Measured -109ms.
6. **`app/routers/exports.py:712` `list_unacknowledged_exports`** — flip to plain `def`, matching
   its already-fixed sibling `/active` (line 653, `anyio.to_thread.run_sync`, T7040) which was the
   experiment's internal control (lowest loop-hold of the whole set, 58ms).
7. **`app/routers/rank.py:470` `rank_confidence`** — flip to plain `def`. Called twice per page
   load (once per aspect ratio). Measured -123ms.
8. **`app/routers/intro_cards.py:169` `list_intro_cards`** — flip to plain `def`. Measured -68ms.
9. **Stall B stragglers, same shape** — `app/routers/collections.py:1284`
   `get_collection_intro_batch`, `app/routers/quests.py:442` `record_achievement`,
   `app/routers/games_upload.py:743` `list_pending_uploads` — flip to plain `def` after confirming
   no `await` in each body.

### Cold-path offenders outside the burst, same class — fold in if scope allows, otherwise file separately

- **`app/routers/auth.py:198` `init_session`** calls `user_session_init()` inline on the loop — the
  un-offloaded twin of T6240's fix (`db_sync.py:966` already offloads the middleware path; this
  explicit endpoint doesn't). Measured 2145ms of loop block on a cold process. Fix:
  `await run_in_context(user_session_init, user_id, hint_profile_id=body.profile_id)`, then
  re-apply `set_current_profile_id(result["profile_id"])` on the request context afterward (the
  copied context in the worker thread does not propagate back — same note T6240 already left).
- **`app/session_init.py:408` `_schedule_startup_recovery`** → `_run_startup_recovery`, a
  fire-and-forget LOOP task that calls `recover_orphaned_jobs`
  (`app/services/export_worker.py:435-500`, blocking sqlite + `modal.FunctionCall.from_id(...).get()`)
  directly on the loop, competing with the user's first page load. Offload the same way.

## Context

### Relevant Files
- Determined by T9120's findings — do not guess ahead of that write-up.
- `src/backend/app/utils/offload.py` — the fix primitive
- `src/backend/app/routers/bootstrap.py:230-245` — existing T4771 offload pattern to mirror

### Related Tasks
- Depends on: T9120 (must be complete first — do not start blind)
- Same fix class as: T6240 (`user_session_init` → `run_in_context`, `db_sync.py:773`)

### Technical Notes
- Preserve `run_in_context`'s contextvar-copy behavior — a bare `asyncio.to_thread` on a call that
  reads `get_current_user_id()` raises "No user context set" inside the thread (the exact landmine
  `offload.py`'s docstring calls out).
- **Landmine flipping `async def` → plain `def`:** any test that calls the handler directly via
  `asyncio.run(...)` (rather than through a test client) breaks — this is the exact shape that
  broke `test_t5770_usage_daily.py` and `test_t4970_admin_segmentless_enumeration.py` when T8020
  did the same flip on `admin_dashboard`. Grep for direct callers of each flipped handler before
  changing it.
- Verify the fix using the same experiment T9120 already ran and recorded pre-fix numbers for:
  fire the 7 Stall-A endpoints concurrently against a warm process and assert burst wall time is
  ~max(individual durations), not ~sum(individual durations) — pre-fix baseline: burst wall 605ms,
  `/api/health` inflated to 602ms against a 3ms serial baseline. Target post-fix: burst wall
  <=~400ms (bounded by the slowest single handler, `/api/games` at up to 844ms loop-hold before its
  own fix), `/api/health` <100ms. `scripts/concurrency_probe.py` already exists for this shape —
  extend it rather than hand-rolling a new probe.
- Also re-capture a real HAR of the Publish page load and confirm the lockstep-stall shape (near
  simultaneous start AND near-simultaneous finish across unrelated endpoints) is gone.

## Implementation

### Steps
1. [ ] Read T9120's full write-up (Progress Log + Acceptance Criteria answers) in
       `T9120-root-cause-publish-load-stall.md` before starting
2. [ ] Flip/offload each handler in the "Handlers to fix" list above, checking for direct-call test
       breakage per the landmine note before each `async def` → `def` flip
3. [ ] Fix the `list_projects` poster-warm amplifier (item 2) — batch the existence sweep instead
       of per-project blocking HEADs
4. [ ] Extend `scripts/concurrency_probe.py` / add a test in the shape of
       `test_t6240_session_init_concurrency.py` (a ticker coroutine that must keep ticking during
       the burst — fails inline, passes offloaded) asserting `/api/health` stays flat during a
       Publish-shaped concurrent burst
5. [ ] Re-run T9120's staging experiment (or a fresh HAR) and confirm burst wall time drops from
       ~605ms to ~max(individual) and `/api/health` drops from 602ms to <100ms
6. [ ] Decide whether to fold in the two cold-path offenders (`auth.py:198` `init_session`,
       `session_init.py:408`'s startup recovery) or file them as a follow-up — they're the same
       fix class but outside the Publish-page burst itself
7. [ ] Update `.claude/knowledge/backend-services.md` § Request concurrency model with the
       confirmed cause and the fix (per CLAUDE.md's knowledge-doc rule)

### Progress Log

**2026-09-08**: Task filed, blocked on T9120.

**2026-09-08**: T9120 complete — expert agent reproduced the stall live on staging and confirmed
9 independent un-offloaded handlers (not one shared cause) plus one scaling amplifier
(`list_projects`'s per-project poster-warm HEAD). Full spec above. Unblocked.

## Acceptance Criteria

- [ ] All 9 handlers in "Handlers to fix" are offloaded or flipped to plain `def`, each verified
      against its own body for `await` usage before flipping and against existing tests for
      direct-call breakage
- [ ] The `list_projects` poster-warm amplifier is batched instead of per-project-blocking
- [ ] `scripts/concurrency_probe.py`-shaped regression test asserts `/api/health` stays flat during
      a concurrent Publish-shaped burst (fails pre-fix, passes post-fix)
- [ ] Re-run of T9120's experiment shows burst wall time ~max(individual) instead of ~sum, and
      `/api/health` back under 100ms (from a 602ms pre-fix baseline)
- [ ] A fresh HAR of the Publish page load shows no synchronized multi-endpoint stall
- [ ] `backend-services.md` § Request concurrency model updated with the confirmed cause
