# Database Migrations

Standalone migration scripts for per-user SQLite databases. Run manually -- never in app runtime.

## Usage

```bash
cd src/backend
.venv/Scripts/python.exe ../../scripts/migrations/<script>.py <email> --env <dev|staging|prod>
```

Add `--dry-run` to preview without writing.

## Scripts

| Script | Description |
|--------|-------------|
| T2847_backfill_clip_teammates.py | Backfill clip_teammates junction table from raw_clips.tagged_teammates |

## Notes

- The app's `ensure_database()` creates tables with the final schema (all columns, correct FKs)
- New databases need no migration -- they're created with the current schema
- Migrations are only needed for existing databases created before schema changes
- T2870 (JSON-to-msgpack) was already run on all databases and is not included here
- T2870 DDL cleanup: tags, default_highlight_regions, text_overlays changed from TEXT to BLOB in schema DDL. No runtime migration needed -- SQLite ignores declared column types for existing tables, and data was already migrated to msgpack bytes by migrate_msgpack.py
