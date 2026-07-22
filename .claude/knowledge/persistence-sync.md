---
domain: persistence-sync
updated: 2026-07-19 (T5350 frontend surfaces the clip 503 sync_failed with clip copy + Retry, completing T4320)
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
- `src/backend/app/main.py:232` — `_graceful_shutdown` (SIGTERM: WAL checkpoint + sync every profile.sqlite AND every user.sqlite — the user.sqlite loop was added in T4320; the prior "skips user.sqlite" gap is closed).
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
   - **Durable (T4050)**: routes with `Depends(durable_sync)` (db_sync.py:84) AWAIT the sync inside the write lock; failure → 503 `sync_failed` retryable payload, never a lying 200. Now on: publish/restore-project/overlay-export (T4050/T4110), framing/multi-clip export (T4200), AND the clip-creating/mutating gestures + profile-create (T4320): `POST /clips/raw/save`, `PUT /clips/raw/{id}`, `DELETE /clips/raw/{id}`, `POST /api/games/finalize-upload`, `POST /api/profiles`. Still fire-and-forget by design: working-clip `/actions` (framing_action) — high-frequency; making each keyframe drag block on an R2 upload would re-introduce the T2720 blocking-sync regression, so they stay async and are backstopped by T4310 (CAS) + T4330 (action client).
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
5. Background workers (export_worker, sweep_scheduler etc.) must use the `*_explicit(user_id, profile_id)` sync functions — ContextVars are dead outside the request. **The `_explicit` sync functions now derive the R2 KEY from the ARG, not the ContextVar (T5340):** `sync_db_to_r2_explicit` passes `profile_id` through `sync_database_to_r2_with_version(..., profile_id=)`, which keys the upload via `profile_r2_key(user_id, profile_id, "profile.sqlite")` (arg) instead of `r2_key` (ContextVar). A missing `profile_id` now RAISES (no silent ContextVar fallback). `r2_key`/`get_database_path` (ContextVar) are **request-path only**. Pre-T5340 the key came from the ContextVar, so any `_explicit` caller whose ContextVar ≠ arg uploaded the right DB to the WRONG profile's key (confirmed on T4850 move-reels; also latent in `main.py:_graceful_shutdown`, which runs with NO request context → `r2_key` would raise/mis-key — now passes `profile_id=` from the globbed path). `retry_pending_sync` (db_sync.py) is likewise now genuinely ContextVar-free (uses `get_user_data_path_explicit` + `profile_id=`). `sync_user_db_to_r2_explicit` was NEVER affected — the user.sqlite key (`_user_db_r2_key`) has no profile segment and no ContextVar. **Sweep corollary**: after `expire_game_storage()` updates ≥1 row in a profile.sqlite during Phase 2 deletion, `sync_db_to_r2_explicit(user_id, profile_id)` MUST be called immediately. Skipping it means the expiry is lost on next cold-load from R2, resurrecting the game as 'active' (T4820).
6. Action-endpoint RMW atomicity is currently an *accident* of "no `await` between read and commit" (audit B8) — do not insert awaits into `POST /actions` handlers.
6b. **Cross-profile durable write (T4850, `downloads.py:move_reels_to_profile`)**: when a gesture writes TWO profile DBs of the same user, `durable_sync` only covers the REQUEST profile. Write + explicitly `sync_db_to_r2_explicit(user_id, other_profile_id)` the OTHER DB inside the handler, and order it so the losing side is the request profile (target written+synced FIRST, source deleted+`durable_sync` SECOND) — a mid-op machine death then yields a recoverable DUPLICATE, never data loss. Open the other DB with materialization's `ensure_profile_db_local` + `_open_profile_db` (raw sqlite, NOT TrackedConnection → the middleware won't sync it, which is why the explicit sync is mandatory). **T5340: `sync_db_to_r2_explicit(user_id, target_profile_id)` here now keys R2 off the arg, so it correctly lands on the TARGET's key even though the request ContextVar is the SOURCE.** (Before T5340 it uploaded the target DB to the SOURCE key → corrupted the source copy and lost the move on cold-load.)
7. **Fire-and-forget persistence changes are deferred** until sessions are reliably pinned to a single machine (memory: blocked T1537). Machine pinning exists (T1190) but the constraint stands.

