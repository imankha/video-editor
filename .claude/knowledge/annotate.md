---
domain: annotate
updated: 2026-07-11 (T4220/T4260/T4270 bug sweep)
---
# Annotate — Domain Knowledge

## Scope
The Annotate screen (game video → clip regions → raw_clips), game loading/resume, multi-video
virtual timeline, clip metadata editing, the recap viewer's annotate features (T4130), and backend
clip/segment persistence in `clips.py`/`games.py`.

## Entry points
- **Screen**: `src/frontend/src/screens/AnnotateScreen.jsx` — single source of truth for annotate
  state; instantiates `AnnotateContainer(...)` as a plain function call (L187), not JSX.
  Owns `useVideo` (single-video ref) + `useZoom`.
- **Container**: `src/frontend/src/containers/AnnotateContainer.jsx` — multi-video state,
  `handleLoadGame` (L564-700), `applyGameData` (L467-558), clip write handlers.
- **Early video src**: `src/frontend/src/containers/annotateVideoLoad.js` —
  `buildEarlyGameVideoSrc` (`/api/games/{id}/video` + `#t=` fragment, L26-32); `beginGameVideoLoad`
  sets src synchronously BEFORE awaiting `/load`, deduped per gameId (L58-71);
  `computeResumePosition` (playhead, else viewed-duration high-water if <95%, L90-105).
- **State hooks**: `src/frontend/src/modes/annotate/hooks/useAnnotateState.js` (video
  url/metadata/gameId; seeds early src from `peekPendingGame()` at L34-37); `useAnnotate.js`
  (clipRegions model); `useVirtualTimeline.js` (two builders, see Data flow).
- **UI**: `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` (clip list, sorted by
  videoSequence then startTime); `ClipDetailsEditor.jsx` (per-field gesture persistence);
  `NotesOverlay.jsx` (in-video text overlay: name + rating notation + notes; T4070 game-clock
  badge). Recap viewer: `src/frontend/src/components/RecapPlayerModal.jsx`.
- **Store**: `src/frontend/src/stores/gamesDataStore.js` — `getGame`/`loadGame` (inflight-deduped),
  `finishAnnotation`, `saveLastPlayhead` (keepalive), `readyGames`/`pendingGameIds`/`gamesVersion`
  triple-write (L31-59, audit D6).
- **Backend**: `src/backend/app/routers/clips.py` (prefix `/api/clips`) and
  `src/backend/app/routers/games.py` (`GET /{game_id}/load` at L2178, duration PATCH at L1409).

## Data flow
```
open game → pendingGame breadcrumb → useAnnotateState seeds early /video src (T4000)
  → AnnotateScreen effect consumes breadcrumb → handleLoadGame(gameId, seekTime)
  → beginGameVideoLoad (src now) ∥ GET /api/games/{id}/load
      → {game, playback_url, teammate_tags, teammate_shares}
  → applyGameData: gameVideos from gameData.videos, playhead resume, sharedTagData
  → importAnnotations → clipRegions (each carries rawClipId)
```
- **`/load` carries `game.storage_status`** (`'active'|'expired'`, bug 27p): computed by
  `games.py:_compute_storage_status(expires_at_val, auto_export_status)` — the single source of
  truth shared with `list_games` (game_storage expiry passed, OR no ref but `auto_export_status`
  set = source deleted post-grace). `applyGameData` maps it to `annotateSourceExpired`.
- **One annotation = one `raw_clips` row** (per-user SQLite, not Postgres). Region shape:
  `{id, rawClipId, startTime, endTime, name, tags, notes(≤280), rating(1-5, default 4),
  videoSequence, tagged_teammates, my_athlete, autoProjectId}` (useAnnotate.js:10-30, constants
  L209-213). Natural key everywhere: `(game_id, end_time, video_sequence)`.
