---
domain: persistence-sync
updated: 2026-07-12 (T4900 overlay action failure visibility + CORS root-cause fix)
---
# Persistence & R2 Sync — Domain Knowledge

## Scope
How user data gets written and how it survives: gesture-based persistence rules, per-user SQLite databases synced to Cloudflare R2, the sync middleware, version tracking, machine pinning, and durability. Auth/sharing/sessions live in Fly Postgres and are NOT synced to R2 (see backend-services.md).

## Entry points
- `src/backend/app/middleware/db_sync.py` — `RequestContextMiddleware` (single combined middleware: auth resolution + profile context + write tracking + R2 sync). Aliased as `DatabaseSyncMiddleware` (db_sync.py:885). Registered in `main.py:124`.
- `src/backend/app/database.py` — profile DB (`user_data/<user_id>/profiles/<profile_id>/profile.sqlite`): `ensure_database()` (database.py:479), `TrackedConnection` (database.py:199, write tracking), sync helpers `sync_db_to_r2_explicit` / `sync_user_db_to_r2_explicit` (database.py:1207/1250), `.sync_pending` marker file helpers (database.py:62-82).
- `src/backend/app/storage.py` — R2 upload/download with version metadata: `sync_database_to_r2_with_version` (storage.py:829), `sync_user_db_to_r2_with_version` (storage.py:1084). R2 keys are env-prefixed: `{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite`.
  - **R2 MEDIA ARTIFACTS ARE PER-PROFILE, not per-user.** `r2_key(user_id, path)` (storage.py:266) embeds the CURRENT `profile_id` from the ContextVar: `{APP_ENV}/users/{user_id}/profiles/{profile_id}/{path}`. So `final_videos/`, `working_videos/`, `raw_clips/` objects all live under a specific profile prefix — a DIFFERENT profile of the SAME user cannot presign them. Any cross-profile op that references media (e.g. T4850 reel move) MUST relocate the object between profile prefixes; carrying only the DB row 404s on playback/download. (Global `games/{hash}.mp4` is the sole env-prefix-free, cross-profile namespace.) Cross-profile helpers: `profile_r2_key` / `copy_profile_object` / `delete_profile_object` / `profile_object_exists` (storage.py, T4850) build the key for an EXPLICIT profile id (no ContextVar).
- `src/backend/app/services/user_db.py` — `user.sqlite` (per-user: credits, profiles list, quests, activity).
- `src/backend/app/main.py:232` — `_graceful_shutdown` (SIGTERM: WAL checkpoint + sync every profile.sqlite; **skips user.sqlite** — known gap, T4320).
- `src/backend/app/middleware/fly_replay.py` — WebSocket-scope fly-replay (outermost middleware, main.py:130).

## Data flow
Request lifecycle (`db_sync.py:443 _dispatch_impl`):
1. **Machine pinning (T1190)**: `fly_machine_id` cookie; mismatched live machine → respond with `fly-replay: instance=<id>` header (db_sync.py:447-471). Stale/dead machine → handle locally, re-pin cookie.
2. **Auth**: `rb_session` cookie → Postgres `validate_session`; fallback `X-User-ID` header (dev/staging only, plus `/api/admin/` routes; db_sync.py:492-502). Unauthed + not allowlisted → 401.
3. **Profile context**: `X-Profile-ID` header (8-hex) or `user_session_init(user_id)` resolves it. ContextVars: `user_id`, `profile_id`, `req_id`.
4. **Per-user write lock (T1531)**: POST/PUT/PATCH/DELETE serialize per user (db_sync.py:195-229); reads take no lock (SQLite WAL).
5. Handler runs; every DB write through `TrackedConnection` flips a per-request "has writes" flag (separate flags for profile vs user DB).
6. **After handler, if writes**: `mark_sync_pending(user_id)` (crash-safe `.sync_pending` marker file, T930), then either:
   - **Fire-and-forget (default)**: `asyncio.create_task(_background_sync(...))` — response returns before R2 upload (T3250). Upload-lock contention defers after `_SYNC_LOCK_TIMEOUT = 0.5s` (db_sync.py:201) — this is a silent-loss window.
   - **Durable (T4050)**: routes with `Depends(durable_sync)` (db_sync.py:84) AWAIT the sync inside the write lock; failure → 503 `sync_failed` retryable payload, never a lying 200. Currently only on publish/restore-project/overlay-export class gestures (T4110); framing/multi-clip exports and annotation saves are NOT durable yet (T4200/T4320).
7. Failed syncs leave the marker; next WRITE request retries (`retry_pending_sync`, db_sync.py:255); `X-Sync-Status: failed` header surfaces persistent failure to the frontend (AND-gated with in-flight-sync set, db_sync.py:156).