## Landmines & history
- **Account deletion MUST purge R2 + local + in-process caches (bugs 33p/34p/35p, fix/bug-33-34-35-newuser-flow).** `user.sqlite`/`profile.sqlite` live in R2 under `{APP_ENV}/users/{user_id}/`. A delete that removes only the local folder leaves the R2 copy, which `ensure_user_database`/`ensure_database` restore on the next login (first-access-only restore) → the account is resurrected. Both delete endpoints now call `auth._purge_user_data`: local rmtree + `storage.delete_user_r2_data` (paginated whole-prefix, raises on error) + cache invalidation (`invalidate_user_cache`, `user_db.forget_user_db`, `database.forget_local_db_state`) + `invalidate_user_sessions`. Cache invalidation is required because `_initialized_user_dbs` / `_user_sqlite_versions` / `_user_db_versions` make `ensure_*` skip the R2 re-check on an already-seen user — a stale cache entry can skip restore or mask the delete. **Corollary:** `is_new_user` derives from the restored user.sqlite's `selected_profile`, so purging R2+caches makes a reregister genuinely new (seeds credits) even without deleting the Postgres users row. Residual open race: a cross-machine re-sync between delete and reregister can still resurrect the R2 copy (would need a deletion tombstone to fully close).
- **`skip_version_check=True` at EVERY upload call site** (db_sync.py:271/284, database.py:1164/1237/1277/1345, main.py:268) — R2 conflict detection exists (storage.py:884-897) but is compiled out; cross-machine writes are last-write-wins on the whole profile DB. Being fixed as T4310 (CAS). Do not add new call sites that skip the check without reading T4310.
- **Local dev**: DB changes made directly to a local profile.sqlite get overwritten by R2 restore/sync on reload — edit the R2 copy (`scripts/edit-user-db.py`) or use fallback paths (memory: dev state simulation).
- **T350**: reactive useEffect persistence compounded keyframe fixups into corruption — origin of the gesture-only rule.
- **T4020**: export's redundant post-render full-state save wrote an empty "shadow" working-clip version; bloat-cleanup then pruned the real one = permanent framing loss. Fixed frontend-side; backend-authoritative export (audit B4/T4400) is the structural fix.
- **T4110 → T4200 (DONE 2026-07-11)**: sync-then-announce extended to framing and multi-clip. ALL export paths now gate COMPLETE on sync success; DB-save failure is terminal. The `_export_sync_failed_data` helper lives in `export_helpers.py`.
- **0.5s defer window** (T2720): middleware sync gives up waiting for the R2 upload lock after 0.5s and defers — annotation sessions can revert wholesale if the machine dies before the next sync (T4320).
- ~~Shutdown sync (main.py:255-276) covers profile DBs only, not user.sqlite.~~ FIXED T4320: `_graceful_shutdown` now runs a second loop over `*/user.sqlite` (WAL checkpoint + `sync_user_db_to_r2_with_version`, mirroring the profile.sqlite loop).
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

## T5070 — Blocking update gate + version handshake + ordered state-sync flow

In-session PWA update is now a **blocking, non-dismissible gate** (`UpdateGateModal` + `updateGateStore`), replacing the old dismissible toast (T4150). Fires on a waiting SW (`onNeedRefresh`) OR a backend-version mismatch; paints above the login surface (z-[60] > AuthGateModal z-50) so an un-updated client can't log in or interact.

**Version handshake (closes the backend-only-deploy gap):** backend advertises `X-App-Version` on every response via `AppVersionHeaderMiddleware` (added LAST = outermost, so it survives 401s/preflight) + `GET /api/version`; value = `COMMIT_SHA` build-arg (Dockerfile ARG/ENV, wired in deploy-backend.yml `github.sha` + deploy_production.sh `git rev-parse HEAD`; `version.py` falls back to "dev" locally). Client SSOT is `appVersion.checkAppVersion`: the passive `sessionInit.js` fetch interceptor calls it on EVERY /api response (zero extra requests); `pwaUpdate.js` adds an on-load + visibilitychange active poll (5-min throttle). **The active poll must NOT be nested inside `onRegisteredSW`** — a dev server / slow SW registration would otherwise silently disable the handshake (that was the scenario-B bug). **Debounced: gate only after the SAME new version is seen on 2 consecutive checks** — a rolling Fly deploy serves a mixed old/new fleet and single-observation gating would reload-loop; a lone blip that reverts resets the candidate.

