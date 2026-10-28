# T13810: Sync instrumentation: every "UI shows X, DB says Y" names the stale holder, its last refresh, and the write that should have refreshed it

**Status:** STAGING
**Impact:** 9
**Complexity:** 6
**Tier:** L (2 layers, ~14 files, one new cross-cutting pattern; design gate is a confirmation of the design below, not a blank-page design)
**Created:** 2026-10-28
**Updated:** 2026-10-28
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Why

Staging QA on 2026-10-27 (T13780, T13790, T13800) produced a chain of "desyncs": a Finished badge of 1 over an empty list, a badge that dropped to 0 on Finish, an Annotate card saying "Finished" for a highlight the Finished tab did not show. Each had a root cause that took an hour of DB forensics to find, and the user could not reproduce them because the stale data moved faster than the repro. The paradigm (write to the server, write back into a store, UI bound to the store) is sound; what is missing is any way to see, at the moment a screen looks wrong, WHICH holder is stale, WHEN it was last refreshed, by WHICH gesture, and what the server said at that moment.

This task adds that instrumentation. It changes no behavior and persists nothing. Its acceptance test is: a QA run that hits a desync produces, from the browser console and the backend log alone, the exact file:line to fix.

## Ground truth (code-expert audit, 2026-10-28; verify at task start, cite in the design)

Holders of finished-state on the client, and how each is refreshed today:

