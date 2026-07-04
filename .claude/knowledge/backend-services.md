---
domain: backend-services
updated: 2026-07-03 (initial version, workflow setup)
---
# Backend Services & Structure — Domain Knowledge

## Scope
FastAPI app layout: routers, services, the three databases, the 3-track migration system, admin endpoints, and test infrastructure. R2 sync mechanics and persistence rules live in persistence-sync.md.

## Entry points
- `src/backend/app/main.py` — app creation, CORS, `RequestContextMiddleware` (main.py:124), `FlyReplayMiddleware` (main.py:130), router registration (main.py:140-176), startup (Postgres pool + schema init at main.py:336-338; sweep + cleanup loops at main.py:354-359), SIGTERM graceful shutdown (main.py:232).
- Import check after ANY backend edit (required, src/backend/CLAUDE.md): `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"`.

Router inventory (`app/routers/`; prefix shown; some get an extra `/api` prefix at include time — main.py:154-158):
- `health.py` (no prefix) — health/status. `auth.py` (`/api/auth`) — Google/OTP login, sessions, test-login. `bootstrap.py` (`/api/bootstrap`) — initial app payload.
- `clips.py` (`/api/clips`) — raw/working clip CRUD + framing gesture actions + streaming proxy. `projects.py` (`/api/projects`) — reel projects, rename, rescale, restore. `games.py` (`/api/games`) — game library, activation, sharing, expiry, streaming. `games_upload.py` (`/api/games`) — blake3-keyed upload/dedupe/finalize.
- `export/__init__.py` (`/api/export`) — mounts `framing.py` (crop/AI framing), `overlay.py` (highlight render + overlay gesture actions), `multi_clip.py` (multi-clip reels, 3 routes, ~2,500 lines), `before_after.py`. `exports.py` (`/api/exports`) — export job records, recovery, presigned results. `detection.py` (`/api/detect`) — YOLO player detection.
- `downloads.py` (`/api/downloads`) — gallery/final-video downloads + proxy. `collections.py` (`/api/collections`) — season highlights. `rank.py` (`/api/rank`) — Glicko pairwise ranking. `shares.py` (two routers: `/api/gallery`, `/api/shared`) — share links, public playback.
- `profiles.py` (`/api/profiles`), `settings.py` (`/api/settings`), `users.py` (`/api/me`), `credits.py` (`/api/credits`), `payments.py` (`/api/payments`, Stripe), `quests.py` (`/api/quests`), `privacy.py` (`/api/privacy`), `storage.py` (`/storage`, presigned URLs + warmup).
- `admin.py` (`/api/admin`) — admin dashboard, migrations, impersonation. `_debug.py` (`/api/_debug`, gated by DEBUG_ENDPOINTS_ENABLED). `test_seams.py` (`/api/test`, mounted only in non-prod, main.py:173-177).

Key services (`app/services/`): `pg.py` (Postgres pool + `_SCHEMA_DDL`), `user_db.py` (user.sqlite + `_USER_DB_SCHEMA`), `auth_db.py` (sessions/users on Postgres), `sharing_db.py`, `export_worker.py` + `export_helpers.py` (job lifecycle), `modal_client.py`/`modal_queue.py`/`processor_modal.py` (GPU), `processor_local.py`/`local_processors.py`/`ffmpeg_service.py` (local FFmpeg), `auto_export.py` + `sweep_scheduler.py` (expiry sweep), `storage_credits.py`, `materialization.py` (share materialization), `project_archive.py` (msgpack archives), `glicko.py`.

## Data flow
Three databases, different access patterns:
1. **Fly Postgres** (auth/sharing/sessions/analytics/game storage refs): `from app.services.pg import get_pg`; context manager auto-commits/rolls back (pg.py:293). `%s` params, RealDictCursor (rows are dicts). Schema: `_SCHEMA_DDL` in pg.py:21 (`CREATE TABLE IF NOT EXISTS`, run at startup — fresh DBs only).
2. **Per-user-per-profile SQLite** `profile.sqlite` (clips/projects/games/final videos): `from app.database import get_db_connection` → `TrackedConnection` (write tracking for R2 sync). `?` params, `sqlite3.Row` (bracket access only — `.get()` does not exist). Schema: `ensure_database()` in database.py:479.
3. **Per-user SQLite** `user.sqlite` (credits/profiles list/quests/activity): `app/services/user_db.py`, schema `_USER_DB_SCHEMA` (user_db.py:39).

Binary blobs are msgpack via `app/utils/encoding.py` (`encode_data`/`decode_data`). Media files live in R2 under `{APP_ENV}/users/{user_id}/...`; game sources under `games/{blake3}.mp4` (no env prefix).