**Ordered update flow (barriered):** Update-now click (gesture) → step-3 durable flush (`updateFlush.flushDurableState`, awaits R2 confirmation) → cache flush (skipWaiting+clientsClaim+cleanupOutdatedCaches) → **[step-5 migration seam, left clean/no-op for T5080 JIT migration]** → resync via normal session-init. Any flush failure keeps the gate up — never a destructive flush with unsynced state.

**Persistence-rule compliance (landmines):** step-3 flush is invoked ONLY from the onClick gesture (never a reactive useEffect). It is a DRAIN+VERIFY, not a full-state dump: drains the overlay retry queue and calls `saveCurrentClipState` ONLY when `framingStore.framingChangedSinceExport` is true — a clean/mid-restore editor must NOT trigger a full-state save (the T4020 empty-shadow-save class). **Logged-out safety (was a guaranteed lockout):** a logged-out/expired-session user has no per-user dirty state — `runUpdate` skips the barrier when `!useAuthStore.isAuthenticated`, and `flushDurableState` treats a 401 from `POST /api/sync/flush-verify` as "nothing to flush → proceed", NOT a failure. Without this, every deploy permanently stranded anyone on the login surface.

**Tests:** `updateGateStore.test.js`, `appVersion.test.js` (debounce), `updateFlush.test.js` (401 + dirty-flag), `pwaUpdate.test.js` (39 FE unit total); backend `test_t5070_version_and_flush_verify.py` (9); E2E `T5070-blocking-update-gate.spec.js` (gate blocks; converged version-mismatch gates; flush-fail keeps gate up; success reloads). **iOS/PWA real-device cache-flush pass is a documented MANUAL step — not container-verifiable.**

## T4320 — Durable clip gestures + user.sqlite shutdown sync + T5310 profile-create fix

**Gestures made durable** (`Depends(durable_sync)`): `POST /clips/raw/save`, `PUT /clips/raw/{id}`, `DELETE /clips/raw/{id}` (clips.py), `POST /api/games/finalize-upload` (games_upload.py), `POST /api/profiles` (profiles.py). An annotate save that returned 200 now survives a machine replacement (previously it rode fire-and-forget with a 0.5s lock-timeout defer → whole sessions could revert).

**Latency decision — UNBOUNDED wait (`lock_timeout=None`), matching the existing pattern.** A clip save uploads the SAME profile.sqlite that publish/restore/export already sync durably in prod (T4050/T4200) — identical cost, already accepted. Local measurement (real middleware via httpx.ASGITransport against the T4050 fake R2, varying simulated per-upload latency): the durable await adds ≈ one R2 upload RTT (profile.sqlite + user.sqlite upload in PARALLEL via `asyncio.gather`, so ~1 RTT not 2). p95 save ≈ 66ms @25ms RTT, ≈119ms @75ms, ≈205ms @150ms — all far under the task's 1.5s bounded-vs-unbounded threshold. So no bounded/`sync_pending` variant was needed (which also avoids inventing a new pattern). **A real-R2 staging p95 is still owed to the supervisor** — the local harness models RTT, not true R2 network variance. Working-clip `/actions` were EXCLUDED (high-frequency; would re-introduce the T2720 blocking-sync regression) — T4310/T4330 are their backstop.

