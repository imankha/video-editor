# T14140: Expiry sweep walks every user and profile

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Tier:** L
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

`services/sweep_scheduler.py` ~171-180 lists R2 for every user (`_get_profile_ids`, ListObjectsV2) and then calls `ensure_database()` on EVERY profile: a download plus JIT migration even for idle accounts, which contradicts the long-tail rule in CLAUDE.md (an account migrates when its owner next comes online). Phase 2 (~354-445, ~705-735) walks every profile per grace hash. Measured 49 s per run at today's size (T13920 log); retries run hourly while anything is kept (`KEPT_RETRY_DELAY=3600`). At 10K: roughly 30 to 60+ min per run, so it runs almost nonstop; ~10K ListObjectsV2 per run (~7M Class A a month, the T13932 alert fires). It also makes every account's DB local, which drives T14150 and T14160.

## Solution

Select Phase 1 candidates from Postgres `game_storage_refs WHERE storage_expires_at <= now()` (it already carries user_id and profile_id) and Phase 2 candidates via `idx_game_refs_hash`; open only those SQLite DBs through the JIT seam. FIRST prove the Postgres mirror is complete against the SQLite source of truth, because the delete is irreversible. L-tier: design gate before implementation.

## Context

### Relevant Files
- `src/backend/app/services/sweep_scheduler.py`
- `src/backend/app/services/pg.py` (game_storage_refs, idx_game_refs_hash)
- `src/backend/tests/` (sweep candidate selection)

### Notes
Load: persistence-sync.md, backend-services.md. Related (partial, none removes the O(users) walk): T13920 (list once per sweep, stop the hot loop), T13940, T2650 (move sweep ffmpeg to Modal). Prerequisite for T14160.

## Acceptance Criteria

- [ ] Design approved (mirror-completeness proof plan included)
- [ ] A sweep with 10K synthetic users and a handful of expiring games opens only the expiring profiles (test counts ensure_database calls)
- [ ] ListObjectsV2 per sweep no longer scales with user count (T13930 usage shards)
- [ ] Idle accounts are not migrated by the sweep