- **Gesture persistence** (ClipDetailsEditor → `updateClipRegionWithSync`, AnnotateContainer:832-948):
  - create → `POST /api/clips/raw/save` (`save_raw_clip`, clips.py:911) — idempotent on the natural
    key; new rows have empty `filename` until extraction. **T4175**: for a game clip that reaches
    the expiry sweep unframed, `_export_brilliant_clip` now fills `raw_clips.filename` with the
    preserved per-clip extract (`raw_clips/auto_{game}_{clip}_{hex}.mp4`) — the clip's surviving
    independent source once `games/{hash}.mp4` is reclaimed. So a non-empty `filename` on a game
    clip means "post-expiry preserved extract," read by `resolve_clip_source`.
  - update → `PUT /api/clips/raw/{id}` (clips.py:1052).
  - delete → `DELETE /api/clips/raw/{id}` (clips.py:1184) — cascades to working_clips via FK,
    deletes R2 `raw_clips/{filename}`. **T4800**: also calls `_delete_auto_project` (clips.py:870)
    which now DELETES the clip's auto-reel draft when this was its LAST source clip — even an
    exported one (unpublished working_video/final_video) — because the draft's source is gone and
    it can no longer be edited. It PRESERVES a PUBLISHED reel (`final_videos.published_at` set) and
    a multi-clip project (clip_count>1). Deletes `final_videos` first (no ON DELETE CASCADE on
    `final_videos.project_id`), mirroring `projects.delete_project`.
  - Scrub drags persist on drag-end only. "Create Reel" sends `create_project: true` on the same
    save/update.
- **Multi-video**: `buildFullVideoTimeline(gameVideos)` (useVirtualTimeline.js:136-217)
  concatenates per-half videos into one virtual timeline (`getVideoOffset`, `clampToVideo`);
  `buildVirtualTimeline(clips)` (L12-116) is the separate clip-playback stitcher. Single-video ⇒
  `gameVideos = null`.
- **boundaries_version** is the annotate↔framing invalidation signal on `raw_clips`: bumped by
  `save_raw_clip` on start_time change (clips.py:958-975) and `update_raw_clip` on duration change
  (L1158-1161); `update_working_clip` snapshots it into `working_clips.raw_clip_version`
  (L2059-2062) so framing can detect stale boundaries.
- Playhead: `POST /{game_id}/playhead` (direct overwrite) on tab-hide/pagehide with `keepalive`
  (AnnotateContainer:1206-1222); `POST /{game_id}/finish-annotation` sets
  `viewed_duration = MAX(...)` high-water.

## Invariants & rules
- **segments_data dual format** (working_clips.segments_data, msgpack): gesture `split_segment`
  stores **splits-only** boundaries (no 0, no duration — clips.py:466-481) while PUT full-state
  stores the **full list** `[0, ...splits, duration]`. Every consumer MUST call
  `canonicalize_segments_data` (`src/backend/app/highlight_transform.py:87-131`; detects format by
  `boundaries[0] <= 0.01`) before walking boundary pairs — `segmentSpeeds` is keyed by interval
  index over the FULL list, so walking splits-only pairs shifts every speed by one (Bug 20p:
  slow-mo/realtime swapped). Callers: export/framing.py:456, export/multi_clip.py:1925/2092.
  **Non-caller (latent)**: export/overlay.py:1307-1320 reads raw and uses `boundaries[-1]` as
  duration. T4340 moves canonicalization to write time.
- **Persistence is gesture-based.** Every ClipDetailsEditor field change is an immediate surgical
  save from its handler. The bulk path `PUT /{game_id}/annotations` → `save_annotations_to_db`
  (games.py:1599-1699) still exists but its frontend caller (`gamesDataStore.saveAnnotations`,
  L295-319) has ZERO callers — orphaned pair slated for deletion (T4270).
- **Selection state machine**: `useClipSelection()` is the single source of truth for selection +
  overlay (AnnotateContainer:188-201); `useAnnotate` delegates selection out via `onSelect`.
- **Auto-reel draft dies with its last source clip (T4800).** Deleting a raw clip deletes its
  auto-created reel draft when no other source clip remains (unless the reel is PUBLISHED). This is
  the ONLY orphan producer, so it's fixed at the root — there is deliberately NO read-time
  `clip_count == 0` filter in the feed and NO client guard (they would hide the bug; a 0-clip draft
  appearing in Reel Drafts is a visible signal that a producer was missed). Root cause of the old
  orphan: `_delete_auto_project` used to KEEP any project with `working_video_id OR final_video_id`,
  so an exported auto-reel survived clip-delete with 0 clips.