**T5310 profile-create durability (prod-proven bug):** `POST /api/profiles` previously wrote the registry row to user.sqlite then relied on fire-and-forget to push the NEW profile.sqlite; a second profile created seconds after the first lost that fire-and-forget sync on prod → **registered profile with no R2 object** (arshia's `6ff007e6`/`22c7616a`, "missing"/Direction-A). Fix (profiles.py `create_profile`): **ordering matters** — `set_current_profile_id(new_id)` → `ensure_database()` (create local profile.sqlite) → `sync_db_to_r2_explicit(user_id, new_id)` durably pushes the NEW object to R2 FIRST → only then `db_create_profile` writes the registry row, and `Depends(durable_sync)` makes the middleware AWAIT the user.sqlite (registry) sync. Object-before-registration means a mid-op machine death yields at worst a benign R2 orphan (Direction-B, which the migration runner already tolerates), NEVER a "missing" registered profile. On profile-sync failure it returns `JSONResponse(503, DURABLE_SYNC_FAILED_RESPONSE)` (top-level `{code:'sync_failed', retryable}` — the shape the frontend's `error.code === 'sync_failed'` retry paths expect) BEFORE writing the registry, so nothing is registered. This is the cross-profile-durable-write pattern of invariant 6b applied to create (new profile.sqlite = the "other"/target DB, synced first; user.sqlite registry = the request DB, synced second via durable_sync). ~~Footgun: `sync_db_to_r2_explicit(user_id, new_id)` derives the R2 upload KEY from the ContextVar (`r2_key`), agreeing here only because `set_current_profile_id(new_id)` runs first; call it with a profile_id that differs from the ContextVar and it uploads the right file to the WRONG key.~~ **FIXED T5340: `sync_db_to_r2_explicit` now keys R2 off the `profile_id` ARG (`profile_r2_key`), so correctness no longer depends on the ContextVar matching the arg** — profile-create's `set_current_profile_id(new_id)`-first ordering is still correct but no longer load-bearing for the key. (T4850 `move_reels_to_profile`, which syncs a NON-request `target_profile_id`, was the live victim of the old footgun and is fixed by the same primitive change.)

**Tests:** `tests/test_t4320_durable_clip_gestures.py` (reuses the T4050 fake-R2 harness): clip save/update/delete survive a machine replacement; forced-sync-failure → 503 + not-durable; user.sqlite covered by `_graceful_shutdown`; profile-create survives a machine swap (object + registry both in R2); TWO profiles created back-to-back BOTH have R2 objects and survive a machine swap (the exact prod failure mode — arshia's second-of-a-pair profile); forced profile-sync-failure → 503 and the profile is NOT registered.

**T5350 — frontend closes the clip 503 loop (completes T4320's user-visibility).** T4320 made the clip routes return the retryable 503 but the frontend didn't surface it: `useRawClipSave` had no `sync_failed` branch, and the shared `DURABLE_SYNC_FAILED_RESPONSE.detail` ("Your reel was not moved") is nonsensical for a clip. Fix (frontend-only, `src/frontend/src/hooks/useRawClipSave.js`): on `response.status === 503 && (body.code || body.detail?.code) === 'sync_failed'`, each of save/update/delete now sets `error` + calls the exported `surfaceClipSyncFailed(gesture, retry)` — a persistent (`duration:0`, per-gesture `dedupKey`) shared-Toast error with a **Retry action** that re-fires the SAME gesture, then returns `null`/`false` (**never a silent-success toast** on a 503). **Copy is keyed on the GESTURE in the frontend (`CLIP_SYNC_FAILED_COPY`), NOT sourced from the backend `detail`** — the backend message stays reel/move-shaped and shared; do not surface `body.detail` for a clip gesture. **Invariant: the Retry is a user click (gesture), never a reactive `useEffect` re-send** — mirrors the overlay/publish/move durable-fail UX (`overlayActionStore`, `useMoveReels`, `useReEditReel`). Tests: `src/hooks/__tests__/useRawClipSave.syncFailed.test.js` (8 unit: 503→not-saved+Retry+re-fire per gesture, happy path unchanged, non-sync 500 not treated as sync_failed); live-drive `e2e/T5350-clip-sync-failed-frontend-ux.spec.js` renders the real toast via the exported `surfaceClipSyncFailed` against the mounted `ToastContainer`.

## Active/upcoming work
Durability & Sync Hardening epic (docs/plans/PLAN.md, in order): **T4310** R2 CAS conflict detection; **T4320** durable clip-creating gestures + user.sqlite in shutdown sync; **T4330** unified action client (per-entity FIFO, version threading, 409 — overlay's `expected_version` check at overlay.py:384-391 is commented out today); **T4340** canonicalize segments_data at write; **T4350** re-transform carried highlights on re-export; **T4360** BEGIN IMMEDIATE + invariant tests. Related bug tier: T4200 (framing/multi-clip sync-then-announce), T4210 (overlay blob decode → 500). Full map: docs/plans/audit-2026-07-03-code-quality.md sections B and G.