## Invariants & rules
1. **User lookups always via Postgres `users` table**, never auth.sqlite (auth.sqlite is legacy; pg.py replaced it — T1960).
2. **Backend tests hit the REAL dev Postgres** (conftest.py `pg_conn` deletes test users and TRUNCATEs shared tables, conftest.py:105-121). Guard refuses DSNs containing staging/prod keywords (conftest.py:95-99). Warn the user before running the suite.
3. **Migrations do NOT auto-run** on deploy or startup. `init_pg_schema()` only applies `_SCHEMA_DDL` for fresh DBs (it does run pending PG migrations as a retry if the DDL hits UndefinedColumn — pg.py:333-340, but never rely on this). Trigger explicitly after deploy: `POST /api/admin/migrate` (admin session required, admin.py:381) or fly ssh (see CLAUDE.md § Migration System).
4. Schema change workflow: Implementor updates the live schema (`_SCHEMA_DDL` / `ensure_database()` / `_USER_DB_SCHEMA`) AND the Migration agent writes a versioned file — both, always.
5. No silent fallbacks / no defensive fixes for internal data (CLAUDE.md); missing internal data = log + fail visibly. T4280 is the enforcement sweep.
6. Modal function edits (`app/modal_functions/`) require asking the user about redeploy (`modal deploy app/modal_functions/video_processing.py`).
7. Admin endpoints each call `_require_admin()` imperatively (admin.py:51, ~25 call sites) — until T4610 lands, ANY new admin handler must call it explicitly or it is an open endpoint.

## Migration system (3 tracks)
Files: `src/backend/app/migrations/{track}/v{NNN}_{description}.py`; each defines a `BaseMigration` subclass with `version`, `description`, `up(conn)` (migrations/base.py:7). Track runners in each track's `__init__.py`; orchestrated by `run_all_migrations()` (migrations/__init__.py:19) — runs Postgres once, then iterates EVERY user (from Postgres) and migrates user.sqlite + all profile DBs, downloading profile DBs from R2 if not local and syncing back to R2 after (migrations/__init__.py:104-129).

| Track | DB | Version mechanism | Latest (2026-07-03) |
|---|---|---|---|
| `postgres` | Fly Postgres | `schema_migrations` table | v018 |
| `profile_db` | profile.sqlite | `PRAGMA user_version` | v019 |
| `user_db` | user.sqlite | `PRAGMA user_version` | v006 |

- Only versions `> current` are applied (base.py:38-40) — never reuse or renumber a version.
- **`up(conn)` receives a TUPLE row factory for SQLite** (plain `sqlite3.connect`, migrations/__init__.py:91/119) — index rows positionally (`r[0]`), NOT `r['col']`. String-indexing crashed the v017 backfill for 4 prod users (memory: v017 rowfactory bug). Test the row-reading path with data, not just the empty case.
- `PRAGMA user_version` (schema) and the `db_version` table / R2 `db-version` metadata (sync) are independent — see persistence-sync.md.
- Status check: `get_migration_status()` (migrations/__init__.py:11); admin dashboard exposes it.

## Landmines & history
- v017 profile_db migration crashed on `row['col']` under the tuple row factory; fixed positionally and re-migrated — all prod users at v18+ (now v019 exists: heal_sweep_reel_metadata).
- Live bugs mapped by the 2026-07-03 audit (docs/plans/audit-2026-07-03-code-quality.md): `exports.py:279` NameError (recovery reports failure after success — T4240); overlay blob decode failure silently becomes `[]` (overlay.py:308-313) then the next gesture's whole-blob RMW persists it = permanent highlight loss (T4210); `clips.py:483-497` remove_segment_split wipes segmentSpeeds (T4220); `projects.py:1275` catch-all NULLs crop_data (T4230).
- `routers/export/` is 5,878 lines with ~300 raw `cursor.execute` across routers; the service split never happened — Export Write-Path epic (T4370-T4410) is the plan. Don't add new pipeline logic to routers.
- `export_worker.py:28-33` imports from a router (inversion, fixed in T4380/E1). Two competing export-job create helpers exist (exports.py:86 vs export_helpers.py:37) with different initial statuses.
- `privacy.py` opens SQLite with no pragmas/busy_timeout (lock errors under sync load) — T4660.
- Tests not importing `app.main` must load `.env` manually (memory: backend tests need dotenv).

## Active/upcoming work
Bug tier (TODO): T4210 (overlay decode → 500, delete orphaned PUT), T4220-T4270, T4280 (silent-fallback sweep). Guardrails first: T4290/T4300. Backend consolidations: **T4610** require_admin router Depends, T4620 fetch_or_404 + enums, **T4630** R2StreamProxy service (4 streaming-proxy copies), **T4640** games.py activation/share services (depends on T4360), **T4650** raw_clips write-path consolidation, **T4660** open_sqlite factory + game_display service. Export Write-Path epic T4370-T4410 (strict order: characterization tests → ExportJobRepository → finalize/publish single writer → backend-authoritative export → orchestration move). Full map: docs/plans/PLAN.md § Code Quality & Refactoring.
