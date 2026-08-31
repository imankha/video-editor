# T5083: JIT migrate at the per-user load seam

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 6
**Created:** 2026-08-04 (carries the 2026-07-13 T5080 scope)
**Updated:** 2026-08-31

Epic child 2/5 — see [EPIC.md](EPIC.md) for goal, the 8 settled design decisions, shared invariants,
and both field-findings sections. **Architect design gate** (`docs/plans/tasks/T5083-design.md`).

## Problem

Migrations run today only when an admin triggers `run_all_migrations()` after a deploy. Miss it and
accounts sit at old schema versions until someone notices (T4820/T4830 both traced to exactly that).
Run it against a live machine and the serving process's baseline goes stale, breaking the next
writer (2026-08-04). Neither failure is visible until a user hits it.

The single-user primitive already exists: `_migrate_user(user_id)` migrates one user's `user.sqlite`
plus every registered profile, and the bulk runner is just a loop over it. This task **relocates the
call to the per-user DB-load seam** — it is not new migration logic.

## Solution

### 1. Design (Architect, user-gated)

Produce `docs/plans/tasks/T5083-design.md` covering:

- **Trigger & seam.** `_migrate_user` / `_migrate_profile_db` at `ensure_user_database` /
  session-init first-access restore, **before any connection for that (user, profile) opens** and
  before the first read. Show the exact call ordering against today's restore path, and how it
  composes with T5070's update flow (first authed request after a refresh migrates the user).
- **Baseline coherence.** In-memory `_user_db_versions`, the file's `db_version` row, and R2 metadata
  advance in one path (EPIC decision 1). `_migrate_profile_db` already records the downloaded sync
  version via `set_local_db_version`; confirm nothing bypasses it.
- **Concurrency & idempotency.** Two concurrent requests for the same (user, profile) must not both
  migrate or both upload. Reuse `_get_user_write_lock` in-process. Across processes/machines the lock
  does not apply: define CAS-refusal-on-the-migration-path as re-pull-then-retry-once. T5081 does NOT
  change CAS-refusal handling itself (that idea was explored and abandoned — see T5081's Problem
  section); what it gives this task is a `.sync_pending` marker that is trustworthy per-scope
  (INV-P: exists iff that exact scope may hold committed writes R2 hasn't confirmed, cleared only by
  a confirmed upload or an actual restore-if-newer swap) — so a migration-path re-pull-and-retry can
  safely check "does this profile actually have anything pending" instead of guessing. Migration is
  idempotent under the `user_version` gate — confirm.
- **WAL / `wal_busy`.** The runner swaps the file and refuses when a live connection holds it. At the
  first-access seam no connection should exist yet; specify what happens if one does (block, retry,
  or fail the request) — never serve un-migrated.
- **Unregistered ("orphan") profiles.** State the policy explicitly for a request that opens a
  profile absent from the registry: migrate-then-serve, refuse, or repair the registry. Silently
  serving an unmigrated profile is the failure mode to avoid.
- **Failure handling.** A failing migration fails loud and blocks that user's data access rather than
  serving a half-migrated DB; surface a clear error. No silent fallback to unmigrated data.
- **Performance.** First post-refresh request per user pays a version check; at-head must be a cheap
  no-op (no R2 round trip on the hot path if avoidable — say how). Actual migration cost is paid once
  per user per schema bump.
- **Split.** Postgres stays deploy/admin-triggered; `user_db` + `profile_db` go JIT.

### 2. Implement

Wire the call at the seam per the approved design, preserving T4830's guarantees per-user: canonical
R2 copy (force-download), local-ahead guard, verify-at-head, fail loud.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/__init__.py` — `_migrate_user` (L85), `_migrate_profile_db` (L211,
  including the `wal_busy` refusal at L299 and `set_local_db_version` at L311)
- `src/backend/app/services/user_db.py` — `ensure_user_database` (L122): the JIT seam
- `src/backend/app/session_init.py` — session-init path, profile selection
- `src/backend/app/database.py` — first-access restore, `get_local_db_version` (L524),
  fresh-DB stamping `PRAGMA user_version = PROFILE_DB_RUNNER.latest_version` (L1382)
- `src/backend/app/middleware/db_sync.py` — `_get_user_write_lock` (L228), sync reporting
- Knowledge: [backend-services.md](../../../../.claude/knowledge/backend-services.md),
  [persistence-sync.md](../../../../.claude/knowledge/persistence-sync.md), running-migrations reference

### Related Tasks
- Depends on: **T5081** (clean-copy self-heal — the conflict path this task starts exercising),
  T5070 (DONE, update flow the JIT trigger rides)
- Blocks: T5085, T5087, T5089
- Builds on: T4830 (hardened runner — preserve per-user), motivated by T4820

### Technical Notes
- L-tier, Architect gate. Migration agent NOT needed — no new schema; this changes *when/how*
  existing migrations run, and touches no `vNNN_*.py` file.
- The runner hands `up(conn)` a **tuple** row factory, not `sqlite3.Row` — index positionally
  ([[reference_migration_runner_rowfactory]]).
- Keep the bulk runner working throughout this task; T5087 is the only task allowed to delete it.
- Backend pytest invocation: use CI's `tests/test_*.py --capture=sys` form
  ([[project_backend_pytest_invocation_trap]]).

## Implementation

### Steps
1. [ ] Architect design doc (seam, baseline coherence, concurrency, WAL, orphans, failure, perf,
       split) — **user approval gate**
2. [ ] Wire `_migrate_user` at the seam, preserving T4830 guarantees
3. [ ] Concurrency: serialize same-(user, profile) migration on the existing write lock
4. [ ] CAS refusal on the migration path re-pulls and retries once
5. [ ] Tests: at-head no-op; behind-head migrates to head; concurrent-request safety; `wal_busy` does
       not serve un-migrated; orphan-profile policy; fail-loud blocks access with no half-migrated serve
6. [ ] Verify in staging, then prod: users migrate on access, no missed-sweep bugs, no user-visible
       sync failures attributable to migration

## Acceptance Criteria

- [ ] `user_db` + `profile_db` migrate to head just-in-time at the per-user load seam
- [ ] Migration runs in the serving process and advances cache + file + R2 in one path
- [ ] Migration completes before the first connection for that (user, profile) opens; a `wal_busy`
      refusal blocks or retries and never serves un-migrated data
- [ ] A CAS refusal on the migration path re-pulls and retries once instead of surfacing a failure
- [ ] Concurrency-safe: no double-migrate, no R2 corruption on concurrent same-user requests
- [ ] Unregistered-profile policy implemented and documented
- [ ] Fail-loud: a broken migration blocks that user's data access, never serves half-migrated
- [ ] T4830 guarantees preserved per-user (canonical copy, verify-at-head)
- [ ] Postgres migration path unchanged
- [ ] Tests pass
