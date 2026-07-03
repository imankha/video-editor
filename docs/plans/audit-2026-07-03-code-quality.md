# Code Quality Audit — 2026-07-03

Five parallel audits (frontend state/sync, frontend DRY, backend architecture, persistence pipeline end-to-end, LLM-era best-practices research) consolidated into proposals. Goal #1: DRY (fix bugs once, build underlying systems). Goal #2: sync model (MVC, gesture-based persistence, single source of truth, event subscription). Goal #3: dependence minimization — isolate work so it's independently testable, and eliminate timing dependencies ("A must happen before B") that are race-condition precursors.

Each proposal is tagged with the directive(s) it serves: **[DRY]**, **[SYNC]**, **[DEP]**.

**Overall verdict:** The gesture/surgical persistence architecture is holding on the frontend (no banned reactive editing-state persistence survives; T350/T3800/T4020 lessons are pinned). The residual risk has moved to (a) **durability down the stack** — R2 conflict detection compiled out, sync-then-announce only covers overlay exports — and (b) **half-adopted shared systems**: the abstractions mostly exist (keyframe controller, queries.py, ffmpeg_service, constants enums, timeFormat) but one consumer adopted them and siblings kept forks. Overlay mode is systematically one refactor behind framing. Backend routers never got the service split (~300 raw cursor.execute in routers; routers/export/ is 5,878 lines).

**Live bugs found by the audit:** exports.py:279 NameError (every Modal recovery "succeeds then reports failure"); highlight spline interpolator drops strokeOpacity/fillOpacity between keyframes; OverlayScreen pass-through reads clip fields that don't exist since T250; corrupt overlay blob silently becomes `[]` then persists; remove_segment_split wipes all segment speeds; projects.py catch-all writes NULL over crop_data; rename PUT reverts aspect_ratio.

---

## A. Live bugs & silent data-destroyers (small, low-risk fixes)

