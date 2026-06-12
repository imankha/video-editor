# Season Highlights — Codebase Tech Notes (taskification prep)

Companion to [season-highlights-spec.md](season-highlights-spec.md). Facts verified against code on 2026-06-12. Each task file should reference the sections relevant to it instead of re-discovering these.

---

## 1. Persistence & sync model (profile SQLite ↔ R2)

- **Connection**: always `get_db_connection()` ([database.py:1021](../../src/backend/app/database.py)) — context manager, calls `ensure_database()` (downloads from R2 on first access per user+profile), returns a `TrackedConnection` (WAL, 30s busy timeout, FKs on).
- **Write detection → auto-sync**: `TrackedCursor.execute()` parses SQL and marks writes in a mutable request-context dict ([database.py:110, 199-261](../../src/backend/app/database.py)). After the response, middleware fires `_background_sync()` ([middleware/db_sync.py:613-631, 678-806](../../src/backend/app/middleware/db_sync.py)) which uploads to R2 with version metadata. **Endpoints never bump versions or schedule syncs manually.**
- **Versioning/conflict**: `db_version` table + in-memory cache + R2 `x-amz-meta-db-version`. `sync_database_to_r2_with_version()` ([storage.py:782-900](../../src/backend/app/storage.py)) HEAD-checks R2; if R2 is newer it fails the upload and re-downloads. Per-user write locks serialize concurrent writers.
- **Canonical surgical-write endpoints to copy for the rank endpoint**: `mark_watched` ([downloads.py:757-767](../../src/backend/app/routers/downloads.py)) and `rename_download` ([downloads.py:770-786](../../src/backend/app/routers/downloads.py)) — single parameterized UPDATE, precondition in WHERE clause, 404 on rowcount 0, `conn.commit()`, done.

## 2. msgpack conventions

- Helpers: `encode_data` / `decode_data` in [utils/encoding.py](../../src/backend/app/utils/encoding.py) (`packb(use_bin_type=True)` / `unpackb(raw=False)`, memoryview-safe). **Never hand-marshal.**
- msgpack BLOB columns: `working_clips.crop_data/timing_data/segments_data`, `working_videos.highlights_data`, **`final_videos.rating_counts`** (decoded at [downloads.py:396](../../src/backend/app/routers/downloads.py)). The new `final_videos.tags` column should be msgpack for consistency.
- **Project archives**: publish calls `archive_project()` ([services/project_archive.py:47](../../src/backend/app/services/project_archive.py)) → serializes working_clips/working_videos/project metadata to msgpack at R2 `archive/{project_id}.msgpack`, then deletes working data. Restore = `unpackb` at line 184. **The v007 backfill must read these archives for published reels whose working data is gone.**
- Migration v004 ([migrations/profile_db/v004_overlay_tuning.py](../../src/backend/app/migrations/profile_db/v004_overlay_tuning.py)) is the template for msgpack-touching migrations: unpack → validate → mutate → re-pack, wrapped in try/except with logging.

## 3. Migration system

- Tracks & **current latest versions**: profile_db **v006**, user_db **v004**, postgres **v015**. New profile_db work starts at **v007**.
- File pattern: class extending `BaseMigration` with `version`, `description`, `up(conn)`; **no commit inside `up`** (runner commits, [base.py:49-56](../../src/backend/app/migrations/base.py)). Register in the track's `__init__.py` `MIGRATIONS` list.
- Guards: check table exists (migration may run pre-schema on fresh DB); `ALTER TABLE` in try/except for idempotency. Fresh DBs set `PRAGMA user_version = RUNNER.latest_version` at creation ([database.py:1005-1007](../../src/backend/app/database.py)) so migrations only run on existing DBs — **the canonical schema in `ensure_database()` (database.py:479-1015) must be updated in the same task as the migration.**
- Execution: `run_all_migrations()` ([migrations/__init__.py:19-48](../../src/backend/app/migrations/__init__.py)) — postgres once, then per-user-per-profile (downloads profile DBs from R2 if missing locally, syncs back after). Triggered via `POST /api/admin/migrate`; **never auto-runs on deploy**.
- Postgres DDL: also update `_SCHEMA_DDL` in [services/pg.py](../../src/backend/app/services/pg.py) for fresh deployments (shares.share_type CHECK constraint + new `collection_definition` column need both a v016 migration and DDL update).