Restore path: `ensure_database()` downloads from R2 **only on first access** of the process for that user+profile (local version cache `None`); no per-request HEAD (database.py:498-553). R2-not-found → fresh DB, version locked to 0. Transient R2 error → 30s cooldown, retry later.

Version model — two INDEPENDENT version systems, never conflate:
- **Sync version**: integer in R2 object metadata `db-version` (`x-amz-meta-db-version`, storage.py:735/931) mirrored in a local `db_version` table (id=1 row, database.py:353-366) + in-memory cache. Incremented on every successful upload.
- **Schema version**: `PRAGMA user_version`, set by the migration runner (see backend-services.md).

Blob encoding: binary columns (`crop_data`, `segments_data`, `highlights_data`, `tags`, `game_ids`, …) are **msgpack** via `encode_data`/`decode_data` in `src/backend/app/utils/encoding.py`. JSON over the wire, msgpack on disk (msgpack-over-HTTP was rejected).

## Invariants & rules
1. **Gesture-based, never reactive** (CLAUDE.md): every DB write traces to a named user gesture. Surgical actions POST only the changed field (`POST .../actions`; backend does read-modify-write on the blob). Full-state saves (`PUT /clips/{id}`, `saveCurrentClipState`) only on explicit export gesture. Reactive `useEffect`→API/store persistence is BANNED (caused T350 keyframe origin corruption; T4020 shadow-version loss). ~~Last surviving violation: game-duration PATCH (T4260)~~ → FIXED 2026-07-11: the `loadedmetadata` PATCH is deleted from `AnnotateContainer.jsx`; no reactive effect→API writes remain in the codebase. **Now MACHINE-ENFORCED (T4290):** custom ESLint rule `local/no-persistence-in-effects` (error, `src/frontend/eslint-rules/`) flags write-verb `apiFetch`/`fetch` (POST/PUT/PATCH/DELETE), `.setState()`, and `use*Store.getState().<mutator>()` when their nearest enclosing fn is the effect callback or a directly-invoked IIFE — 0 hits today; escape hatch is `// eslint-disable-next-line local/no-persistence-in-effects -- gesture: <name>`. Deferred/reconciliation writes (`.then`/timer/listener callbacks, named load helpers, cleanup returns, mount-once `[]` effects) are intentionally NOT flagged. Sibling rule `local/no-raw-editor-mode-literals` (bans raw `'framing'|'overlay'|'annotate'`) ships `off` — 56 baseline hits would breach the frozen `eslint src --max-warnings 998` gate (already at 998); flips to `warn` after EDITOR_MODES adoption (T4560) ratchets the baseline down.
2. Runtime fixups (keyframe normalization etc.) are memory-only, never persisted; restore is read-only; one write path per piece of data.
3. Writers must commit BEFORE the write lock releases (middleware relies on this for read-your-writes).
4. `SKIP_SYNC_PATHS` (db_sync.py:309) and `AUTH_ALLOWLIST_PREFIXES` (db_sync.py:322) are the only sync/auth bypasses — check them before assuming a route syncs.
5. Background workers (export_worker, sweep_scheduler etc.) must use the `*_explicit(user_id, profile_id)` sync functions — ContextVars are dead outside the request. **Sweep corollary**: after `expire_game_storage()` updates ≥1 row in a profile.sqlite during Phase 2 deletion, `sync_db_to_r2_explicit(user_id, profile_id)` MUST be called immediately. Skipping it means the expiry is lost on next cold-load from R2, resurrecting the game as 'active' (T4820).
6. Action-endpoint RMW atomicity is currently an *accident* of "no `await` between read and commit" (audit B8) — do not insert awaits into `POST /actions` handlers.
6b. **Cross-profile durable write (T4850, `downloads.py:move_reels_to_profile`)**: when a gesture writes TWO profile DBs of the same user, `durable_sync` only covers the REQUEST profile. Write + explicitly `sync_db_to_r2_explicit(user_id, other_profile_id)` the OTHER DB inside the handler, and order it so the losing side is the request profile (target written+synced FIRST, source deleted+`durable_sync` SECOND) — a mid-op machine death then yields a recoverable DUPLICATE, never data loss. Open the other DB with materialization's `ensure_profile_db_local` + `_open_profile_db` (raw sqlite, NOT TrackedConnection → the middleware won't sync it, which is why the explicit sync is mandatory).
7. **Fire-and-forget persistence changes are deferred** until sessions are reliably pinned to a single machine (memory: blocked T1537). Machine pinning exists (T1190) but the constraint stands.

