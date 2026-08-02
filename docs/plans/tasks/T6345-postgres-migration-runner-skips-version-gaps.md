# T6345: postgres migration runner skips version gaps permanently (max() vs set membership)

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-08-02
**Found by:** migrating dev + staging during T6340 investigation (2026-08-02) — filed out of T6340 per its acceptance criteria (a separate runner bug gets its own task, never a silent fold-in).

## Problem

`MigrationRunner.get_pending` (`src/backend/app/migrations/base.py:38`) computes pending
migrations as `version > MAX(applied)`. For the postgres track, `get_current_version` is
`SELECT MAX(version) FROM schema_migrations` — a **maximum, not a set-membership test**. So a
migration numbered *below* an already-applied version is skipped **silently and permanently**, with
no error and no log. `run_all_migrations()` reports success while applying nothing.

### It really happened (dev + staging, 2026-08-02)

T5770 correctly numbered its migration **v022** because v020/v021 were reserved by the then-unmerged
Share the Game branches. T5770 merged and was migrated **first**. Result on both dev and staging:

```
applied: [1 … 19, 22]     max: 22     GAPS: [20, 21]
```

`run_all_migrations()` reported success while applying nothing, and `shares.share_type` never gained
`'game_link'` — so **every public-game-link creation would 500 on the `share_type` CHECK constraint**,
on an environment reporting itself fully migrated. Fixed by hand on dev + staging (applied v020/v021
explicitly, then stamped `schema_migrations`); both are now contiguous 1–22. **The runner defect is
untouched and will recur** the next time branches merge out of numeric order — which the
branch-numbering discipline (reserve numbers for unmerged branches) actively encourages.

## Solution

Make `get_pending` compare against the applied **SET**, not the max: for postgres, read
`SELECT version FROM schema_migrations` and return every registered migration whose version is not
present in that set. Keep the ordering deterministic (ascending by version).

### Also assess (do not necessarily change)

Whether the `PRAGMA user_version` tracks (`user_db` / `profile_db`) can gap the same way. They hold a
single integer, so they can only move forward and cannot express a gap on disk — BUT a merge that
lands a *lower* migration number has the same silent-skip shape (the lower migration is `<= user_version`
and never runs). Document the finding; a fix there, if any, is likely a numbering/assert guard rather
than a set comparison.

## Verification

- Regression test: seed `schema_migrations` with `[1..19, 22]` and assert v020 and v021 are still
  reported pending (and get applied), while a contiguous `[1..22]` reports nothing pending.
- Confirm the sqlite tracks' behavior with a corresponding assertion or a documented rationale.

## Context

- `src/backend/app/migrations/base.py` — `MigrationRunner.get_pending` (`:38`), `get_current_version`.
- `src/backend/app/services/pg.py` — `schema_migrations` table, `_SCHEMA_DDL`.
- Sibling: T6340 (profile_db sync baseline) — same runner family, different failure mode; that task
  fixed the profile_db → R2 upload path and explicitly deferred this postgres gap-skip to here.

## Acceptance Criteria

- [ ] `get_pending` applies a migration numbered below `MAX(applied)` when it is absent from the
      applied set (postgres track).
- [ ] Regression test seeding `[1..19, 22]` proves v020/v021 are pending and get applied.
- [ ] The `PRAGMA user_version` tracks are assessed for the same silent-skip shape; finding recorded.
- [ ] No behavior change for a contiguous history (a fully-migrated env still reports nothing pending).
