# T1170: Size-Based VACUUM on Init

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

VACUUM currently runs unconditionally inside `cleanup_database_bloat()`, which fires once per user per server lifetime during `user_session_init()`. Two issues:

1. **Wasted work on small DBs** — VACUUM rewrites the entire database file. For a 50KB DB, the overhead (lock, rewrite, fsync) is pointless since the file is already small.
2. **No re-trigger** — If a user's DB grows past threshold during a long server lifetime, VACUUM won't run again until the next server restart. A size-based check on init would catch DBs that have grown since last cleanup.

## Solution

Replace the unconditional VACUUM in `cleanup_database_bloat()` with a size check:

```python
# In cleanup_database_bloat(), replace the final VACUUM block:
db_size = db_path.stat().st_size
VACUUM_THRESHOLD = 400 * 1024  # 400KB — matches the existing warning threshold

if db_size > VACUUM_THRESHOLD:
    logger.info(f"[Cleanup] DB size {db_size / 1024:.0f}KB exceeds {VACUUM_THRESHOLD // 1024}KB — running VACUUM")
    conn.execute("VACUUM")
    new_size = db_path.stat().st_size
    logger.info(f"[Cleanup] VACUUM complete: {db_size / 1024:.0f}KB -> {new_size / 1024:.0f}KB ({(db_size - new_size) / 1024:.0f}KB freed)")
else:
    logger.debug(f"[Cleanup] DB size {db_size / 1024:.0f}KB under threshold, skipping VACUUM")
```

The 400KB threshold aligns with the existing `SIZE_WARNING_THRESHOLD` in `database.py:53`.

## Context

### Relevant Files
- `src/backend/app/services/project_archive.py:341` — `cleanup_database_bloat()` (modify VACUUM logic)
- `src/backend/app/session_init.py:130` — where cleanup is called (once per user per server lifetime)
- `src/backend/app/database.py:53` — size thresholds (400KB warning, 768KB critical)

### Related Tasks
- T1160: Clean up unused DB rows (runs in same cleanup function)
- T1020: Fast R2 sync (smaller DB = faster upload)

## Acceptance Criteria

- [ ] VACUUM only runs when profile.sqlite exceeds 400KB
- [ ] Pre/post sizes logged when VACUUM runs
- [ ] Small DBs skip VACUUM with debug log
- [ ] Threshold constant defined near existing size constants
