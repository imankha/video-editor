# T6402: A machine CAS-conflicts with itself - the baseline/HEAD decision runs outside the upload lock

**Status:** STAGING
**Impact:** 8
**Complexity:** 3
**Created:** 2026-08-03
**Updated:** 2026-08-03

> **ID NOTE — this task's implementation commits are labelled `T6400`, not `T6402`.**
> It was filed as T6400 after a check showed that id free, but a CONCURRENT session in this
> shared checkout was already using T6400 for "inherit the last clip's layer"
> (`T6400-inherit-last-clip-layer.md`, 53d1078f) and its work reached master before this
> branch was cut. The collision was caught at merge time; this task was renumbered to T6402
> so the older T6400 keeps its identity and board branch-attribution. The already-merged
> commits (`4335d73d`, `e0b7bf1e`, merge `77b27bf8`) and the branch name
> `feature/T6400-cas-self-race` still say T6400 and were NOT rewritten (master is shared).
> Search BOTH ids when tracing this work.

## Problem

**Live staging incident 2026-08-03, diagnosed from T6390's own diagnostics on their first
real use.** User clicked "Move to My Reels" (publish); My Reels then took a very long time to
load and the browser console carried:

```
[sync] state -> conflict
  db=profile  profile_id=9fa7378c  reason=stale_baseline
  loaded=2734  r2=2735
  machine=d8933d5f417308  writer=d8933d5f417308/dcce51f3
  req_id=e7f06082  gesture=GET /api/quests/progress  hasAttemptedWrite=true
```

`machine == writer machine`. **The machine refused its own write.** T6390's `db-writer` stamp is
what makes this readable in one pass - before it, "another machine / export worker / admin
restore" were indistinguishable. Staging also runs exactly ONE machine
(`min_machines_running = 0`, `auto_stop_machines = "suspend"` in `fly.staging.toml`), so a
cross-machine race is structurally impossible and same-process self-race is the only
explanation left.

### Root cause: the CAS version decision is not covered by the upload lock

In `storage.py: sync_database_to_r2_with_version` the ordering is:

1. caller reads the local baseline (`database.py:1640`, `get_local_db_version`)
2. HEAD R2 for the current version (`storage.py:1211`)
3. refuse if `r2_version > current_version` (`storage.py:1246`)
4. **then** acquire the per-user upload lock (`storage.py:1284/1297`) and PUT

Steps 1-3 are entirely outside the lock that step 4 takes, so two concurrent syncs of the SAME
profile in one process interleave:

```
sync A: read baseline 2734 ......................... HEAD -> 2735  REFUSE (stale_baseline)
sync B: read baseline 2734 -> HEAD 2734 -> lock -> PUT 2735 -> set baseline 2735
```

A and B upload **the same file on disk** (`get_user_data_path_explicit(user_id, profile_id) /
"profile.sqlite"`). A's "stale" copy already contains B's data. The refusal is a false positive
against itself - there is no divergence for CAS to protect.

Concurrent syncs per user are not hypothetical; the code says so at `db_sync.py:1282-1284`:
*"Fire-and-forget `_background_sync` tasks are not serialised per user, so a burst can spawn
several concurrent re-drains for one user."* T5870 round 2 gave the **re-drain** path a
non-blocking upload-lock probe to stop stampedes, but the **primary** sync path never got the
equivalent protection for its version decision. The publish click alone fires the durable
publish sync plus `recordAchievement('moved_to_my_reels')` (`DraftTile.jsx:157`, fire-and-forget),
with an export-worker sync possibly still draining.

The same shape exists in the `user.sqlite` twin (`storage.py:1543` decision vs `:1569` lock).

**Amplifier (staging-specific, unproven but plausible):** `auto_stop_machines = "suspend"` can
freeze a background sync task between its baseline read and its HEAD, stretching a
sub-millisecond window arbitrarily long.

### Consequences

1. **False "your edits aren't saving" alarm.** The sticky conflict banner + `X-Sync-Status:
   conflict` on the next response - what the user saw on `GET /api/quests/progress`.
2. **A full profile.sqlite re-download.** The refusal calls `schedule_profile_db_reheal`
   (`database.py:644-663`), which nulls the local baseline so the NEXT request does a
   first-access restore of the whole DB from R2. At v2735 that is not a small file - this is
   the "My Reels took forever to load".
