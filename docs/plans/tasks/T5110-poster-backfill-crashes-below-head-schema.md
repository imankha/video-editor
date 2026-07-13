# T5110: Poster backfill crashes on any profile below head schema (enumeration mismatch)

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

`backfill_posters` (`POST /api/admin/backfill-share-posters`, T4890/T4950) aborts the
ENTIRE run with `sqlite3.OperationalError: no such column: poster_filename` when it
reaches any profile DB below head schema. Hit on prod 2026-07-13 while backfilling
posters after the v024 migration.

Root cause is an enumeration mismatch between two code paths:
- `run_all_migrations` enumerates profiles and **filters by the profile registry**,
  deliberately SKIPPING orphans ("not in registry", a T4830 decision). So orphan
  profiles never get v024.
- `backfill_posters` (poster.py ~226) enumerates via **unfiltered `_get_profile_ids`**
  (which includes those orphans) and calls `ensure_database()` — but `ensure_database`
  only does `CREATE TABLE IF NOT EXISTS`, it does NOT run versioned migrations. So the
  `... WHERE poster_filename IS NULL` candidate query (poster.py ~236) references a
  column that doesn't exist on the un-migrated orphan → crash, before any real profile
  is processed.

Prod impact was concrete: two 0-reel orphans (`f05d1b29/fca4f373`,
`3ed03fb5/b95eb93b`) crashed the whole backfill. Manual unblock: ran
`_migrate_profile_db(uid, pid)` on each orphan first, then the backfill completed
(58/58 reels). But the next person to hit the admin endpoint will crash again.

## Solution

Make the backfill self-sufficient per CLAUDE.md ("Migrations must be self-sufficient:
if they depend on another migration's data, run that migration as a prerequisite").
Options, in preference order:

1. **Migrate each profile to head before querying** — inside the backfill loop, after
   `ensure_database()`, apply the profile_db migration runner (or reuse
   `_migrate_profile_db`) so every profile the backfill touches is at head. This also
   fixes the orphan gap as a side effect (orphans get v024 too). Matches the
   correct-data principle: the invariant "every profile DB is at head" should hold.
2. **Align enumeration with the migration** — filter `backfill_posters` to registered
   profiles (same source `run_all_migrations` uses), so it never touches orphans. This
   avoids the crash but leaves orphans below head (acceptable only if orphans truly
   never serve reels). Weaker: it's a scoping workaround, not a data fix.

Prefer (1). Whichever is chosen, a below-head or column-missing profile must NOT abort
the whole run — wrap the per-profile candidate query so one bad profile is recorded in
`result["failed"]` (the docstring already promises "never raises per-row"; that guarantee
currently does not cover the schema/candidate-query failure) and the sweep continues.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/poster.py` — `backfill_posters` (enumeration loop ~221-239,
  candidate_sql ~234, per-profile error handling)
- `src/backend/app/migrations/__init__.py` — `_migrate_profile_db` (reusable per-profile
  migrate-to-head), `_get_profile_ids`, the registry-filter in `run_all_migrations`
- `src/backend/app/database.py` — `ensure_database` (confirm it does not run migrations)
- `src/backend/app/routers/admin.py` — the backfill endpoint wrapper

### Related Tasks
- T4890 (poster feature) / T4950 (prod rollout) — this hardens their backfill path
- T4830 (orphan profiles) — why orphans exist / are registry-skipped
- T4970 (admin enumeration misses segmentless users) — sibling enumeration-consistency bug

### Technical Notes
- Reproduce by pointing a throwaway env's backfill at a profile left below head (or add a
  fake orphan at an old `user_version`); assert the run completes and records the bad
  profile in `failed` instead of raising.
- See memory "poster-backfill-orphan-gotcha" for the prod incident detail + the
  migrate-first unblock recipe.

## Acceptance Criteria

- [ ] `backfill_posters` completes across all profiles even when one is below head schema
      (bad profile recorded in `failed`, not a hard crash)
- [ ] Preferred: every profile the backfill touches is migrated to head first
- [ ] Regression test covering a below-head/column-missing profile in the sweep
