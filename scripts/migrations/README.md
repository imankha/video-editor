# Database Migrations

Standalone migration scripts for per-user SQLite databases and Postgres. Run manually -- never in app runtime.

## Per-user scripts

```bash
cd src/backend
.venv/Scripts/python.exe ../../scripts/migrations/<script>.py <email> --env <dev|staging|prod>
```

Add `--dry-run` to preview without writing.

| Script | Description |
|--------|-------------|
| T2847_backfill_clip_teammates.py | Backfill clip_teammates junction table from raw_clips.tagged_teammates |
| add_shared_clip_ids.py | Add shared_clip_ids to teammate_shares and backfill from clip_teammates |
| add_share_games_metadata.py | Add and backfill game metadata columns in Postgres share_games (no email arg, operates on all rows) |

## Unified migration

Runs all migrations for all users in one shot. Includes verification.

```bash
cd src/backend
.venv/Scripts/python.exe ../../scripts/migrations/migrate_staging.py --env staging
.venv/Scripts/python.exe ../../scripts/migrations/migrate_staging.py --env staging --dry-run
.venv/Scripts/python.exe ../../scripts/migrations/migrate_staging.py --env staging --verify-only
```

For prod: stop Fly machines first, then run with `--env prod` (requires interactive confirmation).

## Verification tests

```bash
cd src/backend
.venv/Scripts/python.exe ../../scripts/migrations/test_migration.py --env staging
```

66 checks covering Postgres schema/data integrity and per-user SQLite consistency.

## Notes

- The app's `ensure_database()` creates tables with the final schema (all columns, correct FKs)
- New databases need no migration -- they're created with the current schema
- Migrations are only needed for existing databases created before schema changes
- All migrations are idempotent -- safe to re-run
- For staging/prod, scripts download SQLite from R2, migrate, and re-upload
- Requires fly proxy running for staging/prod Postgres access
