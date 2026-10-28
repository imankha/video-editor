# T13810 Design: sync trace instrumentation (deltas against the task file)

**Status:** AWAITING APPROVAL. No implementation code has been written.
**Knowledge docs consulted:** persistence-sync.md, annotate.md, export-pipeline.md (to be updated at the last step).

## Ground-truth check (2026-10-28, against master 4aa2c41c3)

Confirmed as written: the holder table's store shapes (`projectsStore` `projects`/`selectedProject`, `galleryStore` `count`/`collectionsVersion`/`justPublished`), `fetchProjects`/`fetchCount` dedup promises, `X-Request-ID`/`X-Profile-ID` injected in `sessionInit.js` (~:91), `[REQ]` lines at `db_sync.py:880-914` (four variants; all need `profile=`), `GET /api/downloads/count` semantics, `_get_highlight_instances_by_clip`, `_compute_reel_counts`.

Deltas found:

1. **`routers/qa.py` does not exist.** `test_seams.py` is mounted only when `_test_seams_enabled()` (dev/test), so the probe cannot live there: the user QAs on staging. Create `routers/qa.py`, always mounted in `main.py`, authenticated, read-only.
2. **The downloads count query is inline** in `get_download_count` (`downloads.py:2574`), not a helper. Mechanical first commit step: extract `_downloads_counts(cursor) -> {count, unwatched_count}` and have the endpoint call it, so the probe imports the same function. `_compute_reel_counts(cursor, game_ids)` (`games.py:1547`) and `_get_highlight_instances_by_clip(cursor, raw_clip_ids)` (`clips.py:1297`) are already cursor-based pure functions; no refactor needed.
3. The task's `downloads.py` anchors (`:1364 :1905 :2255 :2410 :2600`) are the route decorators; `[STATE]` goes after each handler's commit. `projects.py:904` delete and `publish_final_video.py:164` finalize likewise.
4. `useDownloads.js:134` dead-copy `count` is confirmed a gap, not touched here (non-goal).

## Decisions on the two open choices

**Buffer placement: separate 500-entry ring inside `syncTrace.js`.** `analytics.js` imports the stores (`useProjectsStore`, `useGalleryStore` path via subscriptions), and the stores must import `syncTrace`; putting the ring in `analytics.js` would create an import cycle. `syncTrace.js` stays import-free (no React, no stores, no analytics). `analytics.js` gains one export, `getActionLog()` is unchanged, and the bug-report path appends `getSyncEntries()` so `/logdump`-style reports carry both. The 200-entry breadcrumb ring is not resized.

**Probe location: `GET /api/qa/sync-state` in new `routers/qa.py`**, always mounted, own profile only (uses the request's profile DB connection, same as every list endpoint), read-only.

## Frontend

- `utils/syncTrace.js`: `record({kind, holder, reason, reqId, summary})`, `entries()`, `dump()`, `lastRefresh(holder)`, `lastWriteAfter(holder, t)`, `registerHolder(name, getter)` / `unregisterHolder(name)` (module-level Map for component-held state: collections summary/members, annotate highlight instances), and `diffAgainstServer(clientSnapshot, serverTruth)` (pure; this is the checker's behavior and gets red-to-green tests). Installs `window.__syncTrace = {entries, dump}` and `window.__syncCheck` on import.
- `reason` is a plain string literal at each call site. Missing reason records `unspecified:<top non-store stack frame>`.
- Reason params added to: `projectsStore.fetchProjects/fetchProject/refreshSelectedProject`, `galleryStore.fetchCount/notifyCollectionsChanged/setJustPublished/clearJustPublished`, `gamesDataStore.fetchGames/invalidateGames`, `exportStore.completeExport/failExport`, `useCollections` summary and members fetches, `AnnotateContainer` instances refresh and `importAnnotations`.
- Callers pass reasons: publish, restore, delete-highlight, move, export-complete, bootstrap, mount, tab-active.
- `write` entries (with `X-Request-ID`) for publish/restore/delete/move/delete-project/WS export complete; non-ok responses log `ok:false, status`. Request id: `apiFetch` already sets `X-Request-ID` on `init.headers`; expose it by attaching `response.reqId` in the interceptor (no signature change; additive property).
- `__syncCheck({rawClipId, projectId, gameId})`: fetches `/api/qa/sync-state` plus the existing lists, diffs each holder, prints a table with the holder's last fetch/signal and the newest later `write`, and reports the `getClipStages` stage from client copy vs server instances.
- No `useEffect` writes anything; registry writes happen in the same place the hook/container sets its state and are cleared on unmount (cleanup only, no persistence).

## Backend

- `[REQ]` lines gain `profile=<X-Profile-ID>` (all four variants).
- `[STATE] gesture=... req_id=... user=... profile=... project=... archived_at=... final_video_id=... auto_project_id=... final_videos=[(id,version,published_at)...] downloads_count=... game_reel_count=...` logged by one shared helper `log_state(cursor, gesture, ...)` after commit, READ BACK from the DB. Gestures: publish, restore, delete-download, move (both routes), delete-project, export-finalize.
- Restore logs user + req_id at start and on each early return (404, 500).
- `GET /api/qa/sync-state` returns `project`, `final_videos`, `raw_clip` + `highlight_instances`, and `counts` from the shared helpers above.

## Tests (named relevant set)

New: `syncTrace.test.js`, `syncTrace.reasons.test.js`, `test_t13810_sync_state_probe.py`, `test_t13810_state_log.py`.
Regression (unchanged, must stay green): `AnnotateContainer.highlightInstancesSync.test.jsx`, `ProjectManager.publishRetry.test.jsx`, `ExportButtonContainer.completionDedup.test.jsx`, `ProjectContext.test.jsx`, plus the backend publish/restore/count tests found at implementation time.

## Risks

- Reasons test greps call sites by string; it must name the files explicitly, not scan the tree.
- `[STATE]` read-back adds 2-3 cheap queries per mutating gesture; reads stay quiet.
- Restore ordering bug (`published_at` nulled before archive restore) is only made visible here; fixing it is a separate task.

## Open question for the user

None blocking; approve this design or send corrections.