- **Clip-level deletes do NOT archive.** `DELETE /raw/{id}` and `remove_clip_from_project`
  hard-delete rows. R2 archiving is project-level only:
  `src/backend/app/services/project_archive.py:archive_project` serializes project + ALL
  working_clips versions to msgpack on R2, then deletes rows (L47-122); `restore_project`
  re-inserts (L244-251). R2 archives are therefore the only place deleted working_clips state
  survives.
- **Recap clips ARE raw_clips** (T4130): `RecapPlayerModal.jsx` — "a recap clip's id IS its
  raw_clip id" (L133-136); `handleCreateRecapClip` (L145-160) is a gesture-driven
  `updateClip(clipId, {create_project: true})` → `PUT /clips/raw/{id}`, optimistically flips
  `in_drafts`; button disabled while `in_drafts` is true. Clips have NO independent source video,
  so re-materializing clips from an expired game was deferred.
- **Expired-game Annotate playback = graceful degradation (bug 27p).** When
  `annotateSourceExpired` (from `/load`'s `game.storage_status === 'expired'`), `AnnotateModeView`
  renders a deliberate yellow "Source video expired" panel in the video area INSTEAD of any
  `<video>` (guards the single-video `VideoPlayer` AND the multi-video branch), so no
  broken/hanging player mounts against the hard-deleted R2 source. The **"Playback Annotations"**
  button is also disabled when expired (its `enterPlaybackMode` is the only entry to the separate
  `isPlaybackMode` return tree, which mounts dual `<video>` A/B against the same dead source — the
  video-area guard alone does NOT cover it). The clips sidebar (`ClipsSidePanel`) is unaffected —
  annotations stay readable. State lives in `useAnnotateState` (`annotateSourceExpired`), set from
  `storage_status` in `applyGameData` and cleared at the start of `handleLoadGame` (so an
  expired->healthy switch doesn't flash the panel); reset in `resetAnnotateState`.
  Re-materialization stays deferred (T4130). The recap viewer has separate expired handling
  (`RecapPlayerModal` `recapVideoMissing`).
- **Resume position**: `computeResumePosition` prefers `last_playhead_position`, falls back to
  viewed-duration high-water when viewed/duration < 0.95 (annotateVideoLoad.js:90-105).

## Landmines & history
- **T4060 load-order coupling (fixed)**: annotations stopped rendering in Annotate for ALL accounts
  because T4000's early `/video` src (seeded by `peekPendingGame` on first render) made
  AnnotateScreen's old `if (annotateVideoUrl) return` guard skip `handleLoadGame` → `/load` never
  ran → empty timeline. Fix at AnnotateScreen.jsx:363-386: a pendingGame breadcrumb means "load
  must win" — `consumePendingGame()` then `handleLoadGame` unconditionally; AbortController for
  StrictMode. Second half: `useAnnotate.importAnnotations` writes `setDuration(overrideDuration)`
  unconditionally (useAnnotate.js:671-679) — the old `!duration` gate broke on the second game open
  (closure held the prior game's duration). Lesson: never gate a load path on "some video src exists".
- ~~**Reactive game-duration PATCH (FIXED T4260, 2026-07-11)**~~: the `loadedmetadata` effect→PATCH `/api/games/{id}/duration` is deleted from `AnnotateContainer.jsx`. The memory-only fixup is kept (console.warn only). Duration is now authoritative at upload finalize (ffprobe). Endpoint `games.py:1409` is removed. Regression test: `test_t4260_duration_source.py`.
- ~~**remove_segment_split wipes speeds (FIXED T4220, 2026-07-11)**~~: `clips.py` re-indexes the `segmentSpeeds` dict on split removal (merged segment keeps the speed if both sides were equal, else omitted; later indices shift down). Frontend `useSegments.js` aligns to the same rule. Regression tests: `test_t4220_remove_split_speeds.py`, `useSegments.removeSplit.test.js`.
- ~~**gamesDataStore.saveAnnotations / PUT /annotations bulk writer (FIXED T4270, 2026-07-11)**~~: `saveAnnotations` (gamesDataStore.js) and its endpoint `PUT /api/games/{id}/annotations` deleted — zero frontend callers confirmed by grep. `save_annotations_to_db` backend function retained (internal callers exist: share materialization, recap flows). The divergent second-writer path is gone; consolidation is audit E11/T4500.
- **save_annotations_to_db is a divergent second writer** (audit E11): its HTTP endpoint is deleted (T4270), but the Python function remains for internal callers. Does NOT bump `boundaries_version` when mutating start_time (L1647). Don't extend it; consolidate onto the gesture path (T4500).
- **editorStore reactive writer**: `useEffect → setAnnotateHasSelectedClip` at
  AnnotateContainer.jsx:241-243 (quest-panel auto-collapse) — dead state slated for deletion in
  T4440; audit D5 moves the gameVideos/tags/share useState + restore-sync effects (L97-99,
  280-298, 323-333) into gamesDataStore selectors (T1540/T4060 class).
- **NotesOverlay ≠ recap viewer**: `modes/annotate/components/NotesOverlay.jsx` is the playback
  text overlay; the T4130 "Annotations tab" work lives in `RecapPlayerModal.jsx` (T4130 comments at
  L31, 131, 390). The Highlights-tab "Create clip" (L203-208) instead jumps to Annotate via
  `setPendingGame(game.id, currentTime)`.
- **T3960 select-on-load**: AnnotateScreen effect (L407-464) re-selects a reel's source clip only
  once clipRegions load AND `duration > 0`, bounded to 40 attempts — timing-sensitive, don't
  "simplify" it.
- **Back-fill on load**: `handleLoadGame` re-saves annotations missing an `id` via `saveClip`
  (AnnotateContainer:640-662) — a load-time write that exists to heal legacy rows; know it's there
  before assuming load is read-only.
- **Upload duplicates game state**: one-time upload-store restore effect (`[]` deps, L280-298) +
  active-upload video restore (L323-333) re-hydrate state when navigating back mid-upload.

## Perf attribution (T4770, 2026-07-09)
- **Annotate video 302→R2 is FAST live (~100ms), NOT slow.** `GET /api/games/{id}/load` and
  `GET /api/games/{id}/video` (302→presigned R2) both re-time ~90–150ms in isolation (co-timed
  `/api/health` ~80ms). In a session HAR they can show 1100–1450ms TTFB — that is **contention
  from `warmAllUserVideos()` (App.jsx:233,336)** streaming many `working_video/stream` through the
  1-vCPU Fly box concurrently, NOT endpoint work. Classic T4000 trap: re-time live before "fixing"
  `/load`/`/video`. T4000's early-src parallelization (load ∥ video) is confirmed working.
- **Home games are gated on `GET /api/bootstrap`** (`setFromBootstrap(data.games)`, App.jsx:212),
  which uses `list_games_metadata` (no presign) — the "defer presigning" suspect is ruled out
  (`GET /api/games` presigns all 6 in ~100ms live). Warm cache barely helps home → server-bound.
- **T4771 landed (2026-07-09): bootstrap PARALLELIZED, not split.** The two read groups now run
  concurrently (user.sqlite on a worker thread, profile.sqlite on the loop) — live TTFB **~657ms→~360ms
  median** (co-timed `/health` ~8ms). Single endpoint, single response shape, read-only. See
  backend-services.md § Landmines for the contextvars-into-thread detail.
- **T4771 games skeleton (perceived-perf).** `gamesDataStore.isLoading` defaults **true**; the Games tab
  renders `<GamesListSkeleton>` (ProjectManager.jsx, GameCard-shaped `animate-pulse` cards) instead of
  bare "Loading games..." text until the first bootstrap/fetch lands. NOTE: the opaque index.html
  preloader (App.jsx `dismissPreloader`, fires AFTER bootstrap) covers the true first paint, so the
  skeleton is seen on non-preloader games-loading transitions (profile switch, empty refetch, fallback),
  not the very first paint — the first-paint latency win comes from the shorter bootstrap. Preloader
  timing deliberately NOT moved (revealing the shell early would flash an empty header/continue-cards).
  Fix fan-out sibling: T4772 (tame the warm storm).
- **My Reels `rank/confidence` dedup (T4775).** `GET /api/rank/confidence` is read via one shared
  in-flight guard: `src/frontend/src/utils/rankConfidence.js` (`fetchRankConfidence(ratio)`, a
  `Map<ratio,Promise>` cleared on settle — mirrors `gamesDataStore._getGameInflight`). All confidence
  reads route through it: `ConfidenceBanner` (My Reels open, both ratios via `Promise.all`),
  `RankingGame` (ratio probe), `useRanking` (in-game refresh). Opening My Reels mounts only the
  banner; it reads BOTH ratios (portrait+landscape) — **2 distinct calls, both needed** (not a dup).
  The "3× rank/confidence" in the T4770 ledger was the StrictMode dev double-invoke (2 ratios × 2
  mounts = 4 in the HAR); the guard collapses each ratio's concurrent dup to one in-flight fetch,
  measured 4→2 per My Reels open (portrait once, landscape once, every run). **Prod single-mount cold
  open had no dup to remove (already 2);** the guard's prod value is defensive coalescing of genuinely
  concurrent callers (banner `refreshKey` refetch racing, banner+ranker overlap) + a single read path.
  Note: the T4770 walkthrough's `myreels:clicked→settled` is a fixed `waitForTimeout(2500)` (spec
  line 291), so it can't move with this fix — the request count is the real signal.

## Cache warming (post-T4772, 2026-07-09)
- **`warmAllUserVideos()` is NO LONGER called synchronously** on home mount / login. App.jsx uses
  `scheduleWarmAllUserVideos()` (cacheWarming.js), which defers the whole warm-all to
  `requestIdleCallback` (timeout 3s; `setTimeout` 1.5s fallback) so warming never competes with
  bootstrap + first paint + the user's first navigation.
- **Warm concurrency is hard-capped at 1** (`MAX_WARM_CONCURRENCY`, `getWorkerCount()` returns 1).
  Every same-origin warm streams THROUGH the 1-vCPU Fly bounded proxy; N-at-once starves the
  foreground. Was up to 4 (connection-type dependent); now always serialized.
- **Off-screen working (draft) videos are NOT warmed from home.** `warmAllUserVideos` no longer
  enqueues `data.working_urls` (workingQueue stays `[]`) and skips the tier-1 `has_working_video`
  branch (`continue`). Only targeted **clip ranges** (1MB head + clip region on the active game),
  `game_urls`, and `gallery_urls` warm. A draft's `working_video/stream` is fetched by the player
  when the user actually opens it; the 1KB pre-warm bought marginal edge-priming at the cost of the
  systemic storm. Working-video byte-path speed itself is T4773 (proxy TTFB / 302→R2).
- **Evidence (T4772 walkthrough, medians of 3):** warm `working_video/stream` overlapping the
  Annotate/Overlay/My-Reels foreground windows dropped **3→0** (16→0 total in HAR); overlay foreground
  stream TTFB 848→626ms. FOREGROUND_PROXY/DIRECT abort + `clearForegroundActive` resume machinery is
  unchanged — a warmed foreground video (game clip ranges / gallery) still starts fast.

## Active/upcoming work
- ~~**T4220**~~ DONE 2026-07-11 (speed re-index).
- ~~**T4260**~~ DONE 2026-07-11 (reactive PATCH removed; clears way for T4290 ESLint guardrail).
- ~~**T4270**~~ DONE 2026-07-11 (saveAnnotations + PUT endpoint deleted; DELETE /dedupe/{id} fixed to use cascade cleanup, not deleted).
- **T4320** (Durability epic): `Depends(durable_sync)` on `/clips/raw/save` + finalize —
  annotation saves currently ride fire-and-forget R2 sync (0.5s deferral); machine replacement can
  revert a whole toasted session.
- **T4340**: canonicalize segments_data at write time + migration rewriting existing rows (tuple
  row-factory gotcha); readers then stop normalizing.
- **T4500** (Editor Decoupling, audit D5): annotate API data (gameVideos/tags/share) →
  gamesDataStore selectors; **T4440** deletes `annotateHasSelectedClip` + its reactive writer.
