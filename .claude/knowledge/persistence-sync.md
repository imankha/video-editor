---
domain: persistence-sync
updated: 2026-07-03 (initial version, workflow setup)
---
# Persistence & R2 Sync — Domain Knowledge

## Scope
How user data gets written and how it survives: gesture-based persistence rules, per-user SQLite databases synced to Cloudflare R2, the sync middleware, version tracking, machine pinning, and durability. Auth/sharing/sessions live in Fly Postgres and are NOT synced to R2 (see backend-services.md).

## Entry points
- `src/backend/app/middleware/db_sync.py` — `RequestContextMiddleware` (single combined middleware: auth resolution + profile context + write tracking + R2 sync). Aliased as `DatabaseSyncMiddleware` (db_sync.py:885). Registered in `main.py:124`.
- `src/backend/app/database.py` — profile DB (`user_data/<user_id>/profiles/<profile_id>/profile.sqlite`): `ensure_database()` (database.py:479), `TrackedConnection` (database.py:199, write tracking), sync helpers `sync_db_to_r2_explicit` / `sync_user_db_to_r2_explicit` (database.py:1207/1250), `.sync_pending` marker file helpers (database.py:62-82).
- `src/backend/app/storage.py` — R2 upload/download with version metadata: `sync_database_to_r2_with_version` (storage.py:829), `sync_user_db_to_r2_with_version` (storage.py:1084). R2 keys are env-prefixed: `{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite`.
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
1. **Gesture-based, never reactive** (CLAUDE.md): every DB write traces to a named user gesture. Surgical actions POST only the changed field (`POST .../actions`; backend does read-modify-write on the blob). Full-state saves (`PUT /clips/{id}`, `saveCurrentClipState`) only on explicit export gesture. Reactive `useEffect`→API/store persistence is BANNED (caused T350 keyframe origin corruption; T4020 shadow-version loss). Last surviving violation: game-duration PATCH (T4260).
2. Runtime fixups (keyframe normalization etc.) are memory-only, never persisted; restore is read-only; one write path per piece of data.
3. Writers must commit BEFORE the write lock releases (middleware relies on this for read-your-writes).
4. `SKIP_SYNC_PATHS` (db_sync.py:309) and `AUTH_ALLOWLIST_PREFIXES` (db_sync.py:322) are the only sync/auth bypasses — check them before assuming a route syncs.
5. Background workers (export_worker etc.) must use the `*_explicit(user_id, profile_id)` sync functions — ContextVars are dead outside the request.
6. Action-endpoint RMW atomicity is currently an *accident* of "no `await` between read and commit" (audit B8) — do not insert awaits into `POST /actions` handlers.
7. **Fire-and-forget persistence changes are deferred** until sessions are reliably pinned to a single machine (memory: blocked T1537). Machine pinning exists (T1190) but the constraint stands.

## Landmines & history
- **`skip_version_check=True` at EVERY upload call site** (db_sync.py:271/284, database.py:1164/1237/1277/1345, main.py:268) — R2 conflict detection exists (storage.py:884-897) but is compiled out; cross-machine writes are last-write-wins on the whole profile DB. Being fixed as T4310 (CAS). Do not add new call sites that skip the check without reading T4310.
- **Local dev**: DB changes made directly to a local profile.sqlite get overwritten by R2 restore/sync on reload — edit the R2 copy (`scripts/edit-user-db.py`) or use fallback paths (memory: dev state simulation).
- **T350**: reactive useEffect persistence compounded keyframe fixups into corruption — origin of the gesture-only rule.
- **T4020**: export's redundant post-render full-state save wrote an empty "shadow" working-clip version; bloat-cleanup then pruned the real one = permanent framing loss. Fixed frontend-side; backend-authoritative export (audit B4/T4400) is the structural fix.
- **T4110**: sync-then-announce durable export boundary — implemented for overlay exports only (overlay.py:2122-2196); framing (framing.py:718-722) and multi_clip (multi_clip.py:2298-2301) still announce COMPLETE before unchecked sync → T4200.
- **0.5s defer window** (T2720): middleware sync gives up waiting for the R2 upload lock after 0.5s and defers — annotation sessions can revert wholesale if the machine dies before the next sync (T4320).
- Shutdown sync (main.py:255-276) covers profile DBs only, not user.sqlite.
- `overlay_version` on working_videos is bumped by surgical overlay actions; the orphaned `PUT /overlay-data` (overlay.py:1383) does NOT bump it — deletion pending in T4210.
- `segments_data` has two formats on disk (splits-only from gestures vs full-list from PUT); always `canonicalize_segments_data` before walking pairs — until T4340 canonicalizes at write time.

## Active/upcoming work
Durability & Sync Hardening epic (docs/plans/PLAN.md, in order): **T4310** R2 CAS conflict detection; **T4320** durable clip-creating gestures + user.sqlite in shutdown sync; **T4330** unified action client (per-entity FIFO, version threading, 409 — overlay's `expected_version` check at overlay.py:384-391 is commented out today); **T4340** canonicalize segments_data at write; **T4350** re-transform carried highlights on re-export; **T4360** BEGIN IMMEDIATE + invariant tests. Related bug tier: T4200 (framing/multi-clip sync-then-announce), T4210 (overlay blob decode → 500). Full map: docs/plans/audit-2026-07-03-code-quality.md sections B and G.