3. **A genuine (narrow) silent data-loss window.** Usually benign, because the winner's PUT
   carries the loser's rows (same file). But if the loser COMMITTED after the winner's PUT and
   before its own HEAD, those rows are not in R2, the sync is refused, and the re-heal then
   **discards them** (T6160 decision 2: the refused in-flight edit is dropped, never merged).
   In this incident that was a quest achievement (trivial). The same window on a keyframe
   `POST /actions` write silently drops a real user edit.
4. **Wasted R2 traffic + a cost the re-drain then repeats** on a system already latency-bound.

## Solution

**Make the CAS decision under the same lock that serialises the upload, and teach the guard to
recognise this process's own write.** Cross-machine CAS is untouched - R2 object metadata
remains the source of truth and the refusal does not weaken. It only stops a process racing
itself.

AS SHIPPED (two halves - half 2 is NOT optional, see the landmine):
1. The version decision + WAL checkpoint + PUT all run INSIDE the upload lock
   (`_sync_profile_db_locked` / `_sync_user_db_locked`). This also closes the reverse
   interleave, where both syncs HEAD the same version and PUT the same `new_version` - a
   version collision other machines' CAS relies on.
2. `_OWN_UPLOAD_VERSIONS` records the version this process last PUT per R2 key, written under
   the lock BEFORE releasing it; the refusal is skipped when `r2_version` EQUALS that value.

**LANDMINE - why re-reading the baseline under the lock does NOT work (first attempt,
rejected):** the caller's `set_local_db_version` runs AFTER the primitive returns, i.e. OUTSIDE
the lock. A sync that waited on the lock therefore still re-reads the OLD baseline. Worse,
raising `current_version` to the process high-water mark changes `new_version` for every caller
and broke 11 existing tests (`test_version_conflict`, `test_t6160`, `test_t6340`). The shipped
fix NEVER mutates the baseline - equality against our own recorded upload, nothing else.

**Non-negotiable (T4310/T4315/T6340 all exist because these were violated):**
- Do NOT weaken or add a fallback to the CAS refusal. A genuinely stale baseline must still refuse.
- Do NOT auto-merge, force-push, or blind-retry.
- Do NOT advance the baseline on a refusal.
- Do NOT add a per-request HEAD (T6160) - the HEAD count per sync stays exactly one.
- Keep the success path silent (T2880/T3380).

Design notes:
- `get_upload_lock(user_id, "profile")` is a `threading.Lock`, i.e. per-process - exactly the
  scope of this race.
- The primitive already receives `user_id` + `profile_id`, so it can re-read the baseline
  itself; `storage` cannot import `database` at module scope (circular), so use the existing
  inline-import pattern (`from .user_context import ...` at `:1251`).
- `current_version` stays a parameter (every caller/test passes it); the re-read under the lock
  refreshes it. Callers that pass `skip_version_check=True` (request-thread `create_profile`,
  `_migrate_profile_db`) keep skipping the HEAD - the T1020/T2720 no-HEAD guarantee is unchanged.
- The `lock_timeout` bail-out (T2720, `:1288-1295`) must still bail BEFORE the HEAD, so a
  deferred sync costs no R2 call.
- The T5920 WAL checkpoint currently sits between the decision and the lock; keep it ordered so
  the uploaded bytes are still checkpointed, and re-verify `checkpoint_busy` still returns
  `(False, None)` -> `SyncResult.FAILED` (never CONFLICT).
