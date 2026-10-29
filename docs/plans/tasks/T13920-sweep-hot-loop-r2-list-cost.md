# T13920: Expiry sweep hot-loops every ~110s and burns R2 Class A on profile listing

**Status:** WIP
**Impact:** 8
**Complexity:** 3
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

Cloudflare billing alert 2026-10-29: 2.11M R2 Class A operations in the first 12 days of the
Oct 18 to Nov 17 cycle ($9.00, projected ~$29 for the cycle). Live prod logs (2026-10-29 15:43
to 15:47 UTC) show the cause is the game-storage expiry sweep, not user activity:

```
15:44:27 [Sweep] Complete in 49.06s (refs=24, grace_deleted=0)
15:44:27 [Sweep] Next run in 0.0h
15:46:16 [Sweep] Complete in 49.56s (refs=24, grace_deleted=0)
15:46:17 [Sweep] Next run in 0.0h
```

In a 4-minute sample: 881 `ListObjectsV2` (Class A), 112 HeadObject, 28 PutObject. That is
~3.7 Class A/s, ~260-320K/day. A census of every R2 object written since Oct 18 (all envs)
estimates only ~22K Class A for all real user activity (uploads, exports, posters, DB syncs).

### Mechanism

1. 24 game_storage refs are past `storage_expires_at`. Since T10121 (2026-09-15) the sweep
   refuses to reclaim when recap artifacts are MISSING (`ReclaimVerdict.KEEP_ARTIFACTS_MISSING`),
   logs "keeping ref to retry next sweep", and leaves the ref in place.
2. `get_next_expiry()` (`services/auth_db.py`) returns `MIN(storage_expires_at)` over
   `game_storage_refs` (and `MIN(grace_expires_at)` over `r2_grace_deletions`). The kept refs
   are in the past, so `delay` is negative and `_run_sweep_loop` clamps it to
   `MIN_DELAY = 60`. The sweep runs, sleeps 60s, runs again, forever.
3. Each run calls `migrations._get_profile_ids(user_id)` (one `ListObjectsV2` with
   `Delimiter="/"`) for EVERY user in Phase 1, and again for every user inside
   `_count_refs_all_profiles`, `_expire_game_storage_all_profiles` and
   `_phase2_artifact_gate_missing` per grace hash in Phase 2: ~300 lists per run.

Deferred grace rows (`DEFER delete ... keeping grace row to retry next sweep`) with a past
`grace_expires_at` cause the same clamp.

## Solution

Two independent changes, both in `services/sweep_scheduler.py` (+ `get_next_expiry` if the
query is the cleanest place):

1. **Reschedule:** a retry of something the sweep deliberately KEPT must not run on the 60s
   floor. When the next expiry is already in the past (the soonest item is a kept/deferred
   retry), schedule at a retry interval (1h, matching the existing "Error, retrying in 1h"
   cadence) instead of `MIN_DELAY`. A genuinely future expiry still schedules precisely (the
   60s floor stays for expiries that land within a minute). Keep it explicit and greppable,
   e.g. a named `KEPT_RETRY_DELAY = 3600`.
2. **List once per sweep:** resolve each user's profile ids once per `do_sweep()` run and
   pass the mapping to the Phase 2 helpers instead of calling `_get_profile_ids` per user per
   hash. Phase 1 behavior (JIT `ensure_database` per profile, `MigrationBlocked` skip) is
   unchanged.

Not in scope: the 24 stuck refs themselves (T13940), R2 usage attribution (T13930).

## Context

### Relevant Files
- `src/backend/app/services/sweep_scheduler.py` - `_run_sweep_loop`, `do_sweep`, Phase 2 helpers
- `src/backend/app/services/auth_db.py` - `get_next_expiry` (line ~643)
- `src/backend/app/migrations/__init__.py` - `_get_profile_ids` (the ListObjectsV2 call)
- `src/backend/tests/` - existing sweep tests (grep `sweep_scheduler`)

### Knowledge Docs
- `.claude/knowledge/backend-services.md`
- `.claude/knowledge/persistence-sync.md` (JIT seam; do not change `ensure_database` semantics)

### Related Tasks
- T13930 (R2 usage attribution) - would have caught this on day one
- T13940 (investigate the 24 kept refs)
- T10121 (introduced KEEP_ARTIFACTS_MISSING; its safety gate must stay intact)

## Acceptance Criteria

- [ ] Regression test (written first, red on master): with an expired ref that the sweep KEEPS, the loop's computed next delay is the kept-retry interval, not 60s.
- [ ] A future expiry still schedules at its exact time (60s floor only for near-future items).
- [ ] Test (red on master): one `do_sweep()` with N users and M grace hashes calls `_get_profile_ids` at most once per user.
- [ ] T10121 safety behavior unchanged (existing sweep tests stay green: keep on MISSING, DEFER grace delete, abandon when exhausted).
- [ ] Ruff clean on touched files.
- [ ] Post-deploy check (record in Progress Log): prod logs show `[Sweep] Next run in 1.0h` and ListObjectsV2 rate drops to near zero between sweeps.

## Progress Log

**2026-10-29**: Filed from the Cloudflare billing-alert root cause (prod log sample + R2 census).
