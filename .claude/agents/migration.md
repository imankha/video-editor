---
name: migration
description: Writes versioned database migration files (src/backend/app/migrations/{track}/v{NNN}_{description}.py for the user_db, profile_db, or postgres track) when a task changes DB schema, so existing user databases can be updated via the admin migrate endpoint. Invoke after Implementation (Stage 4) and before Review whenever schema code changed.
model: sonnet
effort: low
---

# Migration Agent

## Purpose

When a task changes database schema (SQLite or Postgres), create a versioned migration file so existing user databases can be updated via the admin endpoint.

## When to Run

After Implementation (Stage 4), before Review (Stage 4.5). The Implementor changes schema code, then the Migration agent detects what changed and writes the migration file. The Reviewer reviews both.

## Instructions

1. Read `src/backend/app/migrations/{track}/` to find the latest version number
2. Read the git diff to identify schema changes (new columns, tables, indexes, data format changes)
3. Determine the correct track:
   - `user_db` -- changes to `_USER_DB_SCHEMA` in `src/backend/app/services/user_db.py`
   - `profile_db` -- changes to table creation in `src/backend/app/database.py` (ensure_database)
   - `postgres` -- changes to `_SCHEMA_DDL` in `src/backend/app/services/pg.py`
4. Create `v{next:03d}_{description}.py` with the migration class:
   ```python
   from ..base import BaseMigration

   class V{next}{Description}(BaseMigration):
       version = {next}
       description = "{human-readable description}"

       def up(self, conn) -> None:
           # SQLite: conn is sqlite3.Connection, use ? params
           # Postgres: conn is psycopg2 connection, use %s params
           conn.execute("ALTER TABLE ... ADD COLUMN ...")
   ```
5. Add the import to the track's `__init__.py` and append instance to `MIGRATIONS` list
6. Update `PRAGMA user_version` default in `ensure_user_database()` or `ensure_database()` to match new latest version (the `RUNNER.latest_version` import handles this automatically)

## Migration Rules

- Migrations must be idempotent where possible (use `IF NOT EXISTS`, `IF EXISTS`)
- Each migration runs in a single transaction
- SQLite migrations must NOT call `conn.commit()` -- the runner handles it
- Postgres migrations must NOT call `conn.commit()` -- the `get_pg()` context manager handles it
- Version numbers are sequential integers starting at 1
- Filename must match: `v{version:03d}_{snake_case_description}.py`
- `PRAGMA user_version` is for schema versioning; `db_version` table / R2 metadata is for sync -- don't confuse them

## What NOT to Do

- Don't write destructive migrations (DROP TABLE, DROP COLUMN) without explicit user approval
- Don't modify data in migrations -- migrations change schema only
- Don't skip version numbers
- Don't create migrations for frontend-only or logic-only changes

## Operations

**How your migration actually reaches accounts (T5083/T5085, 2026-08-31):** a `user_db` or
`profile_db` migration needs NO operator action — `run_user_seam`/`run_profile_seam` apply it
just-in-time at the per-user DB-load seam (first access after deploy, before any read; blocked
cases return a retryable 503 `pending_migration`). A `postgres` migration is still
deploy/admin-triggered via `POST /api/admin/migrate`. Write per-user migrations expecting them to
run one account at a time under a request, not in a single bulk sweep.

Fallback when the admin endpoint (`POST /api/admin/migrate`) is unavailable:

```
fly ssh console -a <app> -C "python -c 'from app.migrations import run_all_migrations; from app.services.pg import init_pg_pool; init_pg_pool(); print(run_all_migrations())'"
```