- Consider whether the loser, on finding the baseline advanced and its file unchanged, should
  skip a redundant byte-identical PUT (T1537: concurrent same-key PUTs cause 429s). Correctness
  first; only add if it falls out cleanly.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/storage.py` - `sync_database_to_r2_with_version` (:1142-1326) and
  `sync_user_db_to_r2_with_version` (:1482-1605); the decision/lock ordering to fix
- `src/backend/app/database.py` - `sync_db_to_r2_explicit` (:1585) / `sync_db_to_cloud` (:1511)
  baseline reads; `schedule_profile_db_reheal` (:644)
- `src/backend/app/middleware/db_sync.py` - `retry_pending_sync` (:372) baseline read,
  `_background_sync` (:983), `_redrain_failed_sync` (:1259) lock probe
- `src/backend/tests/test_t6402_cas_self_race.py` - NEW, red-first
- Existing CAS tests that pin the current contract and must stay green:
  `test_t4310_*.py`, `test_t4315_*.py`, `test_version_conflict.py`, `test_t6160*.py`,
  `test_t6340_migration_sync_baseline.py`, `test_t6390_marker_scoping.py`, `test_sync_retry.py`,
  `test_export_worker_sync.py`, `test_performance.py`

### Related Tasks
- Follows: T6390 (its diagnostics produced this diagnosis; first real use)
- Related: T4310 (CAS on), T4315 (restore-if-newer), T6160 (re-heal), T6340 (baseline on swap),
  T5870 (re-drain + lock probe), T1537/T1539 (same-key PUT 429s)
- Not a duplicate of T6350 (move half-apply) - different failure, same subsystem

### Technical Notes
The incident's own log window was already gone when investigated (`flyctl logs --no-tail`
retains ~100 lines / ~2.5 min, and the machine had autosuspended) - the same retention limit
T6390 documented. The diagnosis therefore rests on the marker diag payload + code reading, and
the fix must be pinned by a deterministic test rather than by log archaeology.

## Implementation

### Steps
1. [x] Red-first test: two concurrent syncs of one profile in one process, second HEAD ordered
       after the first PUT -> today produces `SyncResult.CONFLICT` + a conflict marker; must
       become two successes (2735, 2736) with no marker.
2. [x] Red-first test: the loser's post-PUT-committed rows are not discarded.
3. [x] Move the baseline re-read + HEAD + `new_version` inside the upload lock in
       `sync_database_to_r2_with_version`.
4. [x] Same for `sync_user_db_to_r2_with_version`.
5. [x] Verify a GENUINELY stale baseline (another machine ahead) still refuses, still marks the
       conflict, still does not advance the baseline.
6. [x] Verify `lock_timeout` bail-out still precedes the HEAD, and `skip_version_check=True`
       still issues zero HEADs.
7. [x] Run the full existing CAS/sync test set listed above.
8. [x] Update `.claude/knowledge/persistence-sync.md` with the invariant.

### Progress Log

**2026-08-03**: Filed from a live staging incident. Root cause identified by code reading +
T6390 diag payload; incident logs already rotated out (`flyctl logs --no-tail` retained only
19:53:57-19:56:19Z and ended with the machine autosuspending, so the incident window was gone
- it did confirm user `3ed03fb5...` / profile `9fa7378c` / machine `d8933d5f417308`).

IMPLEMENTED on `feature/T6402-cas-self-race`. Red-first test reproduced all 4 self-conflict
shapes; fix landed in two halves (decision moved inside the upload lock + `_OWN_UPLOAD_VERSIONS`
equality exemption). **A first attempt that RAISED `current_version` to the process high-water
mark was rejected** - it changes `new_version` for every caller and broke 11 existing tests
(test_version_conflict / test_t6160 / test_t6340); the shipped version never mutates the
baseline. Green: 11 new + 120 across the CAS suites + 79 across the broader sync suites.
Two pre-existing failures confirmed on clean master via a throwaway worktree and NOT caused by
this change: (a) `test_t6340`'s Windows unlink-while-open helper bug - FIXED here since it
blocked local verification; (b) `test_user_activity_sync` / `test_session_pinning` erroring on
the local dev Postgres `shares_share_type_check` constraint (the known T6345 migration-gap
family) - left alone, out of scope.

Awaiting user review + merge. Not merged (no merge without approval).

## Acceptance Criteria

- [x] Two concurrent syncs of the same profile in one process never produce a CAS conflict
- [x] A genuinely stale baseline (R2 moved ahead by another writer) STILL refuses, marks the
      conflict, and does not advance the baseline
- [x] Exactly one HEAD per sync attempt; zero when `skip_version_check=True`; none on the
      `lock_timeout` bail-out
- [x] No fallback / auto-merge / force-push / blind-retry introduced anywhere
- [x] `user.sqlite` twin fixed identically
- [x] Existing CAS + sync suites green (list under Relevant Files)
- [x] Knowledge doc updated
