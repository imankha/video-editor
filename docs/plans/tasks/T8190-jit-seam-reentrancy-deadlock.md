# T8190: P0 - JIT migration seam self-deadlocks (any migration writing via get_db_connection)

**Status:** WIP

**2026-08-31 fix implemented.** Root cause confirmed via bug-reproduction (failing test
first, real deadlock reproduced with a bounded thread-join so the test fails fast instead of
hanging): `run_profile_seam`/`run_user_seam` now track same-thread re-entrancy
(`_seam_in_progress`) so a migration's own nested `ensure_database()` call for the profile
already being migrated passes straight through instead of re-acquiring a lock this thread
holds, AND acquire the lock with `SEAM_LOCK_TIMEOUT_S=30` for genuine cross-thread
contention, raising `MigrationBlocked` (503) on timeout instead of hanging forever.
Root-caused BOTH offending migrations (v017 was a second, previously-unnoticed instance of
the exact same bug, found by the static guard): `auth_db.insert_game_storage_ref` split into
`upsert_game_storage_row(conn, ...)` (SQLite, caller's own connection) +
`insert_game_storage_ref_pg_only(...)` (Postgres, never touches SQLite/the seam); v017 and
v047 now call these instead of the full `insert_game_storage_ref` (which re-enters
`get_db_connection` -> `ensure_database` -> the seam). 4/4 new tests green (deadlock
reproduction, positive-outcome version check, cross-thread timeout, static guard) + 191
existing relevant tests green (seam, migration, storage-ref, activate, materialization,
shared-game suites) with zero regressions.
**Impact:** 10
**Complexity:** 4
**Created:** 2026-08-31

## Problem

**The JIT migration seam (T5083/T5085) permanently wedges the API process** whenever it has
to apply a migration whose `up()` writes through the app's normal connection helper. Observed
live on staging 2026-08-31: the whole app stopped answering — including `/api/health`, which
touches no DB — and never recovered until the machine was restarted.

This is the exact self-deadlock the T5085 review documented as a LANDMINE and marked
"not yet hit in prod" (`app/migrations/__init__.py`, the `_migration_locks` comment). It has
now been hit.

### Mechanism (confirmed, not theorized)

1. `ensure_database()` calls `migrations.run_profile_seam(user, profile)` (database.py:1162).
2. `run_profile_seam` takes the **non-reentrant** `threading.Lock` for `(user, profile)` and
   runs the pending migrations. It only short-circuits on `(user, profile) in _seam_verified`,
   which is NOT yet set while the migration is still running.
3. `profile_db/v047_backfill_game_storage_refs.py` calls `insert_game_storage_ref` per row.
4. `insert_game_storage_ref` (`services/auth_db.py:371-373`) does
   `from ..database import get_db_connection` → `with get_db_connection()`.
5. `get_db_connection()` (database.py:1714) calls `ensure_database()` **again** → back into
   `run_profile_seam(user, SAME profile)` → `lock.acquire()` on a lock this thread already
   holds → **deadlock with no timeout**.
6. Every later request for that user blocks on the same lock, exhausting the anyio thread
   pool, after which unrelated endpoints (`/api/health`) also stop responding. The process
   never recovers on its own.

Smoking gun in the staging logs (21:47:34 UTC, then total silence):
```
[Migration] Applying v047: Backfill Postgres game_storage_refs ...
R2 enabled: skipping local video directory creation      <-- ensure_database RE-ENTERED
(nothing, forever)
```

### Blast radius

- Triggers for any profile DB **below head** that has `game_storage` rows (v047's guard is
  `if not rows: return`, so empty profiles slip through — which is why light test accounts
  looked fine).
- **Prod is currently DORMANT, verified**: every one of the **56 prod accounts / 60 profiles**
  is at `profile_db` v48 = head (full paginated read-only sweep 2026-08-31 via
  `/api/admin/migration-status?user_id=` — note `/api/admin/users` pages at 50, so a
  single-page check under-reports and must not be trusted for fleet claims). JIT therefore has
  nothing to apply and cannot trigger the deadlock today. **The bomb is armed for the next
  migration that ships** — the first post-JIT migration will hit every account's seam at once.
- `v047` is not special. The bug is structural: **any** migration whose `up()` reaches
  `get_db_connection` / `get_user_db_connection` re-enters the seam. Audit v048 and every
  future migration.
- The bulk sweep (`run_all_migrations`) may share the fault via the same primitives — verify
  before recommending it as the workaround.

## Solution

Bug-reproduction skill: failing test FIRST (it reproduces without a network — a below-head
temp profile DB with one `game_storage` row plus a migration that calls `get_db_connection`
deadlocks the seam; give the test a hard timeout so a regression fails instead of hanging CI).

Design options, to be chosen at implementation (favor 1+3 together):

1. **Make the seam re-entrant for the SAME key.** Track the owning thread
   (`threading.RLock`, or an explicit `_seam_in_progress: set[(key, thread_id)]`) so a
   migration's own nested `ensure_database()` for the profile being migrated passes straight
   through instead of blocking. This is the minimal correct fix: the nested call is the same
   thread, mid-migration, and must not re-run the seam.
2. **Give migrations a connection that bypasses the seam.** The `up(conn)` connection already
   exists; migrations should never re-open the DB through the request-path helper. Provide an
   explicit `migration_db_connection()` and forbid `get_db_connection` inside `up()`.
3. **Never deadlock silently.** Acquire with a timeout (`lock.acquire(timeout=N)`) and raise
   `MigrationBlocked` (→ 503 `pending_migration`) on expiry. A wedged process that needs a
   manual restart is far worse than a loud, retryable failure — and matches the fail-loud
   contract JIT already claims.
4. **Static guard:** a test that greps/imports every `migrations/**/v*.py` and fails if `up()`
   reaches `get_db_connection`/`insert_game_storage_ref`-style helpers, so the next migration
   can't reintroduce this.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/__init__.py` — `_migration_locks`, `_get_migration_lock`,
  `run_profile_seam` (362), `run_user_seam` (429), and the LANDMINE comment (~56-72)
- `src/backend/app/database.py` — `ensure_database` (1030), seam call (1162),
  `get_db_connection` (1702, calls `ensure_database` at 1714)
- `src/backend/app/services/auth_db.py` — `insert_game_storage_ref` (364)
- `src/backend/app/migrations/profile_db/v047_backfill_game_storage_refs.py` (the trigger)
- `src/backend/app/migrations/profile_db/v048_cleanup_sweep_orphan_raw_clips.py` (audit)

### Related Tasks
- T5083 (JIT seam), T5085 (extended the seam to non-login openers — wrote the landmine
  comment), T5087 (would delete the bulk sweep — **do not ship T5087 until this is fixed**;
  the bulk path may be the only working migration route today)
- JIT Migration epic: [EPIC.md](jit-migration/EPIC.md)

### Operational note (staging, 2026-08-31)
Staging's 3 gate accounts were re-seeded from dev, which copies **below-head** dev DBs into
staging; the first login then wedged the machine on v047. Staging will re-wedge on the next
login for those accounts until this is fixed or the seeded DBs are brought to head. The
staging gate run is blocked on this.

## Implementation

### Steps
1. [x] Failing test with a hard timeout (nested `get_db_connection` inside a migration)
2. [x] Same-thread re-entrancy fix + timeout-instead-of-hang
3. [x] Audit every existing migration's `up()` for seam re-entry; fix v047 (and v017, found by
       the audit) to use their own conn + the new Postgres-only helper
4. [x] Static guard test for future migrations
5. [x] Unwedge staging: the 3 gate accounts were replaced with fresh prod-derived copies
       (already at head) during the same session's account cleanup; re-verified login clean

## Acceptance Criteria

- [x] A migration that opens `get_db_connection` inside `up()` completes instead of deadlocking
- [x] A genuinely un-acquirable seam lock raises `MigrationBlocked` (503) within N seconds,
      never hangs the process
- [ ] `/api/health` keeps responding while a long migration runs — not independently verified
      (the fix removes the mechanism that starved the thread pool; no dedicated test added)
- [x] Static guard fails a newly-added migration that re-enters the seam
- [x] Staging accounts reach head and log in cleanly (verified via the prod-copy cleanup)
