# T14380: Local user-DB cache grows without limit (LRU eviction)

**Status:** STAGING
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

The eviction design is [T14160-design.md](T14160-design.md) (approved by the user on 2026-11-02, with additions: structural holds, race tests, Zipf bound, own executor, fail loud):
- per-user holds under one eviction lock;
- a write-sequence clean proof, with the sequence captured before the checkpoint;
- eviction refuses on any marker;
- a byte-budget LRU loop on its own 1-thread executor;
- the sweep's Phase 2 pins its holders;
- the privacy export reads every profile through `open_profile_db_readonly`.

A connection- or request-scoped refcount is not enough; the design says why.

## Configuration: DB_CACHE_HIGH_WATER_BYTES (required, no default)

Eviction runs only when `DB_CACHE_HIGH_WATER_BYTES` is set (and R2 is enabled). Unset, startup logs an ERROR and the cache keeps growing as before. No guessed number lives in code: the user chose "required env, no default" on 2026-11-02, because the measurement request arrived with its template placeholders unfilled.

**Prod measurement (2026-11-02, the one prod machine):**

```
fly ssh console -a reel-ballers-api -C "sh -c 'df -B1 /; du -sb /user_data; ls /user_data | wc -l'"
```

| | Bytes |
|---|---|
| Root size `S` | 8,350,298,112 |
| Root used `U` | 220,819,456 |
| `/user_data` `D` | 106,946,560 |
| User dirs `N` | 370 |
| Per user `D / N` | ~289,000 (largest user 1.8 MB) |

Staging has the same 8,350,298,112-byte rootfs.

Result: `S − (U − D)` = 8,236,425,216. The 50% cap gives 4,118,212,608, and the temp reserve (2 GB + 1 GB) gives 5,015,199,744, so the mark is 4,118,212,608, rounded down to **4,000,000,000**. At ~289 KB per user, 10K users would be ~2.9 GB, under the mark.

**Setting the mark.** `/user_data` shares the root filesystem with export and download temp files and the image itself.
- High water = `min(0.5 × (S − (U − D)), S − (U − D) − T_peak − 1 GB)`.
- `U − D` is the non-DB baseline.
- `T_peak` is the export temp peak: concurrent exports × the largest per-export working set, about 2 GB unless measured.
- The 50% cap keeps half the free space for temp files even when exports are idle.
- A pass that has to evict goes down to 0.8 × high water, so there is a further 20% of slack between passes (every 120 s).

It is set in the `[env]` section of `src/backend/fly.staging.toml` and `src/backend/fly.production.toml`, not as a Fly secret. It is not secret, so it lives in git, ships with every deploy, and every machine Fly creates for the app gets it. To change it, edit both files and redeploy. Then watch for `[DB_EVICT] loop started: high water ...` at startup, the `[DB_EVICT] pass` INFO lines, and the above-high-water WARNING.

## Context

### Relevant Files
- `src/backend/app/database.py`
- `src/backend/app/services/user_db.py`, `app/storage.py`, `app/middleware/db_sync.py`, `app/services/materialization.py`, `app/main.py`, `app/routers/privacy.py`, new `app/services/db_residency.py`
- `src/backend/app/services/sweep_scheduler.py` (Phase 2 missing-local handling)

### Notes
Load: persistence-sync.md. Blocked By: T14160 (guards). T14140 and T14150 are in STAGING. Measure first on prod: `fly ssh console -C "df -h / && du -sh /user_data"`, bytes per active user.

## Acceptance Criteria

- [x] T14380:C1 Prod disk-per-user measurement recorded, and `DB_CACHE_HIGH_WATER_BYTES` set from it (fly.*.toml `[env]`, 2026-11-02; confirm the startup log line after deploy)
- [ ] T14380:C2 Every opener of a per-user DB goes through the held helper (structural scan test)
- [ ] T14380:C3 Eviction never removes a held, marked or dirty DB; every skip logs its reason (test)
- [ ] T14380:C4 A commit between the upload checkpoint and the clean mark keeps the DB dirty, including through a symlinked base and a raw writer (test)
- [ ] T14380:C5 An evict pass racing a request never serves an empty DB or uploads fewer rows (test)
- [ ] T14380:C6 An evicted user re-pulls user.sqlite and every profile through the JIT seam (test)
- [ ] T14380:C7 Disk stays at or below high water under a Zipf touch pattern over 10K profiles (test)
- [ ] T14380:C8 The loop runs on its own 1-worker executor; high water is required (test)
- [ ] T14380:C9 Fail loud: an unlink failure logs ERROR and keeps state; a pass above high water logs WARNING (test)
- [ ] T14380:C10 Sweep Phase 2 pins its holders; the privacy export reads profiles that are not cached (test)
