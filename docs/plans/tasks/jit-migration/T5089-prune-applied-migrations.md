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

## Measured Floors

### DEV (2026-09-02, `scripts/measure_migration_floor.py`, orphan-inclusive R2 walk)

| Track | Floor | Head seen | Notes |
|-------|-------|-----------|-------|
| `user_db` | **v006** | v007 | 14 objects at v006 (ALL `e2e_*`/`probe_*`/`test`/`t48xx` artifacts); 355 at v007 |
| `profile_db` | **v000** | v048 | ONE object at v000: `dev/users/e2e_t7790_1787783178970_0fjrr2/profiles/4600738b/profile.sqlite` (a broken/unstamped E2E leftover). Next tiers: v016(2), v019(4), v022(1), v023(46), … v048(10). Registry head is v049; no dev profile has reached it yet |
| `postgres` | head v026, contiguous 1..26 | v026 | single shared DB, at head (exempt from the floor gate — see below) |

**Conclusion: the prune CANNOT proceed.** Two independent blockers:
1. **staging + prod are unmeasurable in-container** (this container carries only DEV credentials in
   `/workspace/.env`: `APP_ENV=dev`, dev `DATABASE_URL`, dev R2). The floor is `min` across dev **and
   staging AND prod** — an unmeasured env could hide a lower floor. See the BLOCKED line.
2. **Even DEV has below-floor outliers that are test artifacts**, not real accounts: a v000
   profile.sqlite and 14 v006 user.sqlite objects (all `e2e_*`/`probe_*`/`test`). A single v000
   profile pins the profile_db floor at 0 → nothing is prunable there until the supervisor/user
   decides whether to (a) clean up these dev test leftovers, or (b) exclude non-real accounts from
   the floor. This is a data/product judgment, not a code decision — do NOT guess it.

**What DID land this session (code that does not depend on the measured floor):**
- The **DDL-vs-migrated schema equivalence tests** (Step 1) — `tests/test_t5089_prune_floor.py`. Both
  SQLite tracks proven equivalent to the fresh DDL; **no drift** (one benign normalized diff:
  `projects.poster_marker_time` DDL `DEFAULT NULL` vs v032 no-default — semantically identical).
- The **floor-enforcement mechanism** (Step 3), shipped **INERT** (`floor=0` on every track). A DB
  below a configured floor raises `BelowMigrationFloor` (CRITICAL log, non-retryable HTTP 500
  `schema_below_floor` — deliberately NOT the retryable 503 `pending_migration`). Postgres is
  exempt by construction (fresh pg has an empty ledger → current=0; a nonzero pg floor would refuse
  every fresh deploy). Wire the real floor by setting `MigrationRunner(MIGRATIONS, floor=F)` in the
  track's `__init__.py` **and deleting `v001..vF` in the same commit**, once the cross-env sweep +
  the artifact-cleanup decision above are settled.
- A **read-only cross-env floor-sweep script** for the blocked probe: `scripts/measure_migration_floor.py`.

### Steps
1. [x] Add the fresh-DDL-vs-migrated-from-floor schema equivalence test; fix any drift it finds
       (no drift found; one benign normalized default-representation diff)
2. [~] Sweep every reachable DB and record the floor per track — DEV done (above); **staging/prod
       BLOCKED on supervisor credentials** (exact commands in `.dotask-status`)
3. [x] Implement floor enforcement (shipped inert, `floor=0`; `BelowMigrationFloor` → loud 500)
4. [ ] Prune the contiguous prefix for ONE track — **BLOCKED** on Step 2 (floor unproven) + the dev
       artifact-cleanup decision
5. [ ] Verify: fresh account creation, an at-head account, and a synthetic below-floor DB (synthetic
       below-floor refusal IS tested; fresh/at-head unaffected proven by regression corner)
6. [ ] Repeat per remaining track, one at a time — **BLOCKED**
7. [ ] Document the pruned range + floor in CLAUDE.md § Migration System — pending the actual prune

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
