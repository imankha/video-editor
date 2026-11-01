# T14160: Local user-DB cache grows without limit

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

Nothing evicts `USER_DATA_BASE` (`database.py` ~40, `/user_data` on the root filesystem, no volume). Dev average profile.sqlite is ~258 KB (max 368 KB); prod DBs are likely heavier. At 10K users (~13K profiles) that is 3 to 13 GB plus WAL and the export/download temp files on the same disk; a full disk makes every SQLite write fail.

## Solution

LRU-evict DBs that are closed and have no pending-sync marker. Phase 2 of the sweep treats a missing local DB as "not authoritative", so it must change together with T14140 or eviction silently stops reclamation.

## Context

### Relevant Files
- `src/backend/app/database.py`
- `src/backend/app/services/user_db.py` / db_sync.py
- `src/backend/app/services/sweep_scheduler.py` (Phase 2 missing-local handling)

### Notes
Load: persistence-sync.md. Depends on T14140 and T14150. Measure first on prod: `fly ssh console -C "df -h / && du -sh /user_data"`, bytes per active user.

## Acceptance Criteria

- [ ] Prod disk-per-user measurement recorded
- [ ] Eviction never removes an open or pending DB (test)
- [ ] Disk stays bounded under a synthetic 10K-profile touch pattern
