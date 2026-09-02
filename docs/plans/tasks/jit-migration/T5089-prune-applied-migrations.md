# T5089: Prune migrations that have run on every account

**Status:** WIP
**Impact:** 5
**Complexity:** 4
**Created:** 2026-08-04 (user direction, added when T5080 became an epic)
**Updated:** 2026-08-04

Epic child 5/5 — see [EPIC.md](EPIC.md). Runs last: the floor can only be proven once JIT is the only
mechanism and the bulk runner is gone.

## Problem

`profile_db` is at v033, `user_db` and `postgres` have their own chains, and essentially all of that
history has been applied to every account that exists. The files are still carried, still imported,
still exercised by tests, and still read by anyone trying to understand the schema — including agents,
who have to scroll a long chain of dead one-shot heals (v021 unpublish sweep, v031 teammate
reclassify, v033 moved-reel attribution heal) to find what is live.

Nothing *breaks* today, but the chain is write-only history masquerading as live code, and it grows
with every task.

## Solution

Delete the migrations that provably cannot run again, behind a hard floor.

### 1. Prove the floor (the whole task, really)

For each track, compute `FLOOR = min(user_version)` across **every reachable DB**, not just the ones
that are convenient to enumerate:

- every registered profile and `user.sqlite` in R2, on **dev, staging AND prod**
- **unregistered / orphan profile objects in R2** — the 2026-07-25 finding: the bulk sweep skipped
  these forever, so they are exactly where a below-floor DB hides
- any seeded/fixture/backup DB the repo or scripts can resurrect (test fixtures,
  `copy_user_between_envs`, local dev copies)

Use the read-only probes, never `run_all_migrations` "just to check"
([[project_migration_tracking_gap]]). Record the measured floor per track and the date in this file.

### 2. Delete a contiguous PREFIX only

Remove `v001 … v{FLOOR-1}` as one block. Never delete scattered versions and never renumber:
`latest_version == MIGRATIONS[-1].version`, so pruning from the bottom leaves head unchanged, and a
contiguous remainder avoids the version-gap class T6345 filed against the Postgres runner (confirm
that runner tolerates the resulting numbering before pruning its track).

### 3. Make below-floor a LOUD failure, not a partial upgrade

Today the runner applies every migration above the DB's current version. After pruning, a DB at v20
with `FLOOR = v31` would silently apply v031→v033 onto a schema those migrations never expected —
corruption, not an error. So the floor must be enforced explicitly: `user_version < FLOOR` →
refuse to open/serve that DB, log CRITICAL, surface the error. This is the project's
no-silent-fallback rule applied to schema.

### 4. Prove the fresh-DDL path still equals the migrated path

Fresh DBs skip migrations entirely — `ensure_database()` / `_USER_DB_SCHEMA` build the schema and
`PRAGMA user_version` is stamped straight to head ([database.py:1382](../../../../src/backend/app/database.py#L1382)).
That means the DDL, not the chain, is the real source of truth for new accounts *already*. Pruning
removes the only cross-check, so add one first: a test that builds one DB from the fresh DDL and one
by migrating from the floor, and asserts the schemas are identical (tables, columns, types, indexes).
If they differ, that difference is a live bug this task must surface before deleting anything.

### 5. Fix what the deletion breaks

`test_migrations.py:116` asserts `len(MIGRATIONS) >= 7` and other tests pin `HEAD` — update them to
match the pruned reality rather than deleting the assertions.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/profile_db/`, `.../user_db/`, `.../postgres/` — the `vNNN_*.py` files
- `src/backend/app/migrations/base.py` — runner, `latest_version`, version discovery
- `src/backend/app/migrations/__init__.py` — read-only probes (`get_migration_status`, the per-user
  probe), floor enforcement lands near `_migrate_profile_db`
- `src/backend/app/database.py` — `ensure_database()` DDL + fresh-DB stamping (L1382)
- `src/backend/app/services/user_db.py` — `_USER_DB_SCHEMA`
- `src/backend/app/services/pg.py` — `_SCHEMA_DDL`, `schema_migrations` table
- `src/backend/tests/test_migrations.py`, `test_migration_runner.py` — count/HEAD locks
- `scripts/audit_copy_state.py` — already reads `db-version` metadata per object; useful for the sweep

### Related Tasks
- Depends on: **T5087** (bulk runner gone, JIT is the only mechanism)
- Related: T6345 (Postgres runner skips version gaps — confirm before pruning that track),
  T4830 (verify-at-head reporting the floor sweep reuses)

### Technical Notes
- M-tier, backend-only. Migration agent NOT needed — this deletes migration files, it does not add one.
- Data heals (v021, v031, v033) are one-shot by nature: once applied everywhere they can never do
  anything again. Schema migrations are only safe to prune because the fresh-DDL path reproduces
  their effect — hence step 4 is a prerequisite, not a nicety.
- **Do not prune the Postgres track on the same day as the SQLite tracks.** One track at a time, each
  verified on all three envs, so a mistake has an obvious owner.
- Keep the deleted history findable: note the pruned range and the commit in CLAUDE.md § Migration
  System, so "where did v001-v030 go" has an answer that is not `git log`.

## Implementation

### Steps
1. [ ] Add the fresh-DDL-vs-migrated-from-floor schema equivalence test; fix any drift it finds
2. [ ] Sweep every reachable DB on dev/staging/prod (registered + orphan + fixtures) and record the
       measured floor per track, with the date
3. [ ] Implement floor enforcement: `user_version < FLOOR` refuses loudly, never partially upgrades
4. [ ] Prune the contiguous prefix for ONE track; update the count/HEAD test locks
5. [ ] Verify: fresh account creation, an at-head account, and a synthetic below-floor DB (must fail
       loud, not corrupt)
6. [ ] Repeat per remaining track, one at a time
7. [ ] Document the pruned range + floor in CLAUDE.md § Migration System

## Acceptance Criteria

- [ ] Measured floor per track recorded in this file, covering registered AND orphan objects on all
      three envs
- [ ] A test proves the fresh DDL and a migrate-from-floor DB produce identical schemas
- [ ] Only a contiguous prefix is deleted; `latest_version` and all remaining version numbers unchanged
- [ ] A below-floor DB fails loud (CRITICAL + refused access), never partially migrates
- [ ] Fresh account creation and at-head accounts unaffected
- [ ] Test count/HEAD locks updated, not deleted
- [ ] CLAUDE.md records the pruned range and the floor
- [ ] Tests pass