| Holder | Where | Refreshed by | Known gaps |
|---|---|---|---|
| Project list (`is_published`, `has_final_video`, `is_auto_created`) | `stores/projectsStore.js:26`, `fetchProjects` `:43` | bootstrap; `fetchProjects({force})` from publish (`usePublishProject.js:152`), restore (`useReEditReel.js:64`), export complete (`handleOverlayExportCompletion.js:79`), several others | `selectedProject` (`:27`) is a separate copy never updated by `fetchProjects` |
| Finished count / unwatched | `stores/galleryStore.js:20-22`, `fetchCount` `:95` | publish, restore, WS complete (`useDownloads.js:427`), mark-watched, move | **not on delete highlight** (`PublishedReelsPanel.jsx:476-484` decrements `useDownloads`'s own `count` at `useDownloads.js:134`, a dead copy) |
| `collectionsVersion` signal | `galleryStore.js:28,70` | publish, restore, partial move | consumed only while the Finished tab `isActive` (`useCollections.js:214-230`) |
| Collections summary + members | `hooks/useCollections.js:29-31` (component state) | mount, version bump while active, `fetchSummary` after delete/move | members never refetched once `ready` except on a version bump |
| `justPublished` marker | `galleryStore.js:36,44` | set by publish (`usePublishProject.js:136`), cleared by the card's X | **not cleared on restore, delete or move**; `JustPublishedCard.jsx:62` self-hides only if the member is absent |
| Games list (`reel_count`, `clip_count`) | `stores/gamesDataStore.js:47,52` | bootstrap, game CRUD, upload, link clip | **never on publish, restore, delete highlight or move** (`GameTile.jsx:109-115` shows stale "N published") |
| Per-play highlight instances (`isPublished`, `hasFinalVideo`, `hasWorkingVideo`) | `useAnnotate` state `clipRegions[].highlightInstances` (`AnnotateContainer.jsx:855-867`), mapped by `modes/annotate/highlightInstances.js:9` | `/load` import (`useAnnotate.js:769`), create response (`AnnotateContainer.jsx:896-906`), export-complete refresh (`:915-937`) | **the Annotate card's only input**; publish/restore/delete while Annotate is mounted are not observed; `gamesDataStore.selectedGame.annotations` is a second unread copy |
| Framing in progress | `stores/exportStore.js` `activeExports` | WS manager, recovery | derived at render by `clipStage.js:157` |
| Finished-viewer payload | `useReelPreviewStore` via `finishedReelNav.js:50-69` | `openFinishedReel` | snapshot of `alreadyPublished`, `staleShare` |

Derivations: `modes/annotate/clipStage.js:93` (`getClipStage`, checks `is_published` before the staleness gate at `:134`) and `:182` (`getClipStages`), called at `AnnotateModeView.jsx:273,538,540,542`; `utils/draftStage.js:98-133` for the Clips tab; `utils/reelReEditable.js:25` for Re-edit. Backend `is_published` is `EXISTS(final_videos.published_at)` over ANY version (`projects.py:455-458`, `clips.py:1328`) while counts use the latest version; they agree only because restore nulls every version (`downloads.py:2654`).

Existing instrumentation: `utils/analytics.js:34-52` keeps a 200-entry breadcrumb ring buffer (`getActionLog()` `:73`), subscribed via `setupActionTracking` (`:84-141`) to editorMode, selectedProjectId, selectedGame.id, selectedClipId, play state, export status. It does NOT watch galleryStore, projectsStore contents, gamesDataStore, or highlight instances. Every request carries `X-Request-ID` and `X-Profile-ID` (`utils/sessionInit.js:91-92`). Backend `[REQ]` middleware line (`middleware/db_sync.py:913-918`) has user and req_id, no profile. Publish logs are good (`downloads.py:2432-2553`); restore logs (`:2665,2692,2694`) have no user, req_id, or resulting state; delete logs only the id (`:1423`); read endpoints log nothing about the state they return.

## Solution

Four pieces. All memory-only on the client, log-only on the server, zero new persistence, zero new UI (no chips, no banners; CLAUDE.md "No Saved UI copy" applies). Extend `analytics.js`'s ring buffer rather than building a parallel one.

### 1. `syncTrace`: one ring buffer, one vocabulary (frontend)

`src/frontend/src/utils/syncTrace.js`, writing into the existing `analytics.js` breadcrumb buffer under a `sync` category (raise the buffer to 500 entries, or give the sync category its own 500 slot ring inside the same module; decide in the design). Entry shape, every field required:

```
{ t: performance.now()+epoch, kind: 'fetch'|'write'|'signal'|'derive'|'check',
  holder: 'projectsStore.projects'|'galleryStore.count'|'gamesDataStore.games'|'collections.summary'|'collections.members'|'annotate.highlightInstances'|'exportStore.activeExports'|'galleryStore.justPublished'|...,
  reason: 'publish'|'restore'|'delete-highlight'|'move'|'export-complete'|'bootstrap'|'mount'|'tab-active'|'unspecified:<caller>',
  reqId: <X-Request-ID of the triggering request, when there is one>,
  summary: <small object: counts, ids with flags; never whole payloads> }
```

Always on (a 500-entry ring of small objects is free); dumping is explicit. `window.__syncTrace.dump()` prints compact `[SYNC] ...` lines suitable for copy -> `/logdump`; `window.__syncTrace.entries()` returns the array for Playwright. Register the window hook unconditionally (the data is the user's own session state; nothing sensitive), but keep the module import-free of React so it is store-safe.

### 2. Every refresh names its reason; every write names its request (frontend)

- Add an optional `reason` to each refresh entry point and log a `fetch` entry when it resolves, with the summary: `projectsStore.fetchProjects/fetchProject/refreshSelectedProject`, `galleryStore.fetchCount/notifyCollectionsChanged/setJustPublished/clearJustPublished` (`signal` kind for the last three), `gamesDataStore.fetchGames/invalidateGames`, `useCollections` summary + members fetches, `AnnotateContainer` highlight-instances refresh and `importAnnotations` (summary = per-play `{clipId, instances:[{projectId, orientation, isPublished, hasFinalVideo, hasWorkingVideo}]}` for the selected region only), `exportStore.completeExport/failExport`.
- Callers that already refresh pass their reason: `usePublishProject` -> `'publish'`, `useReEditReel` -> `'restore'`, `PublishedReelsPanel` delete/move -> `'delete-highlight'`/`'move'`, `handleOverlayExportCompletion` -> `'export-complete'`, App bootstrap -> `'bootstrap'`, `useCollections` mount/version -> `'mount'`/`'tab-active'`. Callers that pass nothing log `unspecified:<top non-store stack frame>` so the trace itself flags unlabeled refreshes (there should be none when this lands; a unit test asserts the known call sites all pass a reason).
- Write gestures log a `write` entry with the request's `X-Request-ID` (read it where the interceptor sets it, `sessionInit.js:91`, or have `apiFetch` return it) and the response's state summary: publish `{projectId, archived}`, restore `{downloadId, projectId}`, delete `{downloadId}`, move `{ids, targetProfile}`, delete project `{projectId}`, WS export complete `{exportId, projectId, workingVideoId}`. Non-ok responses log `write` with `ok:false, status` so a failed restore is visible in the trace.

### 3. `__syncCheck`: the consistency checker (frontend + one backend probe)

`window.__syncCheck({ rawClipId?, projectId?, gameId? })` fetches server truth and diffs it against every client holder, then prints a table of mismatches, each row carrying the holder's LAST `fetch`/`signal` entry (reason, reqId, age) and the most recent `write` entry newer than it. That last column is the diagnosis: "galleryStore.count=1 server=0; last refresh bootstrap 212s ago; write restore req_id abc 40s ago did not refresh it" points straight at the gesture handler.

Server truth comes from one new read-only endpoint plus the existing lists:

- **New** `GET /api/qa/sync-state?project_id=&raw_clip_id=&game_id=` (`routers/qa.py` or beside `test_seams.py`; authenticated session, own profile only, no test-mode gating because the user QA's on staging; read-only; cheap). Returns, for the ids given: `project {id, archived_at, restored_at, final_video_id, is_auto_created, source_raw_clip_id}`, `final_videos [{id, version, published_at, watched_at, filename}]` for the project, `raw_clip {id, auto_project_id, my_athlete, shared_by}` plus its `highlight_instances` exactly as `clips.py:1328` computes them, `counts {downloads_count, downloads_unwatched, game_reel_count}` using the SAME query functions the list endpoints use (import them; do not re-implement, or the probe lies).
- Existing: `/api/downloads/count`, `/api/projects`, `/api/games`, `/api/collections/summary`.

Client side compared: `galleryStore.count/unwatchedCount`, `projectsStore.projects` (presence + `is_published`/`has_final_video`/`is_auto_created` for the project), `projectsStore.selectedProject` when it is that project, `gamesDataStore.games[gameId].reel_count`, `useCollections` summary/members when mounted (expose the current values through a tiny registry the hook writes into, memory-only), the Annotate region's `highlightInstances` when Annotate is mounted (same registry), `galleryStore.justPublished`. Also run `getClipStages` on both the client copy and the server instances and report when the derived STAGE differs, since that is what the user sees.

### 4. Backend: `[STATE]` after every mutating gesture, profile on every request line

- `[REQ]` middleware line gains `profile=<X-Profile-ID>`.
- After commit in each mutating route, one `[STATE] gesture=<publish|restore|delete-download|move|delete-project|export-finalize> req_id=... user=... profile=... project=<id> archived_at=... final_video_id=... auto_project_id=<raw_clip> final_videos=[(id,version,published_at)...] downloads_count=<n> game_reel_count=<game:n>` line, READ BACK from the DB (never from intent). Routes: `downloads.py` publish (`:2410`), restore-project (`:2600`), delete (`:1364`), move (`:1905`, `:2255`); `projects.py` delete (`:904`); `publish_final_video.py` finalize (`:164`). Restore additionally logs user + req_id at start and on each early return (404 archive, 500), so a half-applied restore (`published_at` nulled at `:2654` before the archive restore at `:2671`) is diagnosable from the log; fixing that ordering is a separate bug task, not this one.
- Read endpoints stay quiet (the probe covers them).

## Non-goals

- Fixing any gap the audit found (`reel_count` refresh, delete-highlight badge, failed-restore refresh, restore ordering, Annotate copy listening to publish/restore). Each is or becomes its own task; T13820 confirms them with evidence. This task makes them visible, it does not paper over them. No reactive persistence, no `useEffect` that writes anywhere.
- Any visible UI.
- Server-side persistence of traces.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/syncTrace.js` (new), `src/frontend/src/utils/analytics.js` (ring buffer + category)
- `src/frontend/src/stores/projectsStore.js`, `galleryStore.js`, `gamesDataStore.js`, `exportStore.js` (reason param + trace calls)
- `src/frontend/src/hooks/useCollections.js`, `usePublishProject.js`, `useReEditReel.js`, `useDownloads.js` (reasons, write entries, registry)
- `src/frontend/src/containers/AnnotateContainer.jsx` (instances trace + registry), `src/frontend/src/components/collections/PublishedReelsPanel.jsx` (reasons), `src/frontend/src/utils/handleOverlayExportCompletion.js`, `src/frontend/src/App.jsx` (bootstrap reason, window hook registration)
- `src/frontend/src/utils/sessionInit.js` or `apiFetch` (expose X-Request-ID to callers)
- `src/backend/app/routers/qa.py` (new probe) or `test_seams.py` sibling; `src/backend/app/main.py` (router include)
- `src/backend/app/routers/downloads.py`, `projects.py`, `src/backend/app/services/publish_final_video.py` ([STATE] lines), `src/backend/app/middleware/db_sync.py` (profile on [REQ])
- Tests: `src/frontend/src/utils/syncTrace.test.js` (ring, dump format, checker diff + attribution), `src/frontend/src/stores/syncTrace.reasons.test.js` (every known refresh call site passes a reason; `unspecified` count is 0 in the covered flows), `src/backend/tests/test_t13810_sync_state_probe.py` (probe equals list endpoints for a seeded profile: publish then compare counts/instances), `src/backend/tests/test_t13810_state_log.py` (caplog: [STATE] after publish and restore reads back DB values)

### Related Tasks
- T13790, T13800, T13780 (the staging incidents that motivated this)
- T13820 (the Playwright sync QA run; consumes `__syncCheck`, `__syncTrace.entries()`, and the probe)
- T10070, T11160 (prior "highlight unreachable" incidents with the same shape)

### Knowledge docs
- `.claude/knowledge/persistence-sync.md`, `.claude/knowledge/annotate.md` (clipStage, highlight instances), `.claude/knowledge/export-pipeline.md` (publish/restore). Update all three at Stage 7 with the trace vocabulary and the probe.

### Technical Notes
- Behavior-preserving task: proof is characterization evidence (existing curated tests unchanged and green) plus the new tests; do not invent a failing behavior for the instrumentation itself. The checker's diff/attribution logic IS behavior and gets red-to-green unit tests.
- `reason` is a plain string literal at each call site (greppability rule; no enum registry that hides call paths).
- Keep `syncTrace` free of store imports; stores import it. The registry for component-held state (collections, annotate instances) is a plain module-level Map written by the hook/container in the same place it sets state, cleared on unmount.
- The probe must reuse `queries.py` / router helpers for counts and instances (`_compute_reel_counts`, the downloads count query, the `highlight_instances` builder at `clips.py:1328-1343`). If a helper is not importable without a request context, refactor it minimally into a pure function first (mechanical commit).
- Design gate: produce `docs/plans/tasks/T13810-design.md` by confirming or correcting the table above against code and settling the two open choices (buffer placement; probe location). Ask for approval, then implement. Keep the design short; the decisions are made here unless code contradicts them.

## Implementation

### Steps
1. [ ] Verify the ground-truth table against code; write `T13810-design.md` (deltas only); approval
2. [ ] `syncTrace.js` + analytics buffer category + window hooks; unit tests (ring, dump, diff, attribution)
3. [ ] Reasons on every refresh entry point and caller; `write` entries on publish/restore/delete/move/delete-project/WS complete; reasons test
4. [ ] Backend probe + [STATE] lines + profile on [REQ]; backend tests
5. [ ] `__syncCheck` wired to probe + lists + registry; demo in dev: publish, then restore, then `__syncCheck()` prints zero mismatches for surfaces that refresh and names the known gaps (reel_count, Annotate copy) with their last-refresh attribution. Save that console output as evidence.
6. [ ] Curated tests + lint (frontend + backend); knowledge docs; review on the diff

### Progress Log

**2026-10-28**: Filed from the 2026-10-27 staging QA incidents and the code-expert sync audit.

## Acceptance Criteria

- [ ] After any of publish / restore / delete highlight / move / export complete, `window.__syncTrace.dump()` shows a `write` entry with the request id and, for each holder that refreshed, a `fetch`/`signal` entry with a non-`unspecified` reason
- [ ] `window.__syncCheck({projectId, rawClipId, gameId})` reports zero mismatches when the UI is correct, and for a stale holder names: holder, client value, server value, last refresh (reason, reqId, age), and the newer write that did not refresh it
- [ ] `getClipStages` stage computed from the client copy vs the server instances is part of the report
- [ ] Backend log carries `profile=` on `[REQ]` and one `[STATE]` line per mutating gesture with DB-read-back values; restore logs user and req_id on every exit path
- [ ] `GET /api/qa/sync-state` answers from the same query helpers as the list endpoints (test proves equality after a publish)
- [ ] No new UI, no new persistence, no reactive writes; existing curated tests unchanged and green