| ID | Change | Evidence | Impact | Importance | Risk | Size |
|----|--------|----------|--------|------------|------|------|
| A1 | Fix `finalize_modal_export` NameError + narrow the except | exports.py:279 returns undefined `presigned_url`; except at :282 swallows it; committed recoveries report failure | 8 | High | Low | S |
| A2 | Overlay blob decode failure → 500 + log, never `[]` | overlay.py:308-313; next gesture persists empty list = total highlight loss | 9 | High | Low | S |
| A3 | `remove_segment_split`: re-index speeds, don't wipe | clips.py:483-497 sets segmentSpeeds={} on any split removal | 7 | High | Low | S |
| A4 | Remove catch-all that NULLs crop/segments on decode hiccup | projects.py:1275-1276 → writes NULL at :1314-1321; twin block for segments | 8 | High | Low | S |
| A5 | Rename must not carry aspect_ratio (single writer with refit) | projectsStore.js:224-227 sends stale ratio; projects.py:830-832 writes blindly, no refit (vs clips.py:562 refit path) | 7 | High | Low | S |
| A6 | Replace both spline specializations with `interpolateGenericSpline` | utils/splineInterpolation.js:116-206 vs :217-255 (unused generic); highlight copy interpolates legacy `opacity`, drops strokeOpacity/fillOpacity (live bug, masked at HighlightOverlay.jsx:423) | 6 | High | Low | S |
| A7 | Fix/delete OverlayScreen raw-clip pass-through video source | OverlayScreen.jsx:149-160 reads `fileUrl/url/.metadata` — fields raw clips no longer have (T250); never-exported single-clip project gets no video | 5 | Med | Low | S |
| A8 | Remove reactive game-duration PATCH; probe server-side at finalize | AnnotateContainer.jsx:1115-1158 — only remaining effect→API write; bogus duration from partial buffer gets persisted, two tabs ping-pong | 6 | High | Low | S/M |
| A9 | Delete orphaned/dormant full-state writers | PUT /overlay-data (overlay.py:1383-1467, no frontend caller, doesn't bump overlay_version, only writer of raw_clips.default_highlight_regions); gamesDataStore.saveAnnotations (gamesDataStore.js:295-319, zero callers) + its endpoint; dedupe DELETE route (games_upload.py:564-591, leaks storage refs) | 7 | High | Low | S |
| A10 | Backend silent-fallback sweep (fail visibly per project rule) | clips.py:402-406 fabricates crop geometry (`or 0/640/360`); games.py:964 `status or 'ready'`, :930 unparseable expiry → active; exports.py:296-309 Modal API error → "not running" → cleanup marks live job error; exports.py:216 fabricated filename; export_worker.py:198-204 error handler NameErrors; local_processors.py:65-66 probe fail → 1920×1080 | 7 | Med | Low-Med | M |

## B. Durability & sync model (directive #2)

| ID | Change | Evidence | Impact | Importance | Risk | Size |
|----|--------|----------|--------|------------|------|------|
| B1 | Sync-then-announce for framing + multi-clip exports; multi-clip DB-save failure = terminal error | COMPLETE before sync: multi_clip.py:1440-1448/:1737, sync unchecked in finally (framing.py:718-722, multi_clip.py:2298-2301); multi_clip.py:1436-1437 announces success after swallowed DB failure. Pattern exists in overlay.py:2122-2196 (T4110) | 9 | High | Low-Med | S |
| B2 | Re-enable R2 version-conflict detection (background/worker syncs first, CAS-style) | skip_version_check=True at every call site: db_sync.py:271/284, database.py:1163/1236/1277/1345, main.py:268; check exists at storage.py:884-897. Cross-machine last-write-wins on whole profile DB | 9 | High | Med | M |
| B3 | Durable sync on clip-creating gestures + user.sqlite in shutdown sync | 0.5s deferral window (db_sync.py:199-201, 683-693); durable_sync only on publish/restore/overlay-export; annotation session can revert wholesale; main.py:255-276 skips user.sqlite | 7 | High | Med | S |
| B4 | Backend-authoritative export: replace client full-state PUT with `mark-exported` action (backend snapshots own blobs); multi-clip resolves framing from DB | clips.py:2001-2124 PUT clobbers blob from client state (T4020 class, two-tab clobber); multi-clip sends hook state, no PUT-first (ExportButtonContainer.jsx:626-663), DB stamped exported without reconciliation (multi_clip.py:1427-1432) | 9 | High | Med-High | M/L |
| B5 | Canonicalize segments_data at write time (+ row duration, + migration) | Two formats: splits-only (clips.py:466-472) vs full-list (PUT); every consumer must canonicalize; overlay.py:1307-1320 reads raw | 7 | Med | Med | M |
| B6 | Implement overlay expected_version 409 (scaffolded, commented out); extend to framing via shared action client (C8) | overlay.py:384-391 commented out; frontend already sends versions | 5 | Med | Low | S/M |
| B7 | Re-transform carried-forward highlights on framing re-export | framing.py:234-254 copies old highlights verbatim onto re-timed video; region times point at wrong moments | 6 | Med | Med | S/M |
| B8 | Pin single-machine RMW atomicity (BEGIN IMMEDIATE or test) | clips.py:326, overlay.py:348 — atomic only because no await between read and commit | 4 | Low | Low | S |

## C. Frontend DRY — shared systems

| ID | Change | Evidence | Impact | Importance | Risk | Size |
|----|--------|----------|--------|------------|------|------|
| C1 | **Epic:** migrate overlay onto shared keyframe controller (region-scoped tracks); absorbs T3820 snap unification | useHighlightRegions.js:517-671 re-implements lifecycle vs controllers/keyframeController.js; snap window 5 vs 10; parallel resolveTargetFrame solution (L527-539); hardcoded fps=30 (L40) | 9 | High | High | L |
| C2 | `useVideoDisplayRect` hook (video→screen transform, 3 copies / 3 bug states) | CropOverlay.jsx:37-110 (has first-paint fix, leaks inner rAF), HighlightOverlay.jsx:43-102 (has rAF fix, lacks paint fix), PlayerDetectionOverlay.jsx:32-75 (has neither) | 7 | High | Low-Med | M |
| C3 | Dead-code deletion sweep (absorbs T3810) | modes/overlay/OverlayTimeline.jsx + layers/HighlightLayer.jsx + components/Timeline.jsx (no importers); container wrapper FramingTimeline/OverlayTimeline name collisions (FramingContainer.jsx:995, OverlayContainer.jsx:644); framingStore corpses (clipStates/videoFile/markExported); editorStore.annotateHasSelectedClip (+reactive writer AnnotateContainer.jsx:241); dead OverlayVideoOverlays (OverlayContainer.jsx:629, ReferenceError if rendered) | 6 | High | None | S |
| C4 | Shared `KeyframeTrack` timeline rendering — fixes "can't delete first keyframe" on highlight path | CropLayer.jsx:106-171 vs RegionLayer.jsx: delete gating diverged (`>=1` vs `>2 && !isPermanent` — stale pre-flat-list model) | 7 | High | Low | M |
| C5 | **Epic:** `regionTrack` interval engine (sorted non-overlapping regions + boundary drag + layout %) | useHighlightRegions.js:255-430 vs useAnnotate.js:249-616 vs useSegments.js (820 L) — same interval model 3× | 8 | Med | High | L |
| C6 | `usePlaylistPlayback` (recap/highlights/story) | useRecapPlayback.js vs useHighlightsPlayback.js (same 15-key interface, line-identical cores) vs useStoryPlayback.js | 5 | Med | Med | M |
| C7 | `frameMath` module + one canonical framerate source (kill `\|\| 30` silent fallback in 8+ files) | useVideo.js:443-474 vs useMultiVideoScrub.js:126-157 (fps=30 ×2); videoUtils.getFramerate stub always returns 30; fallbacks in useClipManager.js:46, projectDataStore.js:402, FramingScreen.jsx:219/541/623, useCrop.js:66… | 7 | High | Low | S/M |
| C8 | `createActionClient` factory (framing/overlay gesture transport; gives framing version support) | api/framingActions.js:24-48 ≡ api/overlayActions.js:25-50; only overlay has expected_version | 6 | Med | Low | S |
| C9 | Primitives sweep: timeFormat consolidation (9+ copies); EDITOR_MODES/KeyframeOrigin adoption (absorbs old T302/T303; constants/editorModes.js has ZERO imports, ~15 files use raw literals, 31 raw origin literals); `createStrictContext` (CropContext≡HighlightContext); `Modal` (encodes no-backdrop-close) + `Spinner` primitives (31 hand-rolled backdrops, 48 inline spinners); `apiJson` store fetch helper (13+ identical catch blocks) | multiple | 6 | Med | Low | M |
| C10 | `useEditorScreenShell` + shared keyboard shortcuts in Overlay | FramingScreen.jsx/OverlayScreen.jsx ~1,100-line siblings; identical fullscreen/zoom/video destructure blocks; Overlay re-implements keydown inline (L864-896) with different arrow-key semantics | 6 | Med | Med | M |
| C11 | `createExportDirtySlice` store factory | framingStore hash-based vs overlayStore boolean dirty tracking | 4 | Low | Low | S |
| C12 | Extract `historyStack` from useSegments trimHistory (pre-req for keyframe undo) | useSegments.js:28,183-241,296 — only undo implementation in an app whose worst incidents are destructive edits | 5 | Med | Med | M |

## D. Frontend state/sync cleanup

| ID | Change | Evidence | Impact | Importance | Risk | Size |
|----|--------|----------|--------|------------|------|------|
| D1 | FramingContainer: compute next segment/crop state once per gesture (hook + store mirror + API from same object) | 8 hand-mirror sites (FramingContainer.jsx:352-835) with stale-batch workarounds; syncSegmentsToStore exists unused | 8 | High | Med | M |
| D2 | Kill `clipMetadata` store-as-event-bus; one `loadOverlayData` path | OverlayScreen.jsx:432-497 + 516-562 duplicate 60-line loaders (5 setters already wired twice); producer useProjectLoader.js:189 fires "fresh export" on every load | 7 | High | Med | M |
| D3 | Working-video single owner (`{status, video}` state machine in projectDataStore) | Truth spread over projectDataStore.workingVideo, overlayStore.isLoadingWorkingVideo (set by FramingScreen:954 cross-screen), project.working_video_url, 4 OverlayScreen guard refs + 65-line reconcile effect (:328-392); locus of T1670-family bugs | 8 | High | Med-High | L |
| D4 | `selectedProject` → id + selector over projects[] | projectsStore.js:26/125/220 — rename updates list not snapshot; ProjectContext serves stale copy to both editors | 6 | Med | Med | M |
| D5 | Annotate API data (gameVideos/tags/share) → gamesDataStore selectors | AnnotateContainer.jsx:97-99/248/264 useState + restore-sync effects :280-298/:323-333 (T1540/T4060 class) | 7 | Med | Med | M/L |
| D6 | gamesDataStore: derive readyGames/pendingGameIds in selectors; delete gamesVersion counter | gamesDataStore.js:31-59, 364-371 triple-write lockstep | 5 | Med | Low | S |
| D7 | Misc effect fixes: audio auto-toggle → gesture handler (ExportButtonContainer.jsx:310-318); toast dismissal → gesture wrappers (AnnotateContainer.jsx:1107, OverlayScreen.jsx:749); clip default-selection single owner (useClipManager.js:87-91); dedupe getFilteredKeyframesForExport (FramingScreen.jsx:750≡FramingContainer.jsx:862); single loadClipIntoEditor for FramingScreen 3 load paths (:490-652); hasFramingEdits/effectiveOverlayVideoUrl selector module | 6 | Med | Low-Med | M |

## E. Backend structure

| ID | Change | Evidence | Impact | Importance | Risk | Size |
|----|--------|----------|--------|------------|------|------|
| E1 | `ExportJobRepository` (create/start/complete/fail/recover; ExportStatus enum); fix service→router import inversion | 2 competing create helpers (exports.py:86 'pending' vs export_helpers.py:37 'processing' + swallowed insert failure); 14 raw status-write sites in 5 modules; export_worker.py:28-33 imports from router | 8 | High | Med | M |
| E2 | `finalize_export` service (5 hand-written copies, one drifted) + `publish_final_video` single writer (3 writers; sweep hardcodes version=1/'brilliant_clip') | export_worker.py:259-339, framing.py:227-288, multi_clip.py:1398-1435 + 1660-1727, exports.py:249-268 (omits version/duration); final_videos: overlay.py:152 vs :1262 vs auto_export.py:283 (rank-sweep incident root) | 9 | High | Med-High | M |
| E3 | FFmpeg encode-params module + single probe fn (shared local+Modal); resolve `-shortest` drift; golden-output tests | ~55 arg lists in 13 modules; libx264 block ×15 in video_processing.py (which has its own unused factor at :2347); `-shortest` removed for truncation bug at video_processing.py:474 but still passed at overlay.py:707 + processor_local.py:252; CRF drift 18/23/32; 6+ ffprobe implementations | 8 | High | Med-High | L |
| E4 | Ship app/interpolation.py to Modal (kill 4 Catmull-Rom copies); param-ize L4 fn; delete video_processing_optimized benchmark clones | interpolation.py:10-90 vs ai_upscaler/keyframe_interpolator.py vs video_processing.py:586-1156 vs _optimized.py:206-280; process_framing_ai_l4 = 200-line "identical" copy | 7 | High | Med | M |
| E5 | `fetch_or_404` repository helpers (~45 sites, 34 error-string variants) + finish enums (absorbs old T304/T305; StorageStatus/ExportType/ProjectMode/ShareType; unify 'error' vs 'failed' vocabularies) | clips.py/exports.py/projects.py/games.py existence checks; games.py imports GameStatus but writes literals (:315/:338/:356/:1271); aspect-ratio list duplicated projects.py:500/:621 | 6 | Med | Low | M |
| E6 | `require_admin` as router-level `Depends` | admin.py: 25 imperative _require_admin() calls; one forgotten = open admin endpoint | 7 | High | Low | S |
| E7 | `R2StreamProxy` service (windowing + pooled client + retry) | 4 copies: clips.py:1767-1998, projects.py:965-1110, games.py:2302-2508, downloads.py:660+; pooled-client TTFB fix only in downloads.py:646; retry generator duplicated verbatim clips.py:1685≡downloads.py:589 | 7 | Med | Med | M |
| E8 | **Epic:** export orchestration — move pipelines out of routers/ into services (YOLO, multi-clip, overlay dispatchers); unify sweep auto-export onto export_jobs; merge duplicate send_progress/progress_callback/post-export-sync pairs | routers/export/ = 5,878 lines; multi_clip.py 2,500 L with 3 routes; 6 trigger pipelines, sweep fully parallel (no job record, own ffmpeg, status in games.auto_export_status) | 9 | Med | High | L |
| E9 | games.py services: `GameActivationService` (185-LOC handler, 3 datastores, mid-handler commit) + single `share_game_flow` (~130 lines copy-pasted between share/share_playback incl. except-pass) | games.py:568-758, :1809-1950 vs :1957-2142 | 6 | Med | Med-High | L |
| E10 | `open_sqlite` factory (privacy.py connects with NO pragmas/timeout) + `game_display.py` service (100 lines byte-identical projects.py:58-160≡downloads.py:67-166) | database.py:1045 canonical; drifted copies user_db.py:190, materialization.py:30, privacy.py:65/87 | 5 | Med | Low | S |
| E11 | Consolidate raw_clips dual write path (bulk save_annotations_to_db vs gesture save/update) | games.py:1599-1699 vs clips.py:911-1181 — duplicated boundaries-version logic, violates single-write-path | 7 | Med | High | M |
| E12 | Adopt queries.py in projects.py:338-344 (divergent wc.id DESC tiebreak — decide correct ordering) | T1532-class divergence | 5 | Med | Low-Med | S |

## F. Guardrails (from LLM-era best-practices research)

| ID | Change | Evidence/rationale | Impact | Importance | Risk | Size |
|----|--------|--------------------|--------|------------|------|------|
| F1 | ESLint rule: no fetch/API/store-writes inside useEffect (mechanically enforce the ban); lint raw mode/status literals | Research: conventions agents can't regress must be lint-enforced, not prose; the one surviving violation (A8) proves prose isn't enough | 7 | High | Low | S/M |
| F2 | Golden-output/characterization test harness for export pipeline (pre-req for E2/E3/E4/E8) | Strangler-fig + characterization-tests-first is the consensus safe path for agent-driven consolidation | 7 | High | Low | M |
| F3 | Refactor process rules: abstract on 3rd duplication; codemod-style moves as separate commits; update CLAUDE.md/skills in same PR; diffs <200 lines per reviewable unit | Research brief (Sourcegraph/CodeScene/arXiv agentic-refactoring) | 5 | Med | Low | S |

## G. Dependence minimization & timing-dependency elimination (directive #3)

Existing proposals that are *primarily* timing-dependency fixes: **B1** (announce-before-sync is an ordering inversion), **B8** (RMW atomicity depends on "no await between read and commit"), **D1** (FramingContainer's hand-mirrors exist to work around React batch ordering — comments literally say "segmentBoundaries won't have the new value yet"), **D2** (clipMetadata is a cross-screen timing signal: producer must write before consumer's effect fires, and it misfires on ordinary loads), **D3** (overlayStore.isLoadingWorkingVideo is set by FramingScreen *before* navigation as a timing contract; 4 guard refs exist to sequence load/recovery), **D7-loadClipIntoEditor** (FramingScreen's 3 overlapping load effects are coordinated by refs whose correctness depends on effect firing order), **D7-audio** (auto-toggle races user intent against re-render timing). Pure-module extractions (C7 frameMath, C5 regionTrack, A6 spline, E4 interpolation) serve isolation-for-testability directly: pure functions with no timing surface.

New proposals surfaced by this lens:

| ID | Change | Evidence/rationale | Impact | Importance | Risk | Size |
|----|--------|--------------------|--------|------------|------|------|
| G1 | Per-entity serialized gesture-action queue in the shared action client (extends C8) | Surgical actions are fire-and-forget POSTs; two in-flight actions on the same clip can arrive reordered, and backend RMW makes last-arrival win. A per-clip FIFO (await previous before sending next, coalesce where safe) removes network-ordering dependence entirely. [DEP][SYNC] | 7 | High | Low-Med | S/M |
| G2 | Eliminate cross-screen store signals: inventory every "screen A writes store field, screen B's effect consumes it" contract and replace with explicit navigation payloads / function args | Known instances: clipMetadata (D2), isLoadingWorkingVideo (D3), exportStore toast flags. Each is an implicit A-before-B timing contract with no enforcement. [DEP][SYNC] | 7 | High | Med | M |
| G3 | Make bug-hardened orderings explicit: BEGIN IMMEDIATE transactions + invariant tests for games activation and action RMW endpoints (merges B8; complements E9) | games.py:568-758 mid-handler commit sequencing is documented only in comments (bug26p); action endpoints' atomicity is an accident of no-awaits. Encode as transactions + tests so a future innocent await/reorder fails loudly. [DEP] | 6 | Med | Low | S/M |
| G4 | Editor-mode isolation test harness: modes must be loadable/testable without sibling-mode or screen-shell state | Today OverlayScreen depends on FramingScreen having written store state (working video, clipMetadata) — Overlay cannot be tested in isolation. After G2/D3, add per-mode fixture entry points so each mode has an independent test surface. [DEP] | 6 | Med | Low | M |

Directive-tag summary for earlier sections: A2/A3/A4 [SYNC]; A5 [SYNC][DEP]; A6/A7 [DRY]; A8 [SYNC]; A9 [SYNC][DRY]; A10 [SYNC]; B1 [SYNC][DEP]; B2/B3 [SYNC]; B4 [SYNC][DEP] (removes the frontend-state-must-be-fresh-at-export timing dependence); B5 [DRY][SYNC]; B6 [SYNC][DEP]; B7 [SYNC]; B8 [DEP]; C1-C12 [DRY] (C1/C4 also [SYNC] — persistence identity semantics; C7 also [DEP] — one clock source); D1 [SYNC][DEP]; D2/D3 [SYNC][DEP]; D4/D5/D6 [SYNC]; D7 [SYNC][DEP]; E1/E2 [DRY][SYNC]; E3/E4/E5 [DRY]; E6 [DEP-adjacent: removes per-handler ordering obligation]; E7 [DRY]; E8 [DRY][DEP] (sweep path unification removes parallel-writer races); E9 [DRY][DEP]; E10/E11/E12 [DRY][SYNC]; F1/F2/F3 guardrails for all three.

---

## Cross-references to existing tasks
- **T3810** (dead useHighlight) → absorbed by C3. **T3820** (snap directions) → absorbed by C1.
- Old refactoring-standards epic leftovers: **T301** done differently — editorModes.js was created but never imported (C9 finishes it properly); **T302/T303** → C9; **T304/T305** → E5; **T331/T332** (MVC extractions) → partially superseded, revisit after D-group.
- Video Proxy epic (DONE) + T3800 (DONE) are the model: C1/C4 are "finish migrating overlay onto what framing already uses."

## Tasked (2026-07-03, user-approved bug tier, exposure-ranked)

Per user direction: actual bugs first, prioritized by exposure (run frequency × proximity to onboarding/retention/monetization critical path).

| Task | Covers | Exposure rationale |
|------|--------|--------------------|
| T4200 | B1 | Export = monetization core; incident class already hit prod (T4110 sibling) |
| T4210 | A2 + A9(overlay PUT) | Overlay editing = the highlight product; loss permanent |
| T4230 | A4 + A5 | Framing data destruction + every-rename corruption |
| T4220 | A3 | Framing slow-mo, core retention loop |
| T4240 | A1 + A10(export sites) | Paid GPU export recovery |
| T4250 | A6 | Every overlay render/export with opacity animation (reel quality = shareable output) |
| T4260 | A8 / F12 | Every Annotate load (onboarding path); last banned reactive write |
| T4270 | A7 + A9(saveAnnotations, dedupe DELETE) | Latent traps; deletions shrink search space |
| T4280 | A10 remainder | Silent-fallback rule enforcement, varied exposure |

**2026-07-03 (later): user approved EVERYTHING.** Full task mapping:

| Audit items | Task(s) |
|-------------|---------|
| F1, F3 | T4290, T4300 (guardrails, land first) |
| B2, B3, C8+G1+B6, B5, B7, B8+G3 | Durability & Sync epic: T4310, T4320, T4330, T4340, T4350, T4360 |
| F2, E1, E2, B4, E8+E9-partial | Export Write-Path epic (strict order): T4370, T4380, T4390, T4400, T4410 |
| E4, E3 | T4420, T4430 (render fidelity; depend on T4370) |
| C3, C4, C1 (absorbs T3810, T3820) | Keyframe Unification epic (strict order): T4440, T4450, T4460 (Stage-2 gated) |
| D1, D2+G2, D3+G2, D4, D5, D6+D7+C11, G4 | Editor Decoupling epic: T4470-T4530 (T4530 last) |
| C7, C2, C9 (absorbs T301-T303), C10, C6, C12, C5 | T4540, T4550, T4560, T4570, T4580, T4590, T4600 (Stage-2 gated) |
| E6, E5+E12+E14, E7, E9, E11, E10 | T4610, T4620, T4630, T4640, T4650, T4660 |

Every audit item is now tasked. Old refactoring-standards leftovers T331/T332 are superseded by the Editor Decoupling epic outcomes.

## Recommended first wave (pending approval)
1. **Bug batch A1-A7** (one or two container tasks; all S, low risk, several are live data-destroyers)
2. **B1** sync-then-announce for framing/multi-clip (small, pattern exists, closes the biggest durability hole) + **G1** serialized action queue (small, removes a whole race class)
3. **A9 + C3** deletion sweeps (zero-risk, shrink the search space for everything after)
4. **F1 + F2** guardrails (make the sync model self-enforcing before the bigger refactors)
5. Then: E2 (export finalize/publish single writer), D1/D2, C7, E6 — before the epics (C1, C5, E8, B4).