## Landmines & history
- **Account deletion MUST purge R2 + local + in-process caches (bugs 33p/34p/35p, fix/bug-33-34-35-newuser-flow).** `user.sqlite`/`profile.sqlite` live in R2 under `{APP_ENV}/users/{user_id}/`. A delete that removes only the local folder leaves the R2 copy, which `ensure_user_database`/`ensure_database` restore on the next login (first-access-only restore) → the account is resurrected. Both delete endpoints now call `auth._purge_user_data`: local rmtree + `storage.delete_user_r2_data` (paginated whole-prefix, raises on error) + cache invalidation (`invalidate_user_cache`, `user_db.forget_user_db`, `database.forget_local_db_state`) + `invalidate_user_sessions`. Cache invalidation is required because `_initialized_user_dbs` / `_user_sqlite_versions` / `_user_db_versions` make `ensure_*` skip the R2 re-check on an already-seen user — a stale cache entry can skip restore or mask the delete. **Corollary:** `is_new_user` derives from the restored user.sqlite's `selected_profile`, so purging R2+caches makes a reregister genuinely new (seeds credits) even without deleting the Postgres users row. Residual open race: a cross-machine re-sync between delete and reregister can still resurrect the R2 copy (would need a deletion tombstone to fully close).
- **`skip_version_check=True` at EVERY upload call site** (db_sync.py:271/284, database.py:1164/1237/1277/1345, main.py:268) — R2 conflict detection exists (storage.py:884-897) but is compiled out; cross-machine writes are last-write-wins on the whole profile DB. Being fixed as T4310 (CAS). Do not add new call sites that skip the check without reading T4310.
- **Local dev**: DB changes made directly to a local profile.sqlite get overwritten by R2 restore/sync on reload — edit the R2 copy (`scripts/edit-user-db.py`) or use fallback paths (memory: dev state simulation).
- **T350**: reactive useEffect persistence compounded keyframe fixups into corruption — origin of the gesture-only rule.
- **T4020**: export's redundant post-render full-state save wrote an empty "shadow" working-clip version; bloat-cleanup then pruned the real one = permanent framing loss. Fixed frontend-side; backend-authoritative export (audit B4/T4400) is the structural fix.
- **T4110 → T4200 (DONE 2026-07-11)**: sync-then-announce extended to framing and multi-clip. ALL export paths now gate COMPLETE on sync success; DB-save failure is terminal. The `_export_sync_failed_data` helper lives in `export_helpers.py`.
- **0.5s defer window** (T2720): middleware sync gives up waiting for the R2 upload lock after 0.5s and defers — annotation sessions can revert wholesale if the machine dies before the next sync (T4320).
- Shutdown sync (main.py:255-276) covers profile DBs only, not user.sqlite.
- ~~`overlay_version` on working_videos is bumped by surgical overlay actions; the orphaned `PUT /overlay-data` (overlay.py:1383) does NOT bump it — deletion pending in T4210~~. FIXED T4210 (2026-07-11): `PUT /overlay-data` deleted; decode failure now returns 500 instead of silently returning `[]` and erasing all highlights.
- `segments_data` has two formats on disk (splits-only from gestures vs full-list from PUT); always `canonicalize_segments_data` before walking pairs — until T4340 canonicalizes at write time.

## Migration runner invariants (T4830)

`run_all_migrations` (`app/migrations/__init__.py`) follows these rules:

1. **Registry is authoritative.** Only profiles listed in `user.sqlite.profiles` (`get_profiles`) are migrated. R2 profile dirs not in the registry are **orphans**: logged, collected in `results["users"]["orphans"]`, never migrated, never errored.
2. **Always migrate the canonical R2 copy.** `_migrate_profile_db` force-downloads the R2 profile.sqlite each run. Guard: if the local copy is **ahead** of R2 (local `user_version > R2 user_version`), the local copy is synced up to R2 first (to preserve unsynced local writes), then migration continues from the local. If local is at-or-behind R2, R2 overwrites local (R2 is canonical).
3. **Fail loud on upload failure.** `sync_db_to_r2_explicit` return value is checked; False → `MigrateResult(status="sync_failed")` → errors[]. A profile that failed to sync is NOT counted as migrated.
4. **Always verify in R2.** After every run (whether or not migrations were applied), `_read_r2_profile_user_version` re-downloads from R2 and asserts `PRAGMA user_version == PROFILE_DB_RUNNER.latest_version`. Mismatch → `MigrateResult(status="not_at_head")` → errors[]. No opt-out flag.
5. **User-level migrated/skipped only when ALL registered profiles verify.** If any registered profile lands in errors[], the user's failing profiles are reported in errors[] and the user is NOT counted as migrated or skipped.
6. **Orphan cleanup is opt-in.** `scripts/cleanup_orphan_profiles.py` archives orphan R2 objects (copies to `orphans/` prefix, then deletes originals). Dry-run by default; `--apply` + manual confirmation required. Never auto-invoked by the runner.
7. **`MigrateResult` status values:** `"ok"` (profile verified at head), `"sync_failed"` (upload returned False), `"not_at_head"` (R2 user_version ≠ head after sync), `"missing"` (registered profile has no R2 object), `"download_failed"` (transient R2 download error).

