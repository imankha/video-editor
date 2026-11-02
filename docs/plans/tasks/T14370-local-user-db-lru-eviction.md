# T14370: Local user-DB cache grows without limit (LRU eviction)

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Tier:** L (design gate)
**Created:** 2026-10-31
**Updated:** 2026-11-02

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

Nothing evicts `USER_DATA_BASE` (`database.py` ~40, `/user_data` on the root filesystem, no volume). Dev average profile.sqlite is ~258 KB (max 368 KB); prod DBs are likely heavier. At 10K users (~13K profiles) that is 3 to 13 GB plus WAL and the export/download temp files on the same disk; a full disk makes every SQLite write fail.

## Solution

Split out of T14160 on 2026-11-02 (user's call). T14160 shipped the prerequisite guards: a missing file never keeps a cached version, the version helpers and the upload checkpoint never create a file, and sweep Phase 2 fails closed on a missing DB.

The eviction design is [T14160-design.md](T14160-design.md) (awaiting approval):
- per-user holds under one eviction lock;
- a write-sequence clean proof, with the sequence captured before the checkpoint;
- eviction refuses on any marker;
- a byte-budget LRU loop on its own 1-thread executor;
- the sweep's Phase 2 pins its holders;
- the privacy export reads every profile through `open_profile_db_readonly`.

A connection- or request-scoped refcount is not enough; the design says why.

## Context

### Relevant Files
- `src/backend/app/database.py`
- `src/backend/app/services/user_db.py`, `app/storage.py`, `app/middleware/db_sync.py`, `app/services/materialization.py`, `app/main.py`, `app/routers/privacy.py`, new `app/services/db_residency.py`
- `src/backend/app/services/sweep_scheduler.py` (Phase 2 missing-local handling)

### Notes
Load: persistence-sync.md. Blocked By: T14160 (guards). T14140 and T14150 are in STAGING. Measure first on prod: `fly ssh console -C "df -h / && du -sh /user_data"`, bytes per active user.

## Acceptance Criteria

- [ ] Prod disk-per-user measurement recorded
- [ ] Eviction never removes an open or pending DB (test)
- [ ] Disk stays bounded under a synthetic 10K-profile touch pattern