## 4. Export pipeline (for the stitch job)

- **Job lifecycle**: `export_jobs` table (status pending→processing→complete/error, msgpack `input_data`, `modal_call_id`, `acknowledged_at`). Create via `create_export_job()` ([exports.py:86](../../src/backend/app/routers/exports.py)), process via `BackgroundTasks` → `process_export_job()` ([services/export_worker.py:146-223](../../src/backend/app/services/export_worker.py)) which **routes by job_type** — add `'stitch'` here.
- **Progress**: WS `/ws/export/{job_id}`; message shape from `make_progress_data()` ([websocket.py:21-72](../../src/backend/app/websocket.py)) — `{progress, phase, message, status, type, projectId, projectName, done}`. Frontend `exportStore` consumes it. Pass a new `type: 'stitch'`.
- **FFmpeg already has what stitch needs**: `get_video_info()` (width/height/duration/fps/codec probe, [ffmpeg_service.py:280](../../src/backend/app/services/ffmpeg_service.py)) and `concatenate_clips()` + cut/fade/dissolve variants (lines 389-625). CPU-only; no Modal function required (Modal dispatch is env-gated via `modal_enabled()`, [modal_client.py:340](../../src/backend/app/services/modal_client.py) — irrelevant for concat).
- **Credits**: only framing charges (1 credit/sec input, two-phase reserve/confirm/release in user_db, refund on failure at export_worker.py:206-219). Overlay is free. **Recommendation: stitch is free** (CPU concat) — skip the reservation entirely rather than reserving 0.
- **R2 layout**: user media at `{APP_ENV}/users/{uid}/profiles/{pid}/{final_videos|working_videos|raw_clips}/{filename}`; `r2_user_prefix()` ([storage.py:230](../../src/backend/app/storage.py)); presign via `generate_presigned_url()` (storage.py:1210, default 1h) or `generate_presigned_url_global()` (used by shares, 4h).
- **final_videos row creation paths** (both need stamping in capability #1):
  - Overlay finalize: `_finalize_overlay_export()` ([routers/export/overlay.py:58-108](../../src/backend/app/routers/export/overlay.py)) — sets project_id, filename, version (MAX+1), source_type ('brilliant_clip' if auto-project else 'custom_project'), name. **Does not set duration today.**
  - Annotated/auto exports: [services/auto_export.py:197-204](../../src/backend/app/services/auto_export.py) — **already sets duration + published_at + game_id**; hardcodes `source_type='brilliant_clip'`. ⚠️ Verify where `source_type='annotated_game'` rows are actually inserted (downloads.py handles the value; the insert site wasn't located) during task 1.
- Stitched artifact: insert as a normal final_video (new source_type `'stitched_collection'`) + msgpack column for `{collection_definition, member_final_video_ids}` snapshot → powers staleness diff.

## 5. Sharing internals (for collection shares)

- **Postgres**: `shares` (token UUID4, share_type CHECK `('video','game','annotation_playback')`, sharer_user_id/profile_id, recipient_email, revoked_at) + per-type detail tables ([pg.py:98-157](../../src/backend/app/services/pg.py)). Collection shares: add `'collection'` to CHECK + `collection_definition JSONB` (postgres v016 + DDL).
- **Resolution endpoints**: `GET /api/shared/{token}` ([shares.py:306-330](../../src/backend/app/routers/shares.py)) — revoked→410, private→email check via `_get_email_from_request()` (shares.py:100, cookie `rb_session` or `X-User-ID` header), returns metadata + 4h presigned URL. Public access works because `/api/shared/` is in the middleware auth allowlist ([db_sync.py:293](../../src/backend/app/middleware/db_sync.py)) — new collection resolver path must stay under `/api/shared/`.
- **Cross-user reads**: `materialization.py::_open_profile_db()` (line 24) opens the sharer's profile.sqlite **only if locally cached — no R2 download**. Live collection evaluation needs a new read-only helper that falls back to downloading the sharer's DB from R2 (reuse `sync_database_from_r2_if_newer` machinery). This is the main new backend capability in #2.
- **Frontend routing**: no react-router — App.jsx regex-matches `window.location.pathname` at init (`/^\/shared\/([a-f0-9-]+)$/` line ~348, teammate variant line ~341) and conditionally mounts `SharedVideoOverlay` / `SharedAnnotationView`. Collection viewer: new pattern `/shared/collection/{token}` + new component, registered the same way.
- **Share UI to reuse**: [ShareModal.jsx](../../src/frontend/src/components/ShareModal.jsx) (contacts GET, existing-shares list, public toggle = create/delete public share, copy via `navigator.clipboard`, revoke DELETE) and `useWebShare` hook ([hooks/useWebShare.js](../../src/frontend/src/hooks/useWebShare.js)) — `navigator.share()` on mobile, copy-link on desktop, `track('share_initiated')`.
- **Email**: Resend ([services/email.py](../../src/backend/app/services/email.py)); `_build_share_email()` template builder; logs to stdout in dev without `RESEND_API_KEY`. Add `send_collection_share_email()` alongside the four existing senders.

## 6. Frontend architecture facts

- **Bootstrap**: single `GET /api/bootstrap` after auth ([App.jsx:163-225](../../src/frontend/src/App.jsx)) hydrates stores via `setFromBootstrap()` (profiles, settings, credits, projects, games, quests, downloads count). **Unlock-threshold check goes right after bootstrap completes (~line 208), before preloader dismissal**; publish-triggered check goes in the publish success handler.
- **My Reels**: [DownloadsPanel.jsx](../../src/frontend/src/components/DownloadsPanel.jsx) (1-773) + [useDownloads.js](../../src/frontend/src/hooks/useDownloads.js) (1-396). `loadState` machine, optimistic rename/delete, date grouping in `groupedDownloads()` (useDownloads.js:248-278), game sub-grouping `groupByGame()` (panel:521-538) rendered with [shared/CollapsibleGroup.jsx](../../src/frontend/src/components/shared/CollapsibleGroup.jsx) (supports count badges + status segments). ⚠️ The "star" filter = Brilliant Clips source-type filter, **not** user favorites.
- **Playback**: gallery uses `MediaPlayer` (standalone, keyboard controls) fed by **backend proxy** `getStreamingUrl()` → `/api/downloads/{id}/stream` (Chrome 6-socket limit + CORS — frontend never holds raw presigned URLs in-app; public share pages DO use presigned URLs). **Story-player blueprint: [RecapPlayerModal.jsx](../../src/frontend/src/components/RecapPlayerModal.jsx)** — auto-advance hooks (`useRecapPlayback`/`useHighlightsPlayback`, onEnded → next → play), clips sidebar, `PlaybackControls` reuse.
- **Publish hook point**: `publishProject()` ([ProjectManager.jsx:1762-1799](../../src/frontend/src/components/ProjectManager.jsx)) — POST `/api/downloads/publish/{id}`, then gallery badge refresh + project list refetch + optional gallery open. Rank-insertion prompt fires on success here, before gallery navigation.
- **Conventions**: Screen→Container→View ([coding-standards.md](../../.claude/references/coding-standards.md)); data-always-ready (parents guard, views assume); Zustand for cross-cutting state, local useState only for transient UI; theme constants in [config/themeColors.js](../../src/frontend/src/config/themeColors.js) (`REEL` cyan = gallery/reels, `GAME` green); [shared/Button.jsx](../../src/frontend/src/components/shared/Button.jsx) variants `primary|secondary|success|danger|cyan|ghost`, sizes `sm|md|lg`, `icon`/`iconOnly` props; modals: fixed `inset-0 bg-black/60`, **no backdrop close**, X button; [shared/ConfirmationDialog.jsx](../../src/frontend/src/components/shared/ConfirmationDialog.jsx) for confirms.
- **Sliders**: no library — `<input type="range">` styled like VideoControls volume (track `bg-white/25`, rounded) or the custom draggable scrubber ([shared/VideoControls.jsx:110-175](../../src/frontend/src/components/shared/VideoControls.jsx)). Time-budget slider: `type="range"` with detent `step`, labels under track.
- **Settings**: `pref.*` key-value in user_db `user_settings` via [settingsStore.js](../../src/frontend/src/stores/settingsStore.js) (defaults lines 23-37) + `GET/PUT /api/settings` ([settings.py](../../src/backend/app/routers/settings.py), [user_db.py:695-766](../../src/backend/app/services/user_db.py)). Add `seasonHighlightsChoice` to store defaults; persistence is automatic.
- **Sound**: no audio assets — Web Audio synthesis in [QuestPanel.jsx:81-113](../../src/frontend/src/components/QuestPanel.jsx) (`'check'` ping, `'fanfare'` arpeggio). Extract to `utils/sounds.js` in capability #3; celebration CSS `quest-celebrate` in [index.css:300-311](../../src/frontend/src/index.css).

## 7. Quest system (for capability #5)

- Definitions in **three places that must stay in sync**: backend [quest_config.py:9-62](../../src/backend/app/quest_config.py) (source of truth), frontend [data/questDefinitions.js](../../src/frontend/src/data/questDefinitions.js) + [config/questDefinitions.jsx](../../src/frontend/src/config/questDefinitions.jsx) (titles/descriptions).
- Step detection: `_check_all_steps()` ([quests.py:46-238](../../src/backend/app/routers/quests.py)) derives from profile data; old multi-clip detection at lines 188-199 gets replaced. New derived steps: `publish_30s` = `SUM(duration) WHERE published_at IS NOT NULL >= 30` (needs v007 stamping/backfill); `rank_first_reel` = `EXISTS(season_rank IS NOT NULL)`.
- Non-derivable steps use achievements: `POST /api/quests/achievements/{key}` (idempotent INSERT OR IGNORE), fired via `useQuestStore.getState().recordAchievement(key)` (session-deduped). New keys: `season_highlights_optin`, `copied_collection_link` — add to the known-keys list (quests.py:28).
- Completed quests persist in user_db `completed_quest_ids`; reward claims are idempotent `credit_transactions` rows (`source='quest_reward'`). Users who claimed old quest_4 are unaffected; in-progress users get re-derived (new) steps.
- Quest panel: one active quest at a time, auto-positioning, completion modal for quest_4 at [QuestPanel.jsx:204-225](../../src/frontend/src/components/QuestPanel.jsx) (copy needs rewrite).

## 8. Testing patterns

- **Backend**: `cd src/backend && .venv/Scripts/python.exe run_tests.py`; ⚠️ tests TRUNCATE the real dev Postgres — warn user before running; tests not importing app.main must load .env manually.
- **Frontend unit (Vitest)**: store tests use real Zustand stores, `getState()` assertions, `beforeEach` state reset (see [stores/exportStore.test.js](../../src/frontend/src/stores/exportStore.test.js)).
- **E2E (Playwright)**: specs in `src/frontend/e2e/`; auth bypass = `X-User-ID`/`X-Test-Mode` headers + `/api/auth/test-login` + `useAuthStore.setState` + reload (see [e2e/new-user-flow.spec.js](../../src/frontend/e2e/new-user-flow.spec.js)).

## 9. Gotchas index (one line each)

1. Publish **archives & deletes** working data → stamp metadata at export-finalize, backfill from R2 archives for published rows.
2. `rating_counts` and friends are **msgpack BLOBs**, not JSON — use `encode_data`/`decode_data`.
3. Fresh DBs skip migrations (PRAGMA pre-set) → update `ensure_database()` schema **and** write the migration.
4. Migrations never auto-run → deploy checklist must include `POST /api/admin/migrate`.
5. Cross-user profile DB reads don't download from R2 → collection resolver needs a download-fallback helper.
6. Public endpoints must live under `/api/shared/` (middleware auth allowlist).
7. No react-router — public viewer routes are regex matches in App.jsx init.
8. In-app playback uses the backend `/stream` proxy, not presigned URLs; share pages use presigned URLs.
9. The gallery "star" tab is a Brilliant Clips filter, not favorites.
10. No reactive persistence — rank suggestion shown in UI is memory-only until the confirm gesture POSTs it.
11. Duration is currently NULL on most final_videos rows (computed per-request) — nothing may assume it exists until v007 ships.
12. `auto_export.py` hardcodes `source_type='brilliant_clip'` while downloads.py also handles `'annotated_game'` — locate the annotated_game insert site during task 1 and stamp both.
13. Stitch needs no Modal/GPU and should bypass credits (skip reservation, don't reserve 0).
14. Sound requires a user gesture — load-triggered unlock modal plays fanfare on accept-click, not on open.