## Overlay action failure visibility (T4900 / prod bug 31p)

**Root cause of 31p (2026-07-12, `feature/T4900`):** `CORSMiddleware` was the INNERMOST
HTTP middleware. Auth 401s and Fly machine-pinning Responses produced by
`RequestContextMiddleware` (outside CORS) carried NO `Access-Control-Allow-*` headers.
Cross-origin browsers blocked those responses and surfaced them as opaque `"TypeError:
Failed to fetch"` — exactly the 188 identical failures the reporter saw while video
streaming (same-origin) kept working. Overlay action POSTs hit a 5xx (backend restart,
machine migration) → preflight got no CORS → opaque network error in the browser.

**Fix (main.py):** `CORSMiddleware` moved to be the OUTERMOST HTTP middleware (added
LAST in main.py, after all other `add_middleware` calls). Every response — success, 4xx,
5xx, and preflight — now carries CORS headers before reaching the browser.

**Frontend failure visibility (overlayActionStore.js):** Before T4900 every failed
overlay action POST was swallowed with a bare `console.error`. Now:
- `dispatchOverlayAction(label, run)` wraps every surgical overlay action with bounded
  retry (2 retries, 400ms base backoff — still the same gesture, NOT reactive).
- On final failure: action queued in `failedActions[]`, persistent toast "Your edits
  aren't saving — Retry" (duration: 0) surfaces via the shared Toast.
- `_surfaceFailureToast` reconciles against `useToastStore` before skipping — a user
  who dismissed the toast (X button) gets a fresh warning on the next failure (stale
  `_toastId` would have suppressed it).
- `retryFailedOverlayActions()` re-sends queued actions on gesture (Retry button or
  export gate). Clears state on success; re-surfaces toast on continued failure.
- `reset()` called on project unmount (`useEffect` cleanup keyed on `projectId`) so
  failures from a prior project never leak into the next.

**Export gate (ExportButtonContainer.jsx):**
- `hasUnsavedOverlayFailures = failedActions.length > 0` (read from store, not prop-drilled).
- If true AND in overlay mode: `handleExport` shows an inline error message, calls
  `retryFailedOverlayActions()`, and returns — no render POST is fired.
- `buttonTitle` shows "Some edits haven't saved — retry saving before exporting" as tooltip.

**Wire-up (OverlayScreen.jsx):**
- All surgical action handlers (`wrappedAddHighlightRegion`, `wrappedMoveHighlightRegionEnd`,
  `wrappedAddHighlightRegionKeyframe`, etc.) now call `dispatchOverlayAction(...)` instead
  of bare `overlayActions.*()`.
- `reset()` fired on overlay teardown via `useEffect(() => () => reset(), [projectId])`.

**Tests:**
- `src/frontend/src/stores/overlayActionStore.test.js` (9 unit tests): happy path, retry
  transient, failure burst, dedup toast, stale-toast re-surface, retry-success,
  retry-fail-again, export-gate selector, reset.
- `src/backend/tests/test_t4900_cors_error_headers.py`: 401 error response carries CORS
  header; OPTIONS preflight on overlay/actions is answered correctly.
- `src/backend/tests/test_t4900_overlay_keyframe_persistence.py`: render read path
  `_region_bounds`/`_keyframes_within_bounds` tolerates camelCase + snake_case, keeps
  keyframes past extended boundary, drops genuinely outside ones; integration: actions →
  blob the render reads; persistence-gap simulation (31p failure mode reproduced).
- E2E spec: `src/frontend/e2e/T4900-overlay-action-failure-visibility.spec.js`.

**Invariant added:** Overlay surgical action fire-and-forget is now failure-visible: the
Retry affordance is gesture-initiated, NOT a background reactive loop. Do NOT add reactive
retry logic (`useEffect` watching failure state to re-send). The only allowed persistence-
retry trigger is an explicit user gesture (Retry button or export button auto-retry).

## Active/upcoming work
Durability & Sync Hardening epic (docs/plans/PLAN.md, in order): **T4310** R2 CAS conflict detection; **T4320** durable clip-creating gestures + user.sqlite in shutdown sync; **T4330** unified action client (per-entity FIFO, version threading, 409 — overlay's `expected_version` check at overlay.py:384-391 is commented out today); **T4340** canonicalize segments_data at write; **T4350** re-transform carried highlights on re-export; **T4360** BEGIN IMMEDIATE + invariant tests. Related bug tier: T4200 (framing/multi-clip sync-then-announce), T4210 (overlay blob decode → 500). Full map: docs/plans/audit-2026-07-03-code-quality.md sections B and G.
